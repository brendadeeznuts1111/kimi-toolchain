/**
 * examples/dashboard — Demo app showcasing kimi-toolchain features.
 *
 * Serves a single-page dashboard that displays:
 * - Bundle analysis    (kimi-doctor --bundle)
 * - Compile check      (kimi-doctor --compile-check)
 * - Gate health        (kimi-doctor --effect-gates)
 * - Markdown rendering (Bun.markdown.html)
 *
 * Start: bun run src/index.ts
 * Open:  http://localhost:3000
 */

const port = Number(Bun.env.PORT) || 3000;

function resolveRoot(): string {
  const dir = import.meta.dir;
  return dir.replace("/examples/dashboard/src", "");
}

// ── API handlers ────────────────────────────────────────────────────

async function apiBundle(): Promise<Response> {
  const proc = Bun.spawn(["bun", "run", "src/bin/kimi-doctor.ts", "--bundle", "--json"], {
    cwd: resolveRoot(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return jsonResponse(JSON.parse(stdout));
}

async function apiCompile(): Promise<Response> {
  const proc = Bun.spawn(
    ["bun", "run", "src/bin/kimi-doctor.ts", "--compile-check", "--json"],
    { cwd: resolveRoot(), stdout: "pipe", stderr: "pipe" }
  );
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return jsonResponse(JSON.parse(stdout));
}

async function apiGates(): Promise<Response> {
  const proc = Bun.spawn(
    ["bun", "run", "src/bin/kimi-doctor.ts", "--effect-gates", "--json"],
    { cwd: resolveRoot(), stdout: "pipe", stderr: "pipe" }
  );
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return jsonResponse(JSON.parse(stdout));
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function apiSecrets(): Promise<Response> {
  const available = typeof Bun.secrets === "object" && Bun.secrets !== null;
  const methods = {
    get: typeof Bun.secrets?.get === "function",
    set: typeof Bun.secrets?.set === "function",
    delete: typeof Bun.secrets?.delete === "function",
  };
  return jsonResponse({ available, methods, note: "scoped per user namespace (macOS Keychain / Windows Credential Manager)" });
}

// ── Server ──────────────────────────────────────────────────────────

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    switch (url.pathname) {
      case "/":
        return new Response(Bun.file(import.meta.dir + "/dashboard.html"), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      case "/api/bundle":
        return apiBundle();
      case "/api/compile":
        return apiCompile();
      case "/api/gates":
        return apiGates();
      case "/api/secrets":
        return apiSecrets();
      case "/health":
        return new Response("ok");
      default:
        return new Response("Not Found", { status: 404 });
    }
  },
});

console.log(`Dashboard running at http://localhost:${server.port}`);
