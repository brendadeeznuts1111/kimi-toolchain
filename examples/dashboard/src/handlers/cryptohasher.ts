// ── CryptoHasher ───────────────────────────────────────────────────

export async function apiCryptoHash(): Promise<Response> {
  // SHA-256 incremental
  const sha256 = new Bun.CryptoHasher("sha256");
  sha256.update("hello ");
  sha256.update("world");

  // SHA-512 one-shot
  const sha512 = new Bun.CryptoHasher("sha512");
  sha512.update("hello world");

  // Bytes output
  const sha256bytes = new Bun.CryptoHasher("sha256");
  sha256bytes.update("hello world");

  return jsonResponse({
    sha256: { input: "'hello ' + 'world'", incremental: true, hex: sha256.digest("hex") },
    sha512: { input: "'hello world'", hex: sha512.digest("hex").slice(0, 32) + "..." },
    bytes: { input: "'hello world'", length: sha256bytes.digest().byteLength },
    algorithms: ["sha256", "sha384", "sha512", "sha512_256", "sha1"],
    note: "Bun.CryptoHasher — incremental hashing. update() multiple times, digest('hex'|'base64'|buffer) to finalize.",
  });
}

