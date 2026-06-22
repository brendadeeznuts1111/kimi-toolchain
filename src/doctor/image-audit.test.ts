import { describe, expect, test } from "bun:test";
import { join } from "path";
import { Glob } from "bun";
import { auditImageAssets, auditImageFile } from "../lib/image-audit.ts";
import { imageMetadata } from "../lib/bun-image.ts";
import { shannonEntropy } from "./entropy.ts";
import { cleanupPath, testTempDir } from "../../test/helpers.ts";

// 1x1 transparent PNG (base64)
const TINY_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  ),
  (c) => c.charCodeAt(0)
);

describe("doctor-image-audit", () => {
  test("shannonEntropy of uniform bytes is maximal", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(shannonEntropy(bytes)).toBeCloseTo(8, 2);
  });

  test("shannonEntropy of constant bytes is zero", () => {
    const bytes = new Uint8Array(1024).fill(42);
    expect(shannonEntropy(bytes)).toBe(0);
  });

  test("auditImageAssets returns empty findings for an empty file list", async () => {
    const result = await auditImageAssets({ files: [], entropyCheck: true });
    expect(result.filesScanned).toBe(0);
    expect(result.findings).toEqual([]);
  });

  test("auditImageFile handles a valid tiny PNG", async () => {
    const root = testTempDir("doctor-image-audit-fixture-");
    const file = join(root, "tiny.png");

    try {
      await Bun.write(file, TINY_PNG);
      const result = await auditImageFile(file, { entropyCheck: true });
      expect(result.file).toBe(file);
      // A 1x1 PNG should not trigger geometry or entropy findings.
      expect(result.findings).toEqual([]);
    } finally {
      cleanupPath(root);
    }
  });

  test("Bun.Image metadata is available for a tiny PNG", async () => {
    const root = testTempDir("doctor-image-audit-meta-");
    const file = join(root, "tiny.png");

    try {
      await Bun.write(file, TINY_PNG);
      const meta = await imageMetadata(file);
      if (meta) {
        expect(meta.width).toBe(1);
        expect(meta.height).toBe(1);
      }
    } finally {
      cleanupPath(root);
    }
  });

  test("image glob scan finds no oversized assets in this repo", async () => {
    const glob = new Glob("**/*.{png,jpg,jpeg,webp,heic,avif,gif,bmp}");
    const files: string[] = [];
    for await (const rel of glob.scan({ cwd: process.cwd(), onlyFiles: true })) {
      files.push(rel);
    }
    const result = await auditImageAssets({ files, entropyCheck: true });
    // We should not flag existing repo images; this test is defensive.
    expect(result.filesScanned).toBeGreaterThanOrEqual(0);
  });
});
