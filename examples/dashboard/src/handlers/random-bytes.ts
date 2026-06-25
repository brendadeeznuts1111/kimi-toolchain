// ── Random Bytes ───────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiRandomBytes(): Promise<Response> {
  const r1 = new Uint8Array(16);
  const r2 = new Uint8Array(8);
  const buf = new Uint8Array(12);
  crypto.getRandomValues(r1);
  crypto.getRandomValues(r2);
  crypto.getRandomValues(buf);

  return jsonResponse({
    randomBytes16: r1.toHex(),
    randomBytes8: r2.toHex(),
    randomFill12: buf.toHex(),
    note: "crypto.getRandomValues(Uint8Array) — Web Crypto CSPRNG. Bun-native; no node:crypto.",
  });
}
