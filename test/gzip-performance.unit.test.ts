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

function asArrayBufferBytes(bytes: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes) as Uint8Array<ArrayBuffer>;
}

/** Minimal HTML payload ~128KB (matches the blog benchmark fixture). */
function html128K(): Uint8Array<ArrayBuffer> {
  const template =
    "<!DOCTYPE html><html><head><title>Benchmark</title></head><body>" +
    "<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(400) +
    "</p></body></html>";
  // Repeat until ~128KB
  let html = "";
  while (html.length < 128 * 1024) html += template;
  return asArrayBufferBytes(new TextEncoder().encode(html.slice(0, 128 * 1024)));
}

/** ~1MB JSON payload (blog fixture). */
function json1M(): Uint8Array<ArrayBuffer> {
  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < 5000; i++) {
    items.push({
      key: `item-${i}`,
      value: Math.random().toString(36).repeat(8),
      nested: { a: 1, b: [2, 3, 4], c: "long-string-".repeat(10) },
    });
  }
  return asArrayBufferBytes(new TextEncoder().encode(JSON.stringify({ items })));
}

describe("gzip-performance", () => {
  test("gzipSync 128KB HTML L1 warm path completes under 5ms", () => {
    const input = html128K();
    expect(input.length).toBe(128 * 1024);

    // Keep this guard focused on zlib-ng throughput, not one-time native setup.
    Bun.gzipSync(input);
    const start = Bun.nanoseconds();
    const compressed = asArrayBufferBytes(Bun.gzipSync(input));
    const elapsed = (Bun.nanoseconds() - start) / 1e3;

    console.log(
      `  gzipSync 128KB HTML: ${elapsed.toFixed(0)} µs (blog: ~107 µs, pre-1.3.13: ~275 µs)`
    );

    expect(compressed.length).toBeGreaterThan(0);
    expect(compressed.length).toBeLessThan(input.length); // compresses

    // 5ms keeps this stable in fast gates on local canary/stable runtimes while
    // still catching order-of-magnitude regressions from the zlib-ng path.
    expect(elapsed).toBeLessThan(5_000);
  });

  test("gzipSync 1MB JSON completes under 25ms", () => {
    const input = json1M();
    expect(input.length).toBeGreaterThan(900_000);

    const start = Bun.nanoseconds();
    const compressed = asArrayBufferBytes(Bun.gzipSync(input));
    const elapsed = (Bun.nanoseconds() - start) / 1e3;

    console.log(
      `  gzipSync 1MB JSON: ${(elapsed / 1000).toFixed(2)} ms (blog: ~0.89 ms, pre-1.3.13: ~2.23 ms)`
    );

    expect(compressed.length).toBeGreaterThan(0);
    expect(compressed.length).toBeLessThan(input.length);

    // 25ms keeps this as a regression guard without making local CPU jitter fail the suite.
    expect(elapsed).toBeLessThan(25_000);
  });

  test("gunzip roundtrip is lossless", () => {
    const input = html128K();
    const compressed = asArrayBufferBytes(Bun.gzipSync(input));
    const decompressed = asArrayBufferBytes(Bun.gunzipSync(compressed));

    expect(decompressed.length).toBe(input.length);
    expect(decompressed).toEqual(input);
  });

  test("gzip then gunzip streamed data is consistent", () => {
    const chunks = [html128K().slice(0, 16384), html128K().slice(16384, 65536)];
    // Compress each chunk independently
    const compressed = chunks.map((c) => asArrayBufferBytes(Bun.gzipSync(c)));
    // Decompress and verify
    const decompressed = compressed.map((c) => asArrayBufferBytes(Bun.gunzipSync(c)));
    expect(Buffer.concat(decompressed).length).toBe(65536);
  });
});
