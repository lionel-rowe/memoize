import { LruCache } from "./lru_cache.ts";

export type MemoizationCache<K, V> = {
  has: (key: K) => boolean;
  get: (key: K) => V | undefined;
  set: (key: K, val: V) => unknown;
  delete: (key: K) => unknown;
};

export type MemoizationOptions<This, Args extends unknown[], Return> = {
  /** Function to get a unique cache key from the function's arguments */
  getKey?: (this: This, ...args: Args) => unknown;
  /** Cache (such as a `Map` object) for getting previous results */
  cache?: MemoizationCache<unknown, Return>;
  /**
   * Only use args as cache keys up to the `length` property of the function.
   * Useful for passing unary functions as array callbacks, but should be
   * avoided for functions with variable argument length (`...rest` or default
   * params)
   */
  truncateArgs?: boolean;
};

// used for memoizing the `memoize` function itself to enable on-the-fly usage
const _cache = new LruCache(100);
const _getKey = _serializeArgList(_cache);

/**
 * Cache the results of a function based on its arguments.
 *
 * @param fn - The function to memoize
 * @param options - Options for memoization
 *
 * @example
 * ```ts
 * import { memoize } from "@std/caching";
 * import { assertEquals } from "@std/assert";
 *
 * // fibonacci function, which is very slow for n > ~30 if not memoized
 * const fib = memoize((n: bigint): bigint => {
 *   return n <= 2n ? 1n : fib(n - 1n) + fib(n - 2n);
 * });
 *
 * assertEquals(fib(100n), 354224848179261915075n);
 * ```
 */
const memoize_ = memoize(memoize, {
  cache: _cache,
  getKey(fn, options) {
    const optionVals = Object.entries(options ?? {})
      .sort(([a], [b]) => a > b ? 1 : a < b ? -1 : 0)
      .map(([, v]) => v);
    return _getKey(fn, ...optionVals);
  },
});

export { memoize_ as memoize };

function memoize<
  Fn extends (...args: never[]) => unknown,
  This extends ThisParameterType<Fn> = ThisParameterType<Fn>,
  Args extends Parameters<Fn> = Parameters<Fn>,
  Return = ReturnType<Fn>,
>(
  fn: Fn,
  options?: Partial<MemoizationOptions<This, Args, Return>>,
): Fn & {
  cache: MemoizationCache<unknown, Return>;
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

    let val = fn.apply(this, args) as Return;

    if (val instanceof Promise) {
      val = val.catch((reason) => {
        cache.delete(key);
        throw reason;
      }) as typeof val;
    }

    cache.set(key, val);

    return val as Return;
  } as Fn;

  return Object.defineProperties(Object.assign(memoized, { cache, getKey }), {
    length: { value: fn.length },
    name: { value: fn.name },
  });
}

/** Default serialization of arguments list for use as cache keys */
export function _serializeArgList<Return>(
  cache: MemoizationCache<unknown, Return>,
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
      if (typeof arg === "undefined") return "undefined";
      if (typeof arg === "bigint") return `${arg}n`;

      if (
        typeof arg !== "symbol" && typeof arg !== "function" &&
        (arg === null || typeof arg !== "object")
      ) {
        // null, string, boolean, number, or one of the upcoming
        // [record/tuple](https://github.com/tc39/proposal-record-tuple) types
        try {
          return JSON.stringify(arg);
        } catch { /* fallthrough to weak cache */ }
      }

      try {
        assertWeakKey(arg);
      } catch (e) {
        if (typeof arg === "symbol") {
          return `Symbol.for(${JSON.stringify(arg.description)})`;
        }
        throw e;
      }

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

function assertWeakKey(arg: unknown): asserts arg is WeakKey {
  new WeakRef(arg as WeakKey);
}
