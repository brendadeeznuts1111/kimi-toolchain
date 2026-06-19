/**
 * {{name}} — Bun-native HTTP dashboard scaffolded from kimi-toolchain.
 *
 * Start: bun run dev
 * Open:  http://localhost:3000
 */

const port = Number(Bun.env.PORT) || 3000;

// ── Helpers ────────────────────────────────────────────────────────

function json(data: unknown): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// ── Endpoints ──────────────────────────────────────────────────────

async function apiHealth(): Promise<Response> {
  return json({
    runtime: "bun",
    version: Bun.version,
    revision: Bun.revision,
    pid: process.pid,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
}

async function apiInspect(): Promise<Response> {
  const obj = { nested: { a: 1, b: { c: [1, 2, 3] } }, items: ["x", "y", "z"] };
  return json({
    default: Bun.inspect(obj),
    configured: Bun.inspect(obj, { depth: 4, sorted: true, compact: false }),
    stringWidth: Bun.stringWidth(Bun.inspect(obj)),
  });
}

async function apiEnv(): Promise<Response> {
  return json({
    NODE_ENV: Bun.env.NODE_ENV ?? "unset",
    HOME: Bun.env.HOME ?? "unset",
    PATH: (Bun.env.PATH ?? "").split(":").slice(0, 5),
    bunfig: Bun.TOML.parse(
      (await Bun.file("./bunfig.toml")
        .text()
        .catch(() => "")) || "[install]"
    ),
  });
}

async function apiCrypto(): Promise<Response> {
  const hash = new Bun.CryptoHasher("sha256");
  hash.update("hello world");
  return json({
    sha256: hash.digest("hex"),
    uuid: Bun.randomUUIDv7(),
    nanosec: Number(Bun.nanoseconds()),
  });
}

// ── Server ──────────────────────────────────────────────────────────

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    switch (url.pathname) {
      case "/":
        return new Response("{{name}} — Bun Dashboard\n", {
          headers: { "content-type": "text/plain" },
        });
      case "/health":
        return apiHealth();
      case "/inspect":
        return apiInspect();
      case "/env":
        return apiEnv();
      case "/crypto":
        return apiCrypto();
      default:
        return new Response("Not Found", { status: 404 });
    }
  },
});

console.log(`{{name}} running at http://localhost:${port}`);
