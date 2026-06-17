/**
 * Scaffold slim Bun utils — readableStreamToText canonical wrapper.
 */

export async function readableStreamToText(
  stream: ReadableStream<Uint8Array> | null | undefined
): Promise<string> {
  if (!stream) return "";
  return Bun.readableStreamToText(stream);
}
