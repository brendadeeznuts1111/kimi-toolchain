/**
 * Local file-backed HTTP server for streaming + Range benchmarks.
 */

import { join } from "path";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__", "file-bench");
const PAYLOAD_PATH = join(FIXTURE_DIR, "payload.bin");

export interface FileBenchServer {
  readonly url: string;
  readonly filePath: string;
  readonly fileSize: number;
  stop(): void;
}

let active: FileBenchServer | null = null;

async function ensurePayload(): Promise<void> {
  const file = Bun.file(PAYLOAD_PATH);
  if (await file.exists()) return;
  const payload = new Uint8Array(65_536);
  for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;
  await Bun.write(PAYLOAD_PATH, payload);
}

/** Start or reuse a localhost server that streams a fixed payload via Bun.file. */
export async function getFileBenchServer(): Promise<FileBenchServer> {
  if (active) return active;

  await ensurePayload();
  const payload = Bun.file(PAYLOAD_PATH);
  const fileSize = payload.size;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path !== "/file") return new Response("not found", { status: 404 });
      return new Response(Bun.file(PAYLOAD_PATH), {
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Type": "application/octet-stream",
        },
      });
    },
  });

  active = {
    url: server.url.href,
    filePath: PAYLOAD_PATH,
    fileSize,
    stop() {
      server.stop();
      active = null;
    },
  };

  return active;
}

export function stopFileBenchServers(): void {
  active?.stop();
}

export async function benchFileServeFull(server: FileBenchServer): Promise<void> {
  const res = await fetch(new URL("/file", server.url));
  if (!res.ok) throw new Error(`file.serve-full: status ${res.status}`);
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.length !== server.fileSize) {
    throw new Error(`file.serve-full: expected ${server.fileSize} bytes, got ${body.length}`);
  }
}

export async function benchFileServeRange(server: FileBenchServer): Promise<void> {
  const res = await fetch(new URL("/file", server.url), {
    headers: { Range: "bytes=0-1023" },
  });
  if (res.status !== 206) {
    throw new Error(`file.serve-range: expected 206, got ${res.status}`);
  }
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.length !== 1024) {
    throw new Error(`file.serve-range: expected 1024 bytes, got ${body.length}`);
  }
}