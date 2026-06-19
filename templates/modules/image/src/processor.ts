// templates/modules/image/src/processor.ts
// Pure Bun-native implementation of ImageEffect
// (matches the interface defined in src/lib/symbols.ts)

async function toArrayBuffer(input: Blob | string): Promise<ArrayBuffer> {
  if (typeof input === "string") {
    return Bun.file(input).arrayBuffer();
  }
  return input.arrayBuffer();
}

/** Get image dimensions and format */
export async function metadata(
  input: Blob | string
): Promise<{ width: number; height: number; format: string }> {
  const buf = await toArrayBuffer(input);
  const img = new Bun.Image(buf);
  const { width, height, format } = img;
  return { width, height, format };
}

/** Generate a thumbhash data URL for blur‑up placeholders */
export async function placeholder(input: Blob | string): Promise<string> {
  const buf = await toArrayBuffer(input);
  const img = new Bun.Image(buf);
  return img.placeholder();
}

/** Resize to a thumbnail width, return JPEG bytes */
export async function thumbnail(input: Blob | string, width: number): Promise<Uint8Array> {
  const buf = await toArrayBuffer(input);
  const img = new Bun.Image(buf);
  const resized = img.resize({ width, fit: "inside" });
  return resized.jpeg().bytes();
}
