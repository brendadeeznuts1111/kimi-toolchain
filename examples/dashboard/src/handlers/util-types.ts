// ── Util Types ─────────────────────────────────────────────────────

export async function apiUtilTypes(): Promise<Response> {
  const { types } = await import("node:util");

  const checks: { name: string; value: unknown; result: boolean }[] = [
    {
      name: "isAnyArrayBuffer",
      value: new ArrayBuffer(4),
      result: types.isAnyArrayBuffer(new ArrayBuffer(4)),
    },
    {
      name: "isArrayBuffer",
      value: "ArrayBuffer",
      result: types.isArrayBuffer(new ArrayBuffer(4)),
    },
    {
      name: "isSharedArrayBuffer",
      value: "SharedArrayBuffer",
      result: types.isSharedArrayBuffer(new SharedArrayBuffer(4)),
    },
    {
      name: "isArrayBufferView",
      value: "Uint8Array",
      result: types.isArrayBufferView(new Uint8Array(4)),
    },
    { name: "isTypedArray", value: "Uint8Array", result: types.isTypedArray(new Uint8Array(4)) },
    { name: "isUint8Array", value: "Uint8Array", result: types.isUint8Array(new Uint8Array(4)) },
    {
      name: "isDataView",
      value: "DataView",
      result: types.isDataView(new DataView(new ArrayBuffer(4))),
    },
    { name: "isDate", value: "Date", result: types.isDate(new Date()) },
    { name: "isRegExp", value: "/regex/", result: types.isRegExp(/regex/) },
    { name: "isMap", value: "Map", result: types.isMap(new Map()) },
    { name: "isSet", value: "Set", result: types.isSet(new Set()) },
    { name: "isMapIterator", value: "map.keys()", result: types.isMapIterator(new Map().keys()) },
    {
      name: "isSetIterator",
      value: "set.values()",
      result: types.isSetIterator(new Set().values()),
    },
    {
      name: "isGeneratorObject",
      value: "function*(){}",
      result: types.isGeneratorObject((function* () {})()),
    },
    { name: "isPromise", value: "Promise", result: types.isPromise(Promise.resolve()) },
    { name: "isWeakMap", value: "WeakMap", result: types.isWeakMap(new WeakMap()) },
    { name: "isNativeError", value: "Error", result: types.isNativeError(new Error()) },
    {
      name: "isAsyncFunction",
      value: "async () => {}",
      result: types.isAsyncFunction(async () => {}),
    },
    {
      name: "isGeneratorFunction",
      value: "function*(){}",
      result: types.isGeneratorFunction(function* () {}),
    },
    {
      name: "isBoxedPrimitive",
      value: "new Boolean(true)",
      result: types.isBoxedPrimitive(new Boolean(true)),
    },
    { name: "isKeyObject", value: "null", result: types.isKeyObject(null) },
  ];

  return jsonResponse({
    checks,
    totalFunctions: Object.keys(types).filter((k) => k.startsWith("is")).length,
    passedCount: checks.filter((c) => c.result).length,
    note: "node:util/types — 43 is* type-check functions. Bun mirrors Node.js util.types exactly. Includes MapIterator, SetIterator, GeneratorObject.",
  });
}
