// ── Stream Hash ────────────────────────────────────────────────────
import { encodeHex } from "../../../../src/lib/bun-utils.ts";
import { jsonResponse } from "./shared.ts";

export async function apiStreamHash(): Promise<Response> {
  const tmpPath = `/tmp/dashboard-stream-hash-${Date.now()}.bin`;
  const testData = "hello world ".repeat(100); // 1200 bytes
  await Bun.write(tmpPath, testData);

  const streamHasher = new Bun.CryptoHasher("sha256");
  const stream = Bun.file(tmpPath).stream();
  let chunkCount = 0;
  let totalBytes = 0;
  for await (const chunk of stream) {
    chunkCount++;
    totalBytes += chunk.byteLength;
    streamHasher.update(chunk);
  }
  const streamDigest = streamHasher.digest("hex");

  const fileBytes = new Uint8Array(await Bun.file(tmpPath).arrayBuffer());
  const wholeHasher = new Bun.CryptoHasher("sha256");
  wholeHasher.update(fileBytes);
  const wholeDigest = wholeHasher.digest("hex");

  const stringHasher = new Bun.CryptoHasher("sha256");
  stringHasher.update(testData);
  const stringDigest = stringHasher.digest("hex");

  const bunHash = Bun.SHA256.hash(await Bun.file(tmpPath).arrayBuffer());
  const bunHex = encodeHex(new Uint8Array(bunHash as unknown as ArrayBuffer));

  try {
    await Bun.file(tmpPath).delete();
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
    note: "Stream: Bun.file().stream() + Bun.CryptoHasher. One-liner: Bun.SHA256.hash() then encodeHex().",
  });
}
