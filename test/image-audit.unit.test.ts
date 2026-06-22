import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  auditImageAssets,
  auditImageFile,
  scanHeaderForSecrets,
  shannonEntropy,
} from "../src/lib/image-audit.ts";
import { cleanupPath, testTempDir } from "./helpers.ts";

// 1x1 transparent PNG (base64)
const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  ),
  (c) => c.charCodeAt(0)
);

describe("image-audit", () => {
  test("shannonEntropy of uniform bytes is maximal", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(shannonEntropy(bytes)).toBeCloseTo(8, 2);
  });

  test("scanHeaderForSecrets detects credential-like substrings", () => {
    const bytes = new TextEncoder().encode("header api_key=sk_live_xyz footer");
    const hits = scanHeaderForSecrets(bytes);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.toLowerCase().includes("api_key"))).toBe(true);
  });

  test("auditImageAssets returns empty findings for an empty file list", async () => {
    const result = await auditImageAssets({ files: [], entropyCheck: true });
    expect(result.filesScanned).toBe(0);
    expect(result.findings).toEqual([]);
  });

  test("auditImageFile handles a valid tiny PNG", async () => {
    const root = testTempDir("image-audit-fixture-");
    const file = join(root, "tiny.png");

    try {
      await Bun.write(file, TINY_PNG);
      const result = await auditImageFile(file, { entropyCheck: true });
      expect(result.file).toBe(file);
      // If Bun.Image is unavailable, the audit short-circuits with no findings.
      // If available, a 1x1 PNG should not trigger geometry/entropy findings.
      expect(result.findings).toEqual([]);
    } finally {
      cleanupPath(root);
    }
  });
});
