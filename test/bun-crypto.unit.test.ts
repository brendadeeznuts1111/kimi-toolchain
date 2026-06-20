/**
 * Bun-native crypto performance and correctness regression test.
 *
 * Bun exposes three levels of hashing:
 *   - Bun.hash()           — fast non-cryptographic hash (FNV-1a-like)
 *   - Bun.CryptoHasher()   — streaming cryptographic hash (SHA-256, SHA-512, etc.)
 *   - Bun.password.hash() / verify() — bcrypt / argon2 password hashing
 *
 * This test verifies correctness and flags throughput regressions.
 */
import { describe, expect, test } from "bun:test";

const CHUNK_1MB = new Uint8Array(1024 * 1024);

describe("bun-hash", () => {
  test("Bun.hash produces stable output", () => {
    const a = Bun.hash("hello");
    const b = Bun.hash("hello");
    expect(a).toBe(b);
    // Bun.hash returns a bigint (not number) in Bun 1.4+
    expect(typeof a).toBe("bigint");
  });

  test("Bun.hash different inputs produce different output", () => {
    const a = Bun.hash("hello");
    const b = Bun.hash("world");
    expect(a).not.toBe(b);
  });
});

describe("bun-crypto-hasher", () => {
  test("Bun.CryptoHasher sha256 produces correct digest", () => {
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update("hello world");
    const hex = hasher.digest("hex");
    // Known SHA-256 of "hello world"
    expect(hex).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  test("Bun.CryptoHasher streaming (1MB) completes under 10ms", () => {
    const start = Bun.nanoseconds();
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(CHUNK_1MB);
    hasher.digest("hex");
    const elapsed = (Bun.nanoseconds() - start) / 1e6;
    console.log(`  CryptoHasher sha256 1MB: ${elapsed.toFixed(2)} ms`);
    expect(elapsed).toBeLessThan(10);
  });

  test("Bun.CryptoHasher sha512 produces 128 hex chars", () => {
    const hasher = new Bun.CryptoHasher("sha512");
    hasher.update("test");
    const hex = hasher.digest("hex");
    expect(hex.length).toBe(128);
  });

  test("Bun.CryptoHasher supports incremental updates", () => {
    const full = new Bun.CryptoHasher("sha256");
    full.update("hello world");

    const incremental = new Bun.CryptoHasher("sha256");
    incremental.update("hello ");
    incremental.update("world");

    expect(full.digest("hex")).toBe(incremental.digest("hex"));
  });
});

describe("bun-password", () => {
  test("Bun.password.hash and verify roundtrip", async () => {
    const hash = await Bun.password.hash("my-secret-password");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(20);

    const valid = await Bun.password.verify("my-secret-password", hash);
    expect(valid).toBe(true);

    const invalid = await Bun.password.verify("wrong-password", hash);
    expect(invalid).toBe(false);
  });

  test("Bun.password.hash with bcrypt algorithm", async () => {
    const hash = await Bun.password.hash("p4$$w0rd", "bcrypt");
    expect(typeof hash).toBe("string");
    // bcrypt hashes start with $2
    expect(hash.startsWith("$2")).toBe(true);
  });
});
