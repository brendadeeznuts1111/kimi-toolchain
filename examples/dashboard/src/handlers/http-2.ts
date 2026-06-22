import http2 from "node:http2";
import { jsonResponse } from "./shared.ts";

let h2Port = 0;
let h2Server: http2.Http2Server | null = null;

/** Start optional h2c demo server (called once from index.ts). */
export function startHttp2DemoServer(): void {
  if (h2Server) return;
  try {
    h2Server = http2.createServer({
      origins: ["https://example.com", "https://example.org"],
      remoteCustomSettings: [0x1, 0x2, 0x3, 0x4, 0x5, 0x6],
    } as http2.ServerOptions);
    h2Server.on("stream", (stream, _headers) => {
      (stream as http2.ServerHttp2Stream).respond({
        ":status": 200,
        "content-type": "text/plain",
      });
      stream.end("ok");
    });
    h2Server.listen(0, () => {
      h2Port = (h2Server!.address() as { port: number })?.port ?? 0;
      Bun.stdout.write(`HTTP/2 h2c demo at http://localhost:${h2Port}\n`);
    });
  } catch (e) {
    Bun.stdout.write(`HTTP/2 server failed: ${e}\n`);
  }
}

export async function apiHttp2(): Promise<Response> {
  if (!h2Server || h2Port === 0) {
    return jsonResponse({
      error: "HTTP/2 server not running",
      note: "h2c server may have failed to start",
    });
  }

  return new Promise((resolve) => {
    const client = http2.connect(`http://localhost:${h2Port}`);
    const sessionInfo: Record<string, unknown> = {};

    client.on("remoteSettings", (settings) => {
      sessionInfo.remoteSettings = settings;
    });

    client.on("connect", () => {
      sessionInfo.connected = true;
      sessionInfo.alpnProtocol = (client as { alpnProtocol?: string }).alpnProtocol ?? "h2c";
    });

    const req = client.request({ ":path": "/", ":method": "GET" });
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      sessionInfo.responseBody = body;
      client.close();
      resolve(
        jsonResponse({
          h2Port,
          session: sessionInfo,
          origins: ["https://example.com", "https://example.org"],
          note: "node:http2 h2c server + client. No TLS needed for local demo.",
        })
      );
    });
    req.on("error", (err: Error) => {
      client.close();
      resolve(jsonResponse({ error: err.message, h2Port }));
    });
    req.end();
  });
}
