import { describe, expect, test } from "bun:test";
import {
  autoCompress,
  benchmarkAll,
  compressDeflate,
  compressGzip,
  compressZstd,
  decompressDeflate,
  decompressGzip,
  decompressZstd,
  detectFormat,
  exportAuditReport,
  parseAuditReport,
} from "../src/lib/compression.ts";

const textDecoder = new TextDecoder();

describe("compression", () => {
  test("round-trips gzip, deflate, and zstd payloads", () => {
    const text = "hello world ".repeat(128);

    expect(textDecoder.decode(decompressGzip(compressGzip(text)))).toBe(text);
    expect(textDecoder.decode(decompressDeflate(compressDeflate(text)))).toBe(text);
    expect(textDecoder.decode(decompressZstd(compressZstd(text)))).toBe(text);
  });

  test("detects compressed formats", () => {
    const text = "format detection ".repeat(32);

    expect(detectFormat(compressGzip(text))).toBe("gzip");
    expect(detectFormat(compressZstd(text))).toBe("zstd");
    expect(detectFormat(compressDeflate(text))).toBe("unknown");
    expect(detectFormat(compressDeflate(text, "STREAM"))).toBe("unknown");
    expect(detectFormat(new Uint8Array([1, 2, 3]))).toBe("unknown");
  });

  test("autoCompress chooses gzip for small inputs and returns metrics", () => {
    const result = autoCompress("small payload", "balanced");

    expect(result.algorithm).toBe("gzip");
    expect(result.preset).toBe("BALANCED");
    expect(result.compressed.length).toBeGreaterThan(0);
    expect(result.ratio).toBeGreaterThan(0);
    expect(result.ns).toBeGreaterThanOrEqual(0);
  });

  test("benchmarks all configured algorithm presets", () => {
    const rows = benchmarkAll("benchmark payload ".repeat(128));

    expect(rows.map((row) => `${row.algorithm}:${row.preset}`)).toEqual([
      "gzip:BALANCED",
      "deflate:BALANCED",
      "zstd:BALANCED",
      "zstd:FAST",
      "gzip:STREAM",
    ]);
    expect(rows.every((row) => row.outputBytes > 0)).toBe(true);
  });

  test("exports and parses audit reports across algorithms", () => {
    const findings = [{ id: "finding-1", ok: true }];

    for (const algorithm of ["gzip", "deflate", "zstd"] as const) {
      const report = parseAuditReport(exportAuditReport(findings, algorithm));
      expect(report.findings).toEqual(findings);
      expect(report.meta.service).toBe("unknown");
      expect(report.meta.version).toBeDefined();
    }
  });
});
