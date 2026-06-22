/**
 * WebCrypto SHA3 showcase — Bun 1.3.13+ added SHA3 via WebCrypto.
 *
 * Bun APIs: crypto.subtle.digest() with SHA3-256, SHA3-384, SHA3-512
 */

import { json } from "../lib/response.ts";

async function sha3(
  algorithm: "SHA3-256" | "SHA3-384" | "SHA3-512",
  data: Uint8Array
): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, Uint8Array.from(data));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function apiCryptoSha3(): Promise<Response> {
  const input = new TextEncoder().encode("hello world");

  const [sha3_256, sha3_384, sha3_512] = await Promise.all([
    sha3("SHA3-256", input),
    sha3("SHA3-384", input),
    sha3("SHA3-512", input),
  ]);

  return json({
    input: "hello world",
    sha3_256,
    sha3_384,
    sha3_512,
  });
}
