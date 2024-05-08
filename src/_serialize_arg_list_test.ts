import { assertEquals } from "@std/assert";
import { _serializeArgList } from "./memoize.ts";

Deno.test("simple numbers", () => {
  const getKey = _serializeArgList(new Map());
  assertEquals(getKey(1), "undefined,1");
  assertEquals(getKey(1, 2), "undefined,1,2");
  assertEquals(getKey(1, 2, 3), "undefined,1,2,3");
});

Deno.test("primitive types", () => {
  const getKey = _serializeArgList(new Map());
  assertEquals(
    getKey(1, "2", 3n, null, undefined, true, Symbol.for("xyz")),
    'undefined,1,"2",3n,null,undefined,true,Symbol.for("xyz")',
  );
});

Deno.test("reference types", () => {
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

Deno.test("`this` arg", () => {
  const getKey = _serializeArgList(new Map());
  const obj1 = {};
  const obj2 = {};

  assertEquals(getKey(), "undefined");
  assertEquals(getKey.call(obj1), "{0}");
  assertEquals(getKey.call(obj2), "{1}");
  assertEquals(getKey.call(obj1, obj2), "{0},{1}");
});

Deno.test("garbage collection for weak keys", () => {
  const OriginalFinalizationRegistry = FinalizationRegistry;

  class MockFinalizationRegistry<T> extends FinalizationRegistry<T> {
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
  }

  function makeRegisterableObject() {
    const onCleanup = null as (() => void) | null;
    return {
      onCleanup,
      [Symbol.dispose]() {
        this.onCleanup?.();
      },
    };
  }

  try {
    globalThis.FinalizationRegistry = MockFinalizationRegistry;

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
  } finally {
    globalThis.FinalizationRegistry = OriginalFinalizationRegistry;
  }
});
