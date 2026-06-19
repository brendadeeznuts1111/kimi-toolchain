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
  // When running from the toolchain repo (examples/dashboard/), use repo root.
  // When deployed standalone, use the dashboard project directory.
  const dir = import.meta.dir;
  if (dir.includes("kimi-toolchain")) {
    return dir.split("kimi-toolchain")[0] + "kimi-toolchain";
  }
  // Standalone deployment — use current working directory
  return process.cwd();
}

function doctorBin(): string {
  // Prefer global install, fall back to repo source
  return Bun.which("kimi-doctor") || "src/bin/kimi-doctor.ts";
}

// ── API handlers ────────────────────────────────────────────────────

async function apiBundle(): Promise<Response> {
  const proc = Bun.spawn(["bun", "run", doctorBin(), "--bundle", "--json"], {
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
    ["bun", "run", doctorBin(), "--compile-check", "--json"],
    { cwd: resolveRoot(), stdout: "pipe", stderr: "pipe" }
  );
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return jsonResponse(JSON.parse(stdout));
}

async function apiGates(): Promise<Response> {
  const proc = Bun.spawn(
    ["bun", "run", doctorBin(), "--effect-gates", "--json"],
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

async function apiEnv(): Promise<Response> {
  const pathDirs = (Bun.env.PATH || "").split(":").filter(Boolean);
  const toolBins = ["kimi-fix", "kimi-doctor", "bun", "herdr", "kimi-bake"];
  const found: Record<string, string | null> = {};
  for (const bin of toolBins) found[bin] = Bun.which(bin);

  return jsonResponse({
    path: pathDirs,
    tools: found,
    keyVars: {
      HOME: Bun.env.HOME || "unset",
      KIMI_PROFILE: Bun.env.KIMI_PROFILE || "unset",
      BUN_CREATE_DIR: Bun.env.BUN_CREATE_DIR || "unset",
      HERDR_ENV: Bun.env.HERDR_ENV || "unset",
      PORT: Bun.env.PORT || "unset",
    },
  });
}

async function apiConsoleDepth(): Promise<Response> {
  const nested = { a: { b: { c: { d: "deep", e: [{ x: 1, y: { z: "nested-array" } }] } } } };

  // Run at depth 2 (default) and depth 4 (configured) via separate bun processes
  const depth2 = Bun.spawn(["bun", "-e", `console.log(JSON.stringify(${JSON.stringify(nested)}, null, 2))`], {
    stdout: "pipe", stderr: "pipe",
  });
  // We can't change depth programmatically in the same process — just show the structure
  const depth2Out = await new Response(depth2.stdout).text();
  await depth2.exited;

  return jsonResponse({
    configuredDepth: 4,
    sample: { depth2: "shows up to 2 levels", depth4: "shows up to 4 levels (current)", _raw: nested },
    note: "Set via bunfig.toml console.depth = 4. Override with --console-depth <N>",
  });
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
      case "/api/console-depth":
        return apiConsoleDepth();
      case "/api/env":
        return apiEnv();
      case "/health":
        return new Response("ok");
      default:
        return new Response("Not Found", { status: 404 });
    }
  },
});

console.log(`Dashboard running at http://localhost:${server.port}`);
