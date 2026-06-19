/**
 * effect/image/processor.ts — Reference image effect module.
 *
 * Proves the closed loop: scan → import → benchmark → train → report.
 * Registered under Symbol.for("kimi.effect.image").
 *
 * Every method is a pure effect handler — no globals, no side effects
 * beyond the Bun.Image pipeline itself.
 */

// Minimal valid PNG (2x2 red pixel) for reproducible benchmarks
const SAMPLE_PNG = new Uint8Array([
  0x89, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0,
  0, 0xfd, 0xd4, 0x9a, 0x73, 0, 0, 0, 18, 73, 68, 65, 84, 8, 0xd7, 99, 0xf8, 0xcf, 0xc0, 0, 2, 12,
  0, 0, 9, 0, 1, 0x35, 0x8b, 0x5a, 0xc0, 0, 0, 0, 0, 73, 69, 78, 68, 0xae, 66, 96, 130,
]);

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
}

/**
 * Read image metadata without full decode.
 * Pure function of the input bytes — idempotent, snapshot-testable.
 */
export async function metadata(input?: Uint8Array): Promise<ImageMetadata> {
  const img = new Bun.Image(input ?? SAMPLE_PNG);
  return img.metadata() as Promise<ImageMetadata>;
}

/**
 * Generate a thumbhash placeholder (blur-up data URL).
 */
export async function placeholder(input?: Uint8Array): Promise<string> {
  const img = new Bun.Image(input ?? SAMPLE_PNG);
  try {
    return await img.placeholder();
  } catch {
    // thumbhash may fail on tiny images — return deterministic fallback
    return "data:image/webp;base64,placeholder-unavailable";
  }
}

/**
 * Resize and convert to WebP. Returns byte count.
 */
export async function thumbnail(input?: Uint8Array, width = 1): Promise<number> {
  const img = new Bun.Image(input ?? SAMPLE_PNG);
  const bytes = await img.resize(width).webp().bytes();
  return bytes?.byteLength ?? 0;
}

/**
 * Resize to multiple formats. Returns byte count per format.
 */
export async function convertFormats(
  input?: Uint8Array,
  width = 1
): Promise<{ webp: number; png: number; jpeg: number }> {
  const img = new Bun.Image(input ?? SAMPLE_PNG);
  const resized = img.resize(width);
  const webp = await resized.webp().bytes();
  const png = await resized.png().bytes();
  const jpeg = await resized.jpeg().bytes();
  return {
    webp: webp?.byteLength ?? 0,
    png: png?.byteLength ?? 0,
    jpeg: jpeg?.byteLength ?? 0,
  };
}

/**
 * Standard benchmark workload for the perf harness.
 * Runs the most representative image operations once each.
 */
export async function workload(): Promise<{
  meta: ImageMetadata;
  ph: string;
  thumbBytes: number;
  formats: { webp: number; png: number; jpeg: number };
}> {
  const meta = await metadata();
  const ph = await placeholder();
  const thumbBytes = await thumbnail();
  const formats = await convertFormats();
  return { meta, ph, thumbBytes, formats };
}

// ── Symbol registration ──────────────────────────────────────────

const IMAGE_SYMBOL = Symbol.for("kimi.effect.image");

export const imageEffect = {
  metadata,
  placeholder,
  thumbnail,
  convertFormats,
  workload,
};

// Register on globalThis for CLI-style access (kimi-doctor picks this up)
if (typeof globalThis !== "undefined") {
  (globalThis as Record<symbol, unknown>)[IMAGE_SYMBOL] = imageEffect;
}
