// ── Image ──────────────────────────────────────────────────────────

export async function apiImage(): Promise<Response> {
  // Create a test PNG (2x2 red pixel, valid PNG)
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x08, 0x02, 0x00, 0x00, 0x00, 0xfd, 0xd4, 0x9a,
    0x73, 0x00, 0x00, 0x00, 0x12, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x02, 0x0c, 0x00, 0x00, 0x09, 0x00, 0x01, 0x35, 0x8b, 0x5a, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x49,
    0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);

  const img = Bun.file(png).image();
  const metadata = { width: img.width, height: img.height };

  // Resize + convert
  const thumb = img.resize(1);
  const webpBytes = await thumb.webp().bytes();
  const pngBytes = await thumb.png().bytes();

  // Metadata (no decode required)
  const meta = await img.metadata();

  return jsonResponse({
    input: { bytes: png.byteLength, width: metadata.width, height: metadata.height },
    metadata: meta,
    pipeline: [".image()", ".metadata()", ".resize(1)", ".webp().bytes()", ".png().bytes()"],
    output: {
      webp: { bytes: webpBytes?.byteLength ?? 0 },
      png: { bytes: pngBytes?.byteLength ?? 0 },
    },
    availableMethods: [
      "metadata()",
      "placeholder()",
      "resize(w)",
      "jpeg()",
      "webp()",
      "png()",
      "avif()",
      "flip()",
      "flop()",
      "rotate(deg)",
      "modulate({hue,saturation,brightness})",
      "toBase64()",
      "blob()",
      "write(path)",
    ],
    globalStore:
      "install.globalStore = true in bunfig.toml — immutable content-addressed cache, warm installs ~1 symlink/pkg",
    note: "Bun.Image — built-in image pipeline. metadata() reads dimensions without decoding. placeholder() generates thumbhash data URL for blur-up. Chain transforms, zero-copy. AsyncLocalStorage.snapshot() not yet available in v1.4.0-canary.",
  });
}
