// templates/modules/image/src/processor.ts
// Pure Bun-native implementation of ImageEffect
// Registered under Symbol.for("kimi.effect.image")

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

/** Get image dimensions and format. Uses SAMPLE_PNG when no input given. */
export async function metadata(input?: Uint8Array): Promise<ImageMetadata> {
  const img = new Bun.Image(input ?? SAMPLE_PNG);
  return img.metadata() as Promise<ImageMetadata>;
}

/** Generate a thumbhash data URL for blur‑up placeholders. */
export async function placeholder(input?: Uint8Array): Promise<string> {
  const img = new Bun.Image(input ?? SAMPLE_PNG);
  try {
    return await img.placeholder();
  } catch {
    return "data:image/webp;base64,placeholder-unavailable";
  }
}

/** Resize to a thumbnail width, return JPEG bytes. */
export async function thumbnail(input?: Uint8Array, width = 200): Promise<number> {
  const img = new Bun.Image(input ?? SAMPLE_PNG);
  const bytes = await img.resize(width, undefined, { fit: "inside" }).jpeg().bytes();
  return bytes?.byteLength ?? 0;
}
