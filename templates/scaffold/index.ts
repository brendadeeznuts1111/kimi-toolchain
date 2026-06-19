/**
 * Entry point — minimal Bun HTTP server.
 * Port: auto-assign (0). Override with PORT env var.
 */
const port = Number(Bun.env.PORT) || 0;

console.log(`Starting on port ${port === 0 ? "auto-assign" : port}...`);

Bun.serve({
  port,
  fetch(req: Request): Response {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    return new Response("Hello from Bun!");
  },
});

console.log(`Server listening on port ${port}`);
