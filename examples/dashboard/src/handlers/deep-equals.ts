// ── Deep Equals ────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiDeepEquals(): Promise<Response> {
  const cases = [
    {
      a: { x: 1, y: [2, 3] },
      b: { x: 1, y: [2, 3] },
      equal: Bun.deepEquals({ x: 1, y: [2, 3] }, { x: 1, y: [2, 3] }),
    },
    { a: { x: 1 }, b: { x: 1, y: 2 }, equal: Bun.deepEquals({ x: 1 }, { x: 1, y: 2 }) },
    { a: [1, 2, 3], b: [1, 2, 3], equal: Bun.deepEquals([1, 2, 3], [1, 2, 3]) },
    {
      a: new Uint8Array([1, 2]),
      b: new Uint8Array([1, 2]),
      equal: Bun.deepEquals(new Uint8Array([1, 2]), new Uint8Array([1, 2])),
    },
    { a: new Date(0), b: new Date(0), equal: Bun.deepEquals(new Date(0), new Date(0)) },
    { a: NaN, b: NaN, equal: Bun.deepEquals(NaN, NaN) },
  ];

  return jsonResponse({
    cases,
    note: "Bun.deepEquals — structural deep equality. Handles TypedArrays, Dates, NaN, nested objects.",
  });
}
