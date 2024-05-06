export type MemoizationCacheKey =
  | string
  | number
  | boolean
  | null
  | undefined
  | bigint
  | WeakKey;

export type MemoizationCache<K extends MemoizationCacheKey, V> = {
  has: (key: K) => boolean;
  get: (key: K) => V | undefined;
  set: (key: K, val: V) => unknown;
  delete: (key: K) => unknown;
};

export type MemoizationOptions<This, Args extends unknown[], Return> = {
  /** Function to get a unique cache key from the function's arguments */
  getKey?: (this: This, ...args: Args) => MemoizationCacheKey;
  /** Cache (such as a `Map` object) for getting previous results */
  cache?: MemoizationCache<MemoizationCacheKey, Return>;
  /**
   * Only use args as cache keys up to the `length` property of the function.
   * Useful for passing unary functions as array callbacks, but should be
   * avoided for functions with variable argument length (`...rest` or default
   * params)
   */
  truncateArgs?: boolean;
};

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
  options?: Partial<MemoizationOptions<This, Args, Return>>,
): ((this: This, ...args: Args) => Return) & {
  cache: MemoizationCache<MemoizationCacheKey, Return>;
  getKey: (this: This, ...args: Args) => MemoizationCacheKey;
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
      }) as typeof val;
    }

    cache.set(key, val);

    return val as Return;
  };

  Object.defineProperty(memoized, "length", { value: fn.length });
  return Object.assign(memoized, { cache, getKey });
}

/** Default serialization of arguments list for use as cache keys */
export function _serializeArgList<Return>(
  cache: MemoizationCache<MemoizationCacheKey, Return>,
): (this: unknown, ...args: unknown[]) => string {
  const weakKeyToKeySegmentCache = new WeakMap<WeakKey, string>();
  const weakKeySegmentToKeyCache = new Map<string, string[]>();
  let i = 0;

  const registry = new FinalizationRegistry<string>((keySegment) => {
    for (const key of weakKeySegmentToKeyCache.get(keySegment) ?? []) {
      cache.delete(key);
    }
    weakKeySegmentToKeyCache.delete(keySegment);
  });

  return function (...args) {
    const weakKeySegments: string[] = [];
    const keySegments = [this, ...args].map((arg) => {
      if (
        typeof arg === "string" || typeof arg === "number" ||
        typeof arg === "boolean" || arg === null
      ) {
        return JSON.stringify(arg);
      }

      if (typeof arg === "undefined") return "undefined";
      if (typeof arg === "bigint") return `${arg}n`;

      if (!weakKeyToKeySegmentCache.has(arg)) {
        const keySegment = `{${i++}}`;
        weakKeySegments.push(keySegment);
        registry.register(arg, keySegment);
        weakKeyToKeySegmentCache.set(arg, keySegment);
      }

      const keySegment = weakKeyToKeySegmentCache.get(arg)!;
      weakKeySegments.push(keySegment);
      return keySegment;
    });

    const key = keySegments.join(",");

    for (const keySegment of weakKeySegments) {
      const keys = weakKeySegmentToKeyCache.get(keySegment) ?? [];
      keys.push(key);
      weakKeySegmentToKeyCache.set(keySegment, keys);
    }

    return key;
  };
}
