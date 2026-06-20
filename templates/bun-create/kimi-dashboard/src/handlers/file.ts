/**
 * Bun.serve() range request showcase — byte-range support for large files.
 *
 * Bun 1.3.13+: returning `Bun.file()` from a `fetch` handler automatically
 * honours `Range` headers (HTTP 206 Partial Content). Previously this only
 * worked for static routes; now it works in dynamic handlers too.
 *
 * Bun APIs: Bun.file(), Bun.write(), Bun.serve() range support
 */

import { json } from "../lib/response.ts";

const DEMO_FILE = "var/demo-asset.json";

export async function apiFile(req: Request): Promise<Response> {
  // Ensure the demo file exists (idempotent)
  await Bun.write(
    DEMO_FILE,
    JSON.stringify({
      message: "Hello from Bun range request demo",
      rows: Array.from({ length: 100 }, (_, i) => ({ id: i, value: Math.random() })),
    })
  );

  const rangeHeader = req.headers.get("range");

  // Return the file directly — Bun handles Range → 206 automatically
  const file = Bun.file(DEMO_FILE);

  if (rangeHeader) {
    // When a Range header is present, Bun.file() responses automatically
    // return 206 Partial Content with the correct byte range.
    return new Response(file, {
      headers: {
        "content-type": "application/json",
        "accept-ranges": "bytes",
        "x-range-request": rangeHeader,
      },
    });
  }

  return json({
    note: "Add a Range header (e.g. `curl -H 'Range: bytes=0-99' ...`) to see 206 Partial Content",
    fileSize: file.size,
    filePath: DEMO_FILE,
    rangeHeader: rangeHeader ?? null,
  });
}
