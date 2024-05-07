import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertRejects,
} from "@std/assert";
import { delay } from "@std/async";
import { _serializeArgList, memoize } from "./memoize.ts";
import { LruCache } from "./lru_cache.ts";

Deno.test(_serializeArgList.name, async (t) => {
  await t.step("simple numbers", () => {
    const getKey = _serializeArgList(new Map());
    assertEquals(getKey(1), "undefined,1");
    assertEquals(getKey(1, 2), "undefined,1,2");
    assertEquals(getKey(1, 2, 3), "undefined,1,2,3");
  });

  await t.step("primitive types", () => {
    const getKey = _serializeArgList(new Map());
    assertEquals(
      getKey(1, "2", 3n, null, undefined, true, Symbol.for("xyz")),
      'undefined,1,"2",3n,null,undefined,true,Symbol.for("xyz")',
    );
  });

  await t.step("reference types", () => {
    const getKey = _serializeArgList(new Map());
    const obj = {};
    const arr: [] = [];
    const sym = Symbol("xyz");

    assertEquals(getKey(obj), "undefined,{0}");
    assertEquals(getKey(obj, obj), "undefined,{0},{0}");

    assertEquals(getKey(arr), "undefined,{1}");
    assertEquals(getKey(sym), "undefined,{2}");
    assertEquals(
      getKey(obj, arr, sym),
      "undefined,{0},{1},{2}",
    );
  });

  await t.step("`this` arg", () => {
    const getKey = _serializeArgList(new Map());
    const obj1 = {};
    const obj2 = {};

    assertEquals(getKey(), "undefined");
    assertEquals(getKey.call(obj1), "{0}");
    assertEquals(getKey.call(obj2), "{1}");
    assertEquals(getKey.call(obj1, obj2), "{0},{1}");
  });

  await t.step("garbage collection for weak keys", () => {
    const OriginalFinalizationRegistry = globalThis.FinalizationRegistry;
    globalThis.FinalizationRegistry = class MockFinalizationRegistry<T>
      extends globalThis.FinalizationRegistry<T> {
      #cleanupCallback: (heldValue: T) => void;

      constructor(cleanupCallback: (heldValue: T) => void) {
        super(cleanupCallback);
        this.#cleanupCallback = cleanupCallback;
      }

      register(target: WeakKey, heldValue: T) {
        Object.assign(target, {
          onCleanup: () => {
            this.#cleanupCallback(heldValue);
          },
        });
      }
    };

    function makeRegisterableObject() {
      const onCleanup = null as (() => void) | null;
      return {
        onCleanup,
        [Symbol.dispose]() {
          this.onCleanup?.();
        },
      };
    }

    const cache = new Map();
    const getKey = _serializeArgList(cache);

    using outerScopeObj = makeRegisterableObject();

    const k1 = getKey(outerScopeObj);
    const k2 = getKey(globalThis);
    const k3 = getKey("primitive");
    const k4 = getKey(globalThis, "primitive");
    const k5 = getKey(globalThis, "primitive", outerScopeObj);

    const persistentKeys = new Set([k1, k2, k3, k4, k5]);

    {
      using obj1 = makeRegisterableObject();
      using obj2 = makeRegisterableObject();

      const k6 = getKey(obj1);
      const k7 = getKey(obj2);
      const k8 = getKey(obj1, obj2);
      const k9 = getKey(obj1, globalThis);
      const k10 = getKey(obj1, "primitive");
      const k11 = getKey(obj1, outerScopeObj);

      const ephemeralKeys = new Set([k6, k7, k8, k9, k10, k11]);

      const keys = new Set([...ephemeralKeys, ...persistentKeys]);
      for (const key of keys) {
        cache.set(key, "!");
      }

      assertEquals(cache.size, keys.size);
    }

    assertEquals(cache.size, persistentKeys.size);

    globalThis.FinalizationRegistry = OriginalFinalizationRegistry;
  });
});

