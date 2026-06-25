// ── Node HTTP ──────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiNodeHttp(): Promise<Response> {
  const http = await import("node:http");

  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      const body = "hello from node:http";
      res.writeHead(200, {
        "Content-Length": new TextEncoder().encode(body).byteLength,
        "Content-Type": "text/plain",
        "X-Demo": "true",
      });
      res.end(body);
    });

    server.listen(0, () => {
      const port = (server.address() as any).port;

      http.get({ port, path: "/" }, (clientRes) => {
        let data = "";
        clientRes.on("data", (chunk: Buffer) => (data += chunk.toString()));
        clientRes.on("end", () => {
          server.close();
          resolve(
            jsonResponse({
              port,
              request: "GET /",
              response: {
                statusCode: clientRes.statusCode,
                statusMessage: clientRes.statusMessage,
                headers: clientRes.headers,
                body: data,
              },
              note: "node:http.createServer() — classic Node HTTP API. writeHead(status, headers) + end(body). Bun serves both Bun.serve (primary) and node:http.",
            })
          );
        });
      });
    });
  });
}
