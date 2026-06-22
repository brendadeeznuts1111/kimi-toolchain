/**
 * Bun-native SHA-256 hashing helpers.
 *
 * Kept in a dedicated module so heavy consumers (e.g. error-taxonomy)
 * can hash without creating circular dependencies through utils.ts.
 */

/** Compute the SHA-256 hex digest of a file. */
export async function sha256File(path: string): Promise<string> {
  const file = Bun.file(path);
  const content = await file.arrayBuffer();
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(content);
  return hash.digest("hex");
}

/** Compute the SHA-256 hex digest of a string. */
export function sha256String(data: string): string {
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(data);
  return hash.digest("hex");
}
