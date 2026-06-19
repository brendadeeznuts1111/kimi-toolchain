// ── HTTP/2 h2c server (demo) ────────────────────────────────────────
try {
  h2Server = http2.createServer({
    origins: ["https://example.com", "https://example.org"],
    remoteCustomSettings: [0x1, 0x2, 0x3, 0x4, 0x5, 0x6],
  });
  h2Server.on("stream", (stream, _headers) => {
    stream.respond({ ":status": 200, "content-type": "text/plain" });
    stream.end("ok");
  });
  h2Server.listen(0, () => {
    h2Port = (h2Server!.address() as any)?.port ?? 0;
    Bun.stdout.write(`HTTP/2 h2c demo at http://localhost:${h2Port}\n`);
  });
} catch (e) {
  Bun.stdout.write(`HTTP/2 server failed: ${e}\n`);
}
