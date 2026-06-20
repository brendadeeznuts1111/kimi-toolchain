/**
 * SHA3 hash showcase — WebCrypto + node:crypto (Bun 1.3.13+).
 *
 * Bun APIs: crypto.subtle.digest(), crypto.createHash(), crypto.createHmac()
 *
 * Bun v1.3.13 added SHA3-224, SHA3-256, SHA3-384, SHA3-512 support across both
 * WebCrypto and node:crypto APIs, plus BoringSSL ML-KEM/ML-DSA post-quantum libs.
 *
 * @see https://bun.com/blog/bun-v1.3.13#sha3-support-in-webcrypto-and-nodecrypto
 */

import { json } from "../lib/response.ts";

export async function apiCryptoSha3(): Promise<Response> {
  const input = "Hello, world!";
  const encoder = new TextEncoder();
  const data = encoder.encode(input);

  // WebCrypto API
  const webSha3_256 = await crypto.subtle.digest("SHA3-256", data);

  // node:crypto (lazy import for type safety)
  const { createHash, createHmac, getHashes } = await import("node:crypto");
  const nodeSha3_256 = createHash("sha3-256").update(input).digest("hex");
  const hmac = createHmac("sha3-256", "secret-key").update(input).digest("hex");

  const supported = getHashes().filter((h) => h.startsWith("sha3"));

  return json({
    input,
    webcrypto: {
      sha3_256: Buffer.from(webSha3_256).toString("hex"),
    },
    nodeCrypto: {
      sha3_256: nodeSha3_256,
      hmac_sha3_256: hmac,
    },
    supportedAlgorithms: supported,
    note: "SHA3 added in Bun v1.3.13. Also: ML-KEM and ML-DSA (NIST FIPS 203/204) in BoringSSL.",
  });
}
