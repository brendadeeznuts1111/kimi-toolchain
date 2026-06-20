/**
 * File serving with Range Request support — Bun.serve() 1.3.13+.
 *
 * Bun APIs: Bun.file(), Bun.serve() range handling, Response with file-backed body
 *
 * Bun v1.3.13 added automatic Range request handling for file-backed responses:
 * - Incoming Range: bytes=... headers are automatically handled
 * - Returns 206 Partial Content with Content-Range header
 * - Suffix ranges (bytes=-500), open-ended ranges (bytes=1024-) supported
 * - Multi-range requests fall through to a full-body 200 response
 *
 * @see https://bun.com/blog/bun-v1.3.13#range-request-support-in-bunserv
 */

import { json } from "../lib/response.ts";

const SAMPLE_TEXT = `Bun v1.3.13 adds automatic Range request support for file-backed responses.

When a client sends Range: bytes=0-1023, Bun.serve() returns 206 Partial Content
with the correct Content-Range header. This is useful for video streaming, large
download resumption, and any byte-range protocol.

Suffix ranges (bytes=-500) and open-ended ranges (bytes=1024-) are also supported.
`;

/** Ensure a sample file exists for range request demos. */
async function ensureSampleFile(): Promise<string> {
  const path = "var/sample-for-range.txt";
  await Bun.mkdir("var", { recursive: true });
  try {
    await Bun.file(path).text();
  } catch {
    await Bun.write(path, SAMPLE_TEXT);
  }
  return path;
}

export async function apiFile(): Promise<Response> {
  const path = await ensureSampleFile();
  return new Response(Bun.file(path));
}

export async function apiFileInfo(): Promise<Response> {
  const path = await ensureSampleFile();
  const file = Bun.file(path);
  const stat = await file.stat().catch(() => null);
  return json({
    path,
    size: file.size,
    type: file.type,
    mtime: stat?.mtime?.toISOString() ?? null,
    note: "GET /file serves this with automatic Range request support (Bun 1.3.13+)",
    rangeDemo: [
      "curl -H 'Range: bytes=0-50' http://localhost:3000/file",
      "curl -H 'Range: bytes=-20' http://localhost:3000/file",
    ],
  });
}
