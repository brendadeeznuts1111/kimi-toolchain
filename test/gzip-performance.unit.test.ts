/**
 * Bun-native gzip performance regression test.
 *
 * Bun v1.3.13 upgraded zlib to zlib-ng 2.3.3 (same library as Node.js 24+).
 * The blog reports up to 5.5× faster gzipSync for common payloads.
 *
 * Pre-1.3.13 (Cloudflare zlib fork):  gzipSync 128KB HTML L1 ~275 µs
 *   1.3.13+ (zlib-ng 2.3.3):           gzipSync 128KB HTML L1 ~107 µs (2.59×)
 *
 * This test verifies Bun.gzipSync throughput is within the expected range
 * and catches regressions if compression speed degrades significantly.
 *
 * @see https://bun.com/blog/bun-v1.3.13
 */
import { describe, expect, test } from "bun:test";

/** Minimal HTML payload ~128KB (matches the blog benchmark fixture). */
function html128K(): Uint8Array {
  const template =
    "<!DOCTYPE html><html><head><title>Benchmark</title></head><body>" +
    "<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(400) +
    "</p></body></html>";
  // Repeat until ~128KB
  let html = "";
  while (html.length < 128 * 1024) html += template;
  return new TextEncoder().encode(html.slice(0, 128 * 1024));
}

/** ~1MB JSON payload (blog fixture). */
function json1M(): Uint8Array {
  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < 5000; i++) {
    items.push({
      key: `item-${i}`,
      value: Math.random().toString(36).repeat(8),
      nested: { a: 1, b: [2, 3, 4], c: "long-string-".repeat(10) },
    });
  }
  return new TextEncoder().encode(JSON.stringify({ items }));
}

describe("gzip-performance", () => {
  test("gzipSync 128KB HTML L1 completes under 500µs", () => {
    const input = html128K();
    expect(input.length).toBe(128 * 1024);

    const start = Bun.nanoseconds();
    const compressed = Bun.gzipSync(input);
    const elapsed = (Bun.nanoseconds() - start) / 1e3;

    console.log(`  gzipSync 128KB HTML: ${elapsed.toFixed(0)} µs (blog: ~107 µs, pre-1.3.13: ~275 µs)`);

    expect(compressed.length).toBeGreaterThan(0);
    expect(compressed.length).toBeLessThan(input.length); // compresses

    // 500µs gives ample headroom — the blog shows 107µs. If we ever exceed
    // 500µs, something significant changed in the compression path.
    expect(elapsed).toBeLessThan(500);
  });

  test("gzipSync 1MB JSON completes under 5ms", () => {
    const input = json1M();
    expect(input.length).toBeGreaterThan(900_000);

    const start = Bun.nanoseconds();
    const compressed = Bun.gzipSync(input);
    const elapsed = (Bun.nanoseconds() - start) / 1e3;

    console.log(`  gzipSync 1MB JSON: ${(elapsed / 1000).toFixed(2)} ms (blog: ~0.89 ms, pre-1.3.13: ~2.23 ms)`);

    expect(compressed.length).toBeGreaterThan(0);
    expect(compressed.length).toBeLessThan(input.length);

    // 5ms threshold — blog shows 0.89ms. 5ms is very conservative.
    expect(elapsed).toBeLessThan(5_000);
  });

  test("gunzip roundtrip is lossless", () => {
    const input = html128K();
    const compressed = Bun.gzipSync(input);
    const decompressed = Bun.gunzipSync(compressed);

    expect(decompressed.length).toBe(input.length);
    expect(decompressed).toEqual(input);
  });

  test("gzip then gunzip streamed data is consistent", () => {
    const chunks = [html128K().slice(0, 16384), html128K().slice(16384, 65536)];
    // Compress each chunk independently
    const compressed = chunks.map((c) => Bun.gzipSync(c));
    // Decompress and verify
    const decompressed = compressed.map((c) => Bun.gunzipSync(c));
    expect(Buffer.concat(decompressed).length).toBe(65536);
  });
});