Deno.test(memoize.name, async (t) => {
  await t.step(
    "memoization of nullary function (lazy/singleton)",
    async (t) => {
      await t.step("async function", async () => {
        let numTimesCalled = 0;

        const db = {
          connect() {
            ++numTimesCalled;
            return Promise.resolve({});
          },
        };

        const getConn = memoize(async () => await db.connect());
        const conn = await getConn();
        assertEquals(numTimesCalled, 1);
        const conn2 = await getConn();
        // equal by reference
        assert(conn2 === conn);
        assertEquals(numTimesCalled, 1);
      });

      await t.step("sync function", async () => {
        const firstHitDate = memoize(() => new Date());

        const date = firstHitDate();

        await delay(10);

        const date2 = firstHitDate();

        assertEquals(date, date2);
      });
    },
  );

  await t.step("simple memoization with primitive arg", () => {
    let numTimesCalled = 0;
    const fn = memoize((n: number) => {
      ++numTimesCalled;
      return 0 - n;
    });

    assertEquals(fn(42), -42);
    assertEquals(numTimesCalled, 1);
    assertEquals(fn(42), -42);
    assertEquals(numTimesCalled, 1);
    assertEquals(fn(888), -888);
    assertEquals(numTimesCalled, 2);
  });

  await t.step("fibonacci", () => {
    const fib = memoize((n: bigint): bigint =>
      n <= 2n ? 1n : fib(n - 1n) + fib(n - 2n)
    );

    const startTime = Date.now();
    assertEquals(fib(100n), 354224848179261915075n);
    assertAlmostEquals(Date.now(), startTime, 10);
  });

  await t.step("fibonacci", () => {
    const fib = memoize((n: bigint): bigint =>
      n <= 2n ? 1n : fib(n - 1n) + fib(n - 2n)
    );

    const startTime = Date.now();
    assertEquals(fib(100n), 354224848179261915075n);
    assertAlmostEquals(Date.now(), startTime, 10);
  });

  await t.step("memoization with multiple primitive args", () => {
    let numTimesCalled = 0;
    const fn = memoize((a: number, b: number) => {
      ++numTimesCalled;
      return a + b;
    });

    assertEquals(fn(7, 8), 15);
    assertEquals(numTimesCalled, 1);
    assertEquals(fn(7, 8), 15);
    assertEquals(numTimesCalled, 1);
    assertEquals(fn(7, 9), 16);
    assertEquals(numTimesCalled, 2);
    assertEquals(fn(8, 7), 15);
    assertEquals(numTimesCalled, 3);
  });

  await t.step("memoization with ...spread primitive args", () => {
    let numTimesCalled = 0;
    const fn = memoize((...ns: number[]) => {
      ++numTimesCalled;
      return ns.reduce((total, val) => total + val, 0);
    });

    assertEquals(fn(), 0);
    assertEquals(fn(), 0);
    assertEquals(numTimesCalled, 1);
    assertEquals(fn(7), 7);
    assertEquals(fn(7), 7);
    assertEquals(numTimesCalled, 2);
    assertEquals(fn(7, 8), 15);
    assertEquals(fn(7, 8), 15);
    assertEquals(numTimesCalled, 3);
    assertEquals(fn(7, 8, 9), 24);
    assertEquals(fn(7, 8, 9), 24);
    assertEquals(numTimesCalled, 4);
  });

  await t.step(
    "unary fn caches by all passed args by default (implicit extra args as array callback)",
    () => {
      let numTimesCalled = 0;
      const fn = memoize((n: number) => {
        ++numTimesCalled;
        return 0 - n;
      });

      assertEquals([1, 1, 2, 2].map(fn), [-1, -1, -2, -2]);
      assertEquals(numTimesCalled, 4);
    },
  );

  await t.step(
    "unary fn caches by single arg if `truncateArgs: true` (even if implicitly passed extra args)",
    () => {
      let numTimesCalled = 0;
      const fn = memoize((n: number) => {
        ++numTimesCalled;
        return 0 - n;
      }, { truncateArgs: true });

      assertEquals([1, 1, 2, 2].map(fn), [-1, -1, -2, -2]);
      assertEquals(numTimesCalled, 2);
    },
  );

  await t.step("`this` binding is preserved`", () => {
    class X {
      readonly key = "CONSTANT";
      timesCalled = 0;

      #method() {
        return 1;
      }

      method() {
        ++this.timesCalled;
        return this.#method();
      }
    }

    const x = new X();

    const method = x.method.bind(x);

    const fn = memoize(method);
    assertEquals(fn(), 1);

    const fn2 = memoize(x.method).bind(x);
    assertEquals(fn2(), 1);
  });

  // based on https://github.com/lodash/lodash/blob/4.17.15/test/test.js#L14704-L14716
  await t.step("should use `this` binding of function for `getKey`", () => {
    type Obj = { b: number; c: number; memoized: (a: number) => number };

    let numTimesCalled = 0;

    const fn = function (this: Obj, a: number) {
      ++numTimesCalled;
      return a + this.b + this.c;
    };
    const getKey = function (this: Obj, a: number) {
      return JSON.stringify([a, this.b, this.c]);
    };

    const memoized = memoize(fn, { getKey });

    const obj: Obj = { memoized, "b": 2, "c": 3 };
    assertEquals(obj.memoized(1), 6);
    assertEquals(numTimesCalled, 1);

    assertEquals(obj.memoized(1), 6);
    assertEquals(numTimesCalled, 1);

    obj.b = 3;
    obj.c = 5;
    assertEquals(obj.memoized(1), 9);
    assertEquals(numTimesCalled, 2);
  });

  await t.step("reference arg with default caching", () => {
    let numTimesCalled = 0;
    const fn = memoize((sym: symbol) => {
      ++numTimesCalled;
      return sym;
    });
    const sym1 = Symbol();
    const sym2 = Symbol();

    fn(sym1);
    assertEquals(numTimesCalled, 1);
    fn(sym1);
    assertEquals(numTimesCalled, 1);
    fn(sym2);
    assertEquals(numTimesCalled, 2);
  });

  await t.step("multiple reference args with default caching", () => {
    let numTimesCalled = 0;
    const fn = memoize((obj1: unknown, obj2: unknown) => {
      ++numTimesCalled;
      return { obj1, obj2 };
    });
    const obj1 = {};
    const obj2 = {};

    fn(obj1, obj1);
    assertEquals(numTimesCalled, 1);
    fn(obj1, obj1);
    assertEquals(numTimesCalled, 1);
    fn(obj1, obj2);
    assertEquals(numTimesCalled, 2);
    fn(obj2, obj2);
    assertEquals(numTimesCalled, 3);
    fn(obj2, obj1);
    assertEquals(numTimesCalled, 4);
  });

  await t.step("non-primitive arg with `getKey`", () => {
    let numTimesCalled = 0;
    const fn = memoize((d: Date) => {
      ++numTimesCalled;
      return new Date(0 - d.valueOf());
    }, { getKey: (n) => n.valueOf() });
    const date1 = new Date(42);
    const date2 = new Date(888);

    assertEquals(fn(date1), new Date(-42));
    assertEquals(numTimesCalled, 1);
    assertEquals(fn(date1), new Date(-42));
    assertEquals(numTimesCalled, 1);
    assertEquals(fn(date2), new Date(-888));
    assertEquals(numTimesCalled, 2);
  });

  await t.step(
    "multiple non-primitive args with `getKey` returning primitive",
    () => {
      let numTimesCalled = 0;

      const fn = memoize((...args: { val: number }[]) => {
        ++numTimesCalled;
        return args.reduce((total, { val }) => total + val, 0);
      }, { getKey: (...args) => JSON.stringify(args) });

      assertEquals(fn({ val: 1 }, { val: 2 }), 3);
      assertEquals(numTimesCalled, 1);
      assertEquals(fn({ val: 1 }, { val: 2 }), 3);
      assertEquals(numTimesCalled, 1);
      assertEquals(fn({ val: 2 }, { val: 1 }), 3);
      assertEquals(numTimesCalled, 2);
    },
  );

  await t.step(
    "multiple non-primitive args with `getKey` returning array of primitives",
    () => {
      let numTimesCalled = 0;

      const fn = memoize((...args: { val: number }[]) => {
        ++numTimesCalled;
        return args.reduce((total, { val }) => total + val, 0);
      }, { getKey: (...args) => JSON.stringify(args.map((arg) => arg.val)) });

      assertEquals(fn({ val: 1 }, { val: 2 }), 3);
      assertEquals(numTimesCalled, 1);
      assertEquals(fn({ val: 1 }, { val: 2 }), 3);
      assertEquals(numTimesCalled, 1);
      assertEquals(fn({ val: 2 }, { val: 1 }), 3);
      assertEquals(numTimesCalled, 2);
    },
  );

  await t.step(
    "multiple non-primitive args of different types, `getKey` returning array of primitives",
    () => {
      let numTimesCalled = 0;

      const fn = memoize((one: { one: number }, two: { two: number }) => {
        ++numTimesCalled;
        return one.one + two.two;
      }, { getKey: (one, two) => `${one.one},${two.two}` });

      assertEquals(fn({ one: 1 }, { two: 2 }), 3);
      assertEquals(numTimesCalled, 1);
      assertEquals(fn({ one: 1 }, { two: 2 }), 3);
      assertEquals(numTimesCalled, 1);
      assertEquals(fn({ one: 2 }, { two: 1 }), 3);
      assertEquals(numTimesCalled, 2);
    },
  );

  await t.step("primitive arg with `getKey`", () => {
    let numTimesCalled = 0;
    const fn = memoize((arg: string | number | boolean) => {
      ++numTimesCalled;

      try {
        return JSON.parse(String(arg)) as string | number | boolean;
      } catch {
        return arg;
      }
    }, { getKey: (arg) => String(arg) });

    assertEquals(fn("true"), true);
    assertEquals(numTimesCalled, 1);
    assertEquals(fn(true), true);
    assertEquals(numTimesCalled, 1);

    assertEquals(fn("42"), 42);
    assertEquals(numTimesCalled, 2);
    assertEquals(fn(42), 42);
    assertEquals(numTimesCalled, 2);
  });

  await t.step("works with async functions", async () => {
    // wait time per call of the original (un-memoized) function
    const DELAY_MS = 100;
    // max amount of execution time per call of the memoized function
    const TOLERANCE_MS = 5;

    const startTime = Date.now();
    const fn = memoize(async (n: number) => {
      await delay(DELAY_MS);
      return 0 - n;
    });

    const nums = [42, 888, 42, 42, 42, 42, 888, 888, 888, 888];
    const expected = [-42, -888, -42, -42, -42, -42, -888, -888, -888, -888];
    const results: number[] = [];

    // call in serial to test time elapsed
    for (const num of nums) {
      results.push(await fn(num));
    }

    assertEquals(results, expected);

    const numUnique = new Set(nums).size;

    assertAlmostEquals(
      Date.now() - startTime,
      numUnique * DELAY_MS,
      nums.length * TOLERANCE_MS,
    );
  });

  await t.step(
    "doesn’t cache rejected promises for future function calls",
    async () => {
      let rejectNext = true;
      const fn = memoize(async (n: number) => {
        await Promise.resolve();
        const thisCallWillReject = rejectNext;
        rejectNext = !rejectNext;
        if (thisCallWillReject) {
          throw new Error();
        }
        return 0 - n;
      });

      // first call rejects
      await assertRejects(() => fn(42));
      // second call succeeds (rejected response is discarded)
      assertEquals(await fn(42), -42);
      // subsequent calls also succeed (successful response from cache is used)
      assertEquals(await fn(42), -42);
    },
  );

  await t.step(
    "async functions called in parallel return the same promise (even if rejected)",
    async () => {
      let rejectNext = true;
      const fn = memoize(async (n: number) => {
        await Promise.resolve();
        if (rejectNext) {
          rejectNext = false;
          throw new Error(`Rejected ${n}`);
        }
        return 0 - n;
      }, { truncateArgs: true });

      const promises = [42, 42, 888, 888].map(fn);

      const results = await Promise.allSettled(promises);

      assert(promises[1] === promises[0]);
      assert(results[1].status === "rejected");
      assert(results[1].reason.message === "Rejected 42");

      assert(promises[3] === promises[2]);
      assert(results[3].status === "fulfilled");
      assert(results[3].value === -888);
    },
  );

  await t.step(
    "manipulating the `cache` property of the memoized function",
    () => {
      let numTimesCalled = 0;
      const fn = memoize((n: number) => {
        ++numTimesCalled;
        return 0 - n;
      });

      assertEquals(fn(42), -42);
      assertEquals(numTimesCalled, 1);
      assertEquals(fn(42), -42);
      assertEquals(numTimesCalled, 1);

      fn.cache.delete(fn.getKey.call(undefined, 42));

      assertEquals(fn(42), -42);
      assertEquals(numTimesCalled, 2);
    },
  );

  await t.step("passing a `Map` as a cache", () => {
    let numTimesCalled = 0;
    const cache = new Map();
    const fn = memoize((n: number) => {
      ++numTimesCalled;
      return 0 - n;
    }, { cache });

    assertEquals(fn(42), -42);
    assertEquals(numTimesCalled, 1);
    assertEquals(fn(42), -42);
    assertEquals(numTimesCalled, 1);

    cache.delete(fn.getKey.call(undefined, 42));

    assertEquals(fn(42), -42);
    assertEquals(numTimesCalled, 2);
  });

  await t.step("passing a custom cache object", () => {
    let numTimesCalled = 0;

    const uselessCache = {
      has: () => false,
      get: () => {
        throw new Error("`has` is always false, so `get` is never called");
      },
      set: () => {},
      delete: () => {},
      keys: () => [],
    };

    const fn = memoize((n: number) => {
      ++numTimesCalled;
      return 0 - n;
    }, { cache: uselessCache });

    assertEquals(fn(42), -42);
    assertEquals(numTimesCalled, 1);
    assertEquals(fn(42), -42);
    assertEquals(numTimesCalled, 2);
  });

  await t.step("`LruCache`", () => {
    let numTimesCalled = 0;

    const MAX_SIZE = 5;

    const fn = memoize((n: number) => {
      ++numTimesCalled;
      return 0 - n;
    }, { cache: new LruCache(MAX_SIZE) });

    assertEquals(fn(0), 0);
    assertEquals(fn(0), 0);
    assertEquals(numTimesCalled, 1);

    for (let i = 1; i < MAX_SIZE; ++i) {
      assertEquals(fn(i), 0 - i);
      assertEquals(fn(i), 0 - i);
      assertEquals(numTimesCalled, i + 1);
    }

    assertEquals(fn(MAX_SIZE), 0 - MAX_SIZE);
    assertEquals(fn(MAX_SIZE), 0 - MAX_SIZE);
    assertEquals(numTimesCalled, MAX_SIZE + 1);

    assertEquals(fn(0), 0);
    assertEquals(fn(0), 0);
    assertEquals(numTimesCalled, MAX_SIZE + 2);
  });

  await t.step("only cache single latest result", () => {
    let numTimesCalled = 0;

    const fn = memoize((n: number) => {
      ++numTimesCalled;
      return 0 - n;
    }, { cache: new LruCache(1) });

    assertEquals(fn(0), 0);
    assertEquals(fn(0), 0);
    assertEquals(numTimesCalled, 1);

    assertEquals(fn(1), -1);
    assertEquals(numTimesCalled, 2);
  });

  await t.step("introspecting the cache", () => {
    const fn = memoize((...args: unknown[]) => args);
    assertEquals(fn(1), [1]);
    assertEquals(fn("a"), ["a"]);
    assertEquals(fn("a", "b"), ["a", "b"]);

    assertEquals(fn.cache.get(fn.getKey.call(undefined, 1)), [1]);
    assertEquals(fn.cache.get(fn.getKey.call(undefined, "a")), ["a"]);
    assertEquals(fn.cache.get(fn.getKey.call(undefined, "a", "b")), ["a", "b"]);
  });

  await t.step("fn length", () => {
    assertEquals(memoize(() => {}).length, 0);
    assertEquals(memoize((_arg) => {}).length, 1);
    assertEquals(memoize((_1, _2) => {}).length, 2);
    assertEquals(memoize((..._args) => {}).length, 0);
    assertEquals(memoize((_1, ..._args) => {}).length, 1);
  });

  await t.step("on-the-fly memoization", () => {
    let numTimesCalled = 0;

    const fn = (arg?: unknown) => {
      ++numTimesCalled;
      return arg;
    };

    memoize(fn)();
    assertEquals(numTimesCalled, 1);
    memoize(fn)();
    assertEquals(numTimesCalled, 1);

    memoize(fn, {})();
    assertEquals(numTimesCalled, 1);

    memoize(fn, { cache: new Map() })();
    assertEquals(numTimesCalled, 2);

    memoize(fn, { cache: new Map() })();
    assertEquals(numTimesCalled, 3);

    const cache = new Map();
    memoize(fn, { cache })();
    assertEquals(numTimesCalled, 4);
    memoize(fn, { cache })();
    assertEquals(numTimesCalled, 4);
  });

  await t.step("TS types", async (t) => {
    await t.step("simple types", () => {
      // no need to run, only for type checking
      void (() => {
        const fn: (this: number, x: number) => number = (_) => 1;
        const memoized = memoize(fn);

        const _fn2: typeof fn = memoized;
        const _fn3: Omit<typeof memoized, "cache" | "getKey"> = fn;

        const _t1: ThisParameterType<typeof fn> = 1;
        // @ts-expect-error Type 'string' is not assignable to type 'number'.
        const _t2: ThisParameterType<typeof fn> = "1";

        const _a1: Parameters<typeof fn>[0] = 1;
        // @ts-expect-error Type 'string' is not assignable to type 'number'.
        const _a2: Parameters<typeof fn>[0] = "1";
        // @ts-expect-error Tuple type '[x: number]' of length '1' has no element at index '1'.
        // deno-lint-ignore no-explicit-any
        const _a3: Parameters<typeof fn>[1] = {} as any;

        const _r1: ReturnType<typeof fn> = 1;
        // @ts-expect-error Type 'string' is not assignable to type 'number'.
        const _r2: ReturnType<typeof fn> = "1";
      });
    });

    await t.step("generics", () => {
      // no need to run, only for type checking
      void (() => {
        const fn = <T>(x: T): T => x;
        const memoized = memoize(fn);

        const _fn2: typeof fn = memoized;
        const _fn3: Omit<typeof memoized, "cache" | "getKey"> = fn;

        const _r1: number = fn(1);
        const _r2: string = fn("1");
        // @ts-expect-error Type 'string' is not assignable to type 'number'.
        const _r3: number = fn("1");

        const _fn4: typeof fn<number> = (n: number) => n;
        // @ts-expect-error Type 'string' is not assignable to type 'number'.
        const _fn5: typeof fn<string> = (n: number) => n;
      });
    });
  });
});