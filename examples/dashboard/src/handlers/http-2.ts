// ── HTTP/2 ────────────────────────────────────────────────────────

let h2Port = 0;
let h2Server: http2.Http2Server | null = null;

export async function apiHttp2(): Promise<Response> {
  if (!h2Server || h2Port === 0) {
    return jsonResponse({ error: "HTTP/2 server not running", note: "h2c server may have failed to start" });
  }

  return new Promise((resolve) => {
    const client = http2.connect(`http://localhost:${h2Port}`);
    let sessionInfo: Record<string, unknown> = {};

    client.on("remoteSettings", (settings) => {
      sessionInfo.remoteSettings = settings;
    });

    client.on("connect", () => {
      sessionInfo.connected = true;
      sessionInfo.alpnProtocol = (client as any).alpnProtocol ?? "h2c";
    });

    const req = client.request({ ":path": "/", ":method": "GET" });
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      sessionInfo.responseBody = body;
      client.close();
      resolve(jsonResponse({
        h2Port,
        session: sessionInfo,
        origins: ["https://example.com", "https://example.org"],
        note: "node:http2 h2c server + client. No TLS needed for local demo. origins whitelist set on server.",
      }));
    });
    req.on("error", (err: Error) => {
      client.close();
      resolve(jsonResponse({ error: err.message, h2Port }));
    });
    req.end();
  });
}

