// ── Stream Hash ────────────────────────────────────────────────────
import { encodeHex } from "../../../../src/lib/bun-utils.ts";
import { jsonResponse } from "./shared.ts";

export async function apiStreamHash(): Promise<Response> {
  // Write a test file
  const tmpPath = `/tmp/dashboard-stream-hash-${Date.now()}.bin`;
  const testData = "hello world ".repeat(100); // 1200 bytes
  await Bun.write(tmpPath, testData);

  const { createHash } = await import("node:crypto");

  // Streaming: read via Bun.file().stream(), hash via node:crypto
  const streamHash = createHash("sha256");
  const stream = Bun.file(tmpPath).stream();
  let chunkCount = 0;
  let totalBytes = 0;
  for await (const chunk of stream) {
    chunkCount++;
    totalBytes += chunk.byteLength;
    streamHash.update(chunk); // Uint8Array → works with both Bun and Node hashers
  }
  const streamDigest = streamHash.digest("hex");

  // Non-streaming: whole-file for comparison
  const wholeHash = createHash("sha256");
  const fileBytes = new Uint8Array(await Bun.file(tmpPath).arrayBuffer());
  wholeHash.update(fileBytes);
  const wholeDigest = wholeHash.digest("hex");

  // Also string-based
  const stringHash = createHash("sha256");
  stringHash.update(testData);
  const stringDigest = stringHash.digest("hex");

  // Bun-native one-liner: Bun.SHA256.hash(arrayBuffer())
  const bunHash = Bun.SHA256.hash(await Bun.file(tmpPath).arrayBuffer());
  const bunHex = encodeHex(new Uint8Array(bunHash));

  try {
    await import("node:fs/promises").then((fs) => fs.unlink(tmpPath));
  } catch {
    /* ok */
  }

  return jsonResponse({
    fileSize: 1200,
    stream: { chunks: chunkCount, totalBytes, digest: streamDigest.slice(0, 24) + "..." },
    whole: { digest: wholeDigest.slice(0, 24) + "..." },
    string: { digest: stringDigest.slice(0, 24) + "..." },
    bunNative: {
      digest: bunHex.slice(0, 24) + "...",
      approach: "Bun.SHA256.hash(arrayBuffer()) — one-liner",
    },
    allMatch:
      streamDigest === wholeDigest && wholeDigest === stringDigest && stringDigest === bunHex,
    note: "Stream: Bun.file().stream() + node:crypto. One-liner: Bun.SHA256.hash(await file.arrayBuffer()) then encodeHex() (Uint8Array.toHex).",
  });
}
