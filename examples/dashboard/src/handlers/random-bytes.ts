// ── Random Bytes ───────────────────────────────────────────────────
import { encodeHex } from "../../../../src/lib/bun-utils.ts";
import { jsonResponse } from "./shared.ts";

export async function apiRandomBytes(): Promise<Response> {
  const r1 = new Uint8Array(16);
  const r2 = new Uint8Array(8);
  const buf = new Uint8Array(12);
  crypto.getRandomValues(r1);
  crypto.getRandomValues(r2);
  crypto.getRandomValues(buf);

  return jsonResponse({
    randomBytes16: encodeHex(r1),
    randomBytes8: encodeHex(r2),
    randomFill12: encodeHex(buf),
    note: "crypto.getRandomValues(Uint8Array) — Web Crypto CSPRNG. Bun-native; no node:crypto.",
  });
}
