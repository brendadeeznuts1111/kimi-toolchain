// ── Set Headers ────────────────────────────────────────────────────

export async function apiSetHeaders(): Promise<Response> {
  const http = await import("node:http");

  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      const headers = new Headers();
      headers.set("Content-Type", "text/plain");
      headers.set("X-Demo", "setHeaders-works");
      headers.set("Cache-Control", "no-store");
      headers.set("X-Request-Id", "req-abc123");
      res.setHeaders(headers);
      res.end("ok");
    });

    server.listen(0, () => {
      const port = (server.address() as any).port;
      http.get({ port }, (client) => {
        let body = "";
        client.on("data", (c: Buffer) => (body += c.toString()));
        client.on("end", () => {
          server.close();
          resolve(
            jsonResponse({
              method: "res.setHeaders(headers)",
              input: "new Headers() with 4 entries",
              body,
              responseHeaders: client.headers,
              note: "node:http.ServerResponse.setHeaders() accepts Headers or Map. Replaces all matching headers at once. Effect boundary: domain receives HttpResponseEffect, never imports node:http.",
            })
          );
        });
      });
    });
  });
}

