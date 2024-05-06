import type { MemoizationCache, MemoizationCacheKey } from "./memoize.ts";

/**
 * [Least-recently-used](
 * 	https://en.wikipedia.org/wiki/Cache_replacement_policies#LRU
 * ) cache.
 *
 * Automatically removes entries above the max size based on when they were
 * last accessed with `get`, `set`, or `has`.
 */
export class LruCache<K extends MemoizationCacheKey, V> extends Map<K, V>
  implements MemoizationCache<K, V> {
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
