/**
 * Bun.inspect() showcase — default vs configured depth/sort/compact.
 *
 * Bun APIs: Bun.inspect(), Bun.stringWidth()
 */

import { json } from "../lib/response.ts";

export async function apiInspect(): Promise<Response> {
  const obj = { nested: { a: 1, b: { c: [1, 2, 3] } }, items: ["x", "y", "z"] };
  return json({
    default: Bun.inspect(obj),
    configured: Bun.inspect(obj, { depth: 4, sorted: true, compact: false }),
    stringWidth: Bun.stringWidth(Bun.inspect(obj)),
  });
}
