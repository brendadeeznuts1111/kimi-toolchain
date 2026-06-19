// ── Random Bytes ───────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiRandomBytes(): Promise<Response> {
  const { randomBytes, randomFillSync } = await import("node:crypto");

  const r1 = randomBytes(16);
  const r2 = randomBytes(8);
  const buf = new Uint8Array(12);
  randomFillSync(buf);

  return jsonResponse({
    randomBytes16: r1.toString("hex"),
    randomBytes8: r2.toString("hex"),
    randomFill12: Buffer.from(buf).toString("hex"),
    note: "node:crypto.randomBytes(n) and randomFillSync(buf) — CSPRNG. Bun mirrors Node.js crypto.randomBytes exactly.",
  });
}
