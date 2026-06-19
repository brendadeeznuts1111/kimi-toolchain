/**
 * Crypto + UUID showcase — hashing and time-ordered UUIDs.
 *
 * Bun APIs: Bun.CryptoHasher, Bun.randomUUIDv7(), Bun.nanoseconds()
 */

import { json } from "../lib/response.ts";

export async function apiCrypto(): Promise<Response> {
  const hash = new Bun.CryptoHasher("sha256");
  hash.update("hello world");
  return json({
    sha256: hash.digest("hex"),
    uuid: Bun.randomUUIDv7(),
    nanosec: Number(Bun.nanoseconds()),
  });
}
