export type MemoizeCache<K, V> = {
  has: (key: K) => boolean;
  get: (key: K) => V | undefined;
  set: (key: K, val: V) => unknown;
  delete: (key: K) => unknown;
};

export type MemoizeOptions<This, Args extends unknown[], Return> = {
  /** Function to get a unique cache key from the function's arguments */
  getKey?: (this: This, ...args: Args) => unknown;
  /** Cache (such as a `Map` object) for getting previous results */
  cache?: MemoizeCache<unknown, Return>;
  /**
   * Only use args as cache keys up to the `length` property of the function. Useful for passing unary functions as
   * array callbacks, but should be avoided for functions with variable argument length (`...rest` or default params)
   */
  truncateArgs?: boolean;
};

function assertWeakKey(arg: unknown): asserts arg is WeakKey {
  new WeakRef(arg as WeakKey);
}

export function _serializeArgList<Return>(
  cache: MemoizeCache<unknown, Return>,
) {
  const weakKeySegmentCache = new WeakMap<WeakKey, string>();
  const strongKeySegmentCache = new Map<unknown, string>();

  const keySegmentToKeyCache = new Map<string, string[]>();

  const finalizationRegistry = new FinalizationRegistry<string>(
    (keySegment) => {
      for (const key of keySegmentToKeyCache.get(keySegment) ?? []) {
        cache.delete(key);
      }
    },
  );

  let i = 0;
  const nextReferenceKeySegment = () => `\x01{${i++}}\x02`;

  return function (this: unknown, ...args: unknown[]) {
    const segments = [this, ...args].map((arg) => {
      if (
        typeof arg === "string" || typeof arg === "number" ||
        typeof arg === "boolean" || arg === null
      ) {
        return JSON.stringify(arg);
      }

      if (typeof arg === "undefined") {
        return "undefined";
      }

      if (typeof arg === "bigint") {
        return `${arg}n`;
      }

      try {
        assertWeakKey(arg);

        if (weakKeySegmentCache.has(arg)) {
          return weakKeySegmentCache.get(arg)!;
        }

        const keySegment = nextReferenceKeySegment();
        finalizationRegistry.register(arg, keySegment);

        weakKeySegmentCache.set(arg, keySegment);

        return keySegment;
      } catch {
        if (strongKeySegmentCache.has(arg)) {
          return strongKeySegmentCache.get(arg)!;
        }

        const keySegment = nextReferenceKeySegment();

        strongKeySegmentCache.set(arg, keySegment);

        return keySegment;
      }
    });

    const mapped = segments.join(",");

    for (const segment of segments) {
      const keys = keySegmentToKeyCache.get(segment) ?? [];
      keys.push(mapped);
      keySegmentToKeyCache.set(segment, keys);
    }

    return mapped;
  };
}

/**
 * Cache the results of a function based on its arguments.
 *
 * @param fn - The function to memoize
 * @param options - Options for memoization
 *
 * @example
 * ```ts
 * // fibonacci function, which is very slow for n > ~30 if not memoized
 * const fib = memoize((n: bigint): bigint => {
 *   return n <= 2n ? 1n : fib(n - 1n) + fib(n - 2n);
 * });
 * ```
 */
export function memoize<This, Args extends unknown[], Return>(
  fn: (this: This, ...args: Args) => Return,
  options?: Partial<MemoizeOptions<This, Args, Return>>,
): ((this: This, ...args: Args) => Return) & {
  cache: MemoizeCache<unknown, Return>;
  getKey: (this: This, ...args: Args) => unknown;
} {
  const truncateArgs = options?.truncateArgs ?? false;
  const cache = options?.cache ?? new Map();
  const getKey = options?.getKey ?? _serializeArgList(cache);

  const memoized = function (this: This, ...args: Args): Return {
    if (truncateArgs) args = args.slice(0, fn.length) as Args;

    const key = getKey.apply(this, args);

    if (cache.has(key)) {
      return cache.get(key) as Return;
    }

    let val = fn.apply(this, args);

    if (val instanceof Promise) {
      val = val.catch((reason) => {
        cache.delete(key);
        throw reason;
      }) as Return;
    }

    cache.set(key, val);

    return val as Return;
  };

  Object.defineProperty(memoized, "length", { value: fn.length });

  return Object.assign(memoized, { cache, getKey });
}

/**
 * [Least-recently-used](https://en.wikipedia.org/wiki/Cache_replacement_policies#LRU) cache.
 *
 * Automatically removes entries above the max size based on when they were last accessed with `get`, `set`, or `has`.
 */
export class LruCache<K, V> extends Map<K, V> implements MemoizeCache<K, V> {
  constructor(public maxSize: number) {
    super();
  }

  #setMostRecentlyUsed(key: K, value: V) {
    // delete then re-add to ensure most recently accessed elements are last
    super.delete(key);
    super.set(key, value);
  }

  #pruneToMaxSize() {
    if (this.size > this.maxSize) {
      this.delete(this.keys().next().value);
    }
  }

  has(key: K) {
    const exists = super.has(key);

    if (exists) {
      this.#setMostRecentlyUsed(key, super.get(key)!);
    }

    return exists;
  }

  get(key: K) {
    if (super.has(key)) {
      const value = super.get(key)!;
      this.#setMostRecentlyUsed(key, value);
      return value;
    }

    return undefined;
  }

  set(key: K, value: V) {
    this.#setMostRecentlyUsed(key, value);
    this.#pruneToMaxSize();

    return this;
  }
}
