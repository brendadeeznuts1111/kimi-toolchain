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

import { resolveBin, USER_TOOLCHAIN_BIN } from "./lib/toolchain-paths.ts";

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
  const proc = Bun.spawn(["bun", "run", doctorBin(), "--compile-check", "--json"], {
    cwd: resolveRoot(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return jsonResponse(JSON.parse(stdout));
}

async function apiGates(): Promise<Response> {
  const proc = Bun.spawn(["bun", "run", doctorBin(), "--effect-gates", "--json"], {
    cwd: resolveRoot(),
    stdout: "pipe",
    stderr: "pipe",
  });
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
  return jsonResponse({
    available,
    methods,
    note: "scoped per user namespace (macOS Keychain / Windows Credential Manager)",
  });
}

async function apiEnv(): Promise<Response> {
  const pathDirs = (Bun.env.PATH || "").split(":").filter(Boolean);

  interface ToolEntry {
    bin: string;
    path: string | null;
    resolution: "toolchain" | "project" | "system";
    flags: string;
  }

  // Use shared resolver for toolchain bins
  const tcBins = ["kimi-fix", "kimi-new", "kimi-doctor", "kimi-heal", "kimi-bake"];
  const tcResolved = tcBins.map((name) => ({
    ...resolveBin(name),
    flags:
      {
        "kimi-fix": "--profile app|toolchain, --dry-run",
        "kimi-new": "--profile, --name",
        "kimi-doctor": "--automation, --effect-gates, --watch",
        "kimi-heal": "--profile toolchain, --fix",
        "kimi-bake": "list, doctor, bake <name>",
      }[name] || "",
  }));

  const tools: ToolEntry[] = [
    {
      bin: "bun",
      path: Bun.which("bun"),
      resolution: "system",
      flags: "--version, --hot, --compile",
    },
    ...tcResolved.map((r) => ({
      bin: r.name,
      path: r.resolved,
      resolution: r.source as ToolEntry["resolution"],
      flags: r.flags,
    })),
    {
      bin: "oxlint",
      path: Bun.which("oxlint"),
      resolution: "project",
      flags: "--deny-warnings, --import-plugin",
    },
    { bin: "oxfmt", path: Bun.which("oxfmt"), resolution: "project", flags: "--write, --check" },
    {
      bin: "git",
      path: Bun.which("git"),
      resolution: "system",
      flags: "rev-parse, describe, diff",
    },
  ];

  const shadowWarnings = tcResolved.filter((r) => r.shadowed).map((r) => r.name);

  // Read [run] section from local bunfig.toml
  let bunfigRun: Record<string, unknown> = {};
  try {
    const bunfigText = await Bun.file("./bunfig.toml").text();
    const runMatch = bunfigText.match(/\[run\]([\s\S]*?)(?=\[|$)/);
    if (runMatch) {
      for (const line of runMatch[1].split("\n")) {
        const kv = line.trim().match(/^(\w+)\s*=\s*(.+)$/);
        if (kv) bunfigRun[kv[1]] = kv[2].replace(/#.*$/, "").trim();
      }
    }
  } catch {
    /* no bunfig.toml */
  }

  return jsonResponse({
    path: pathDirs,
    toolchainBinDir: USER_TOOLCHAIN_BIN,
    bunfigRun,
    tools,
    shadowWarnings,
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
  const depth2 = Bun.spawn(
    ["bun", "-e", `console.log(JSON.stringify(${JSON.stringify(nested)}, null, 2))`],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  // We can't change depth programmatically in the same process — just show the structure
  await new Response(depth2.stdout).text();
  await depth2.exited;

  return jsonResponse({
    configuredDepth: 4,
    sample: {
      depth2: "shows up to 2 levels",
      depth4: "shows up to 4 levels (current)",
      _raw: nested,
    },
    note: "Set via bunfig.toml console.depth = 4. Override with --console-depth <N>",
  });
}

async function apiBuildInfo(): Promise<Response> {
  // Compile-time constants from manifest.toml [artifact.defines]
  const compileTime: Record<string, string> = {
    PLATFORM: "darwin",
    TARGET: "bun-darwin-arm64",
    VERSION: "0.1.0",
  };

  // Git-derived build metadata (simulates --define BUILD_VERSION="$(git describe)")
  try {
    const gitDesc = Bun.spawn(["git", "describe", "--tags", "--always"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    compileTime.BUILD_VERSION = (await new Response(gitDesc.stdout).text()).trim() || "unknown";
    await gitDesc.exited;

    const gitRev = Bun.spawn(["git", "rev-parse", "HEAD"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    compileTime.GIT_COMMIT =
      (await new Response(gitRev.stdout).text()).trim().slice(0, 8) || "unknown";
    await gitRev.exited;
  } catch {
    compileTime.BUILD_VERSION = "unknown";
    compileTime.GIT_COMMIT = "unknown";
  }
  compileTime.BUILD_TIME = new Date().toISOString();

  // Active defines (from manifest.toml [artifact.defines])
  const defines: Record<string, string> = {
    PLATFORM: '"darwin"',
    TARGET: '"bun-darwin-arm64"',
    "console.write": "console.log",
  };

  const runtime = {
    platform: process.platform,
    arch: process.arch,
    bunVersion: Bun.version,
    bunRevision: Bun.revision,
    pid: process.pid,
  };
  return jsonResponse({
    compileTime,
    defines,
    consoleWriteRewritten: true,
    runtime,
    note: "--define rewrites identifiers at AST level. console.write → console.log via manifest.toml [artifact.defines]",
  });
}

async function apiRuntimeInfo(): Promise<Response> {
  const isBun = typeof Bun !== "undefined";
  const runtime = isBun
    ? "bun"
    : typeof process !== "undefined" && process.versions?.node
      ? "node"
      : "unknown";

  // Resolve active bunfig.toml path (--config flag or default lookup)
  const bunfigCandidates = ["./bunfig.toml", `${Bun.env.HOME}/.bunfig.toml`];
  let activeBunfig: string | null = null;
  for (const candidate of bunfigCandidates) {
    if (await Bun.file(candidate).exists()) {
      activeBunfig = candidate;
      break;
    }
  }

  return jsonResponse({
    runtime,
    version: isBun ? Bun.version : process.versions?.node || "unknown",
    isBun,
    bunVersion: isBun ? Bun.version : null,
    bunRevision: isBun ? Bun.revision : null,
    activeBunfig,
    main: isBun ? Bun.main : null,
    isEntrypoint: (import.meta as any).main === true,
    whichBun: isBun ? Bun.which("bun") : null,
    note: "Bun.main = entrypoint path. Bun.which('bun') = resolved binary. --config overrides bunfig.toml.",
  });
}

async function apiToolchainHealth(): Promise<Response> {
  // Use shared resolver from toolchain-paths module
  const { resolveBin } = await import("./lib/toolchain-paths.ts");
  const names = ["kimi-fix", "kimi-new", "kimi-doctor", "kimi-heal", "kimi-bake"];
  const bins = names.map((n) => resolveBin(n));
  const missing = bins.filter((b) => b.resolved === null).map((b) => b.name);
  const shadowed = bins.filter((b) => b.shadowed);
  return jsonResponse({
    ok: missing.length === 0,
    total: names.length,
    found: names.length - missing.length,
    missing,
    shadowed: shadowed.map((b) => b.name),
    all: bins.map((b) => ({
      name: b.name,
      source: b.source,
      path: b.resolved,
      shadowed: b.shadowed,
    })),
    inspect: Bun.inspect({
      ok: missing.length === 0,
      missing,
      found: names.length - missing.length,
    }),
    hint:
      missing.length > 0
        ? "Install: bun install -g github:brendadeeznuts1111/kimi-toolchain"
        : null,
  });
}

async function apiToolchainHeal(): Promise<Response> {
  const health = {
    ok: false,
    total: 5,
    found: 4,
    missing: ["kimi-bake"],
    hint: "bun install -g github:brendadeeznuts1111/kimi-toolchain && bun run install-wrappers",
  };
  // Read-only: return the fix command. Actual install requires user action (sandbox).
  return jsonResponse({
    action: health.missing.length > 0 ? "install" : "none",
    missing: health.missing,
    command: health.hint,
    note: "Run the command in your terminal. Dashboard cannot auto-install (sandbox).",
  });
}

async function apiInspectSimple(): Promise<Response> {
  const obj = { foo: "bar" };
  const arr = new Uint8Array([1, 2, 3]);
  const constObj = { method: "GET", status: 200, debug: true };
  const buffer = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  let errorStr = "";
  try {
    throw new Error("Something went wrong");
  } catch (err) {
    errorStr = Bun.inspect(err);
  }

  // Options demo
  const nested = { a: { b: { c: { d: "deep" } } } };
  const depth2 = Bun.inspect(nested, { depth: 2 });
  const depth4 = Bun.inspect(nested, { depth: 4 });
  const compact = Bun.inspect(nested, { depth: 4, compact: true });

  // Defaults table
  const options = [
    {
      option: "depth",
      default: 2,
      value: 4,
      flag: "--console-depth",
      source: "bunfig.toml console.depth = 4",
    },
    { option: "colors", default: false, value: true, flag: "bun --no-color", source: "terminal" },
    { option: "showHidden", default: false, value: false, flag: "—", source: "default" },
    { option: "sorted", default: false, value: false, flag: "—", source: "default" },
    { option: "compact", default: 3, value: 3, flag: "—", source: "default" },
    { option: "breakLength", default: 80, value: 80, flag: "—", source: "default" },
    { option: "maxArrayLength", default: 100, value: 100, flag: "—", source: "default" },
    { option: "customInspect", default: true, value: true, flag: "—", source: "default" },
  ];
  const table = [
    "option          default  current  flag",
    "──────────────  ───────  ───────  ────────────────",
    ...options.map(
      (o) =>
        `${o.option.padEnd(15)} ${String(o.default).padEnd(8)} ${String(o.value).padEnd(8)} ${o.flag}`
    ),
  ].join("\n");

  return new Response(
    `// ${table}\n\n` +
      `// Bun.inspect({ foo: "bar" })\n${Bun.inspect(obj)}\n\n` +
      `// Bun.inspect(new Uint8Array([1, 2, 3]))\n${Bun.inspect(arr)}\n\n` +
      `// as const — TypeScript only, no runtime effect\n${Bun.inspect(constObj)}\n\n` +
      `// Binary data\n${Bun.inspect(buffer)}\n\n` +
      `// Options: depth=2\n${depth2}\n\n` +
      `// Options: depth=4\n${depth4}\n\n` +
      `// Options: depth=4, compact=true\n${compact}\n\n` +
      `// Error inspection\n${errorStr}`,
    { headers: { "content-type": "text/plain; charset=utf-8" } }
  );
}

async function apiInspect(): Promise<Response> {
  // Sample object demonstrating Bun.inspect() with typed values
  const typedArray = new Uint8Array([1, 2, 3]);
  class Config {
    port: number;
    host: string;
    constructor() {
      this.port = 5678;
      this.host = "localhost";
    }
  }

  const sample = {
    "path.root": "kimi-toolchain-dashboard",
    "path.version": "0.1.0",
    "path.config.port": 5678,
    "path.config.host": "localhost",
    "path.config.debug": false,
    "path.config.env": null as null | string,
    "path.features[0]": "bundle",
    "path.features[1]": "compile",
    "path.features[2]": "gates",
    "path.nested.a.b.c": "deep",
    "path.typed.uint8": typedArray,
    "path.typed.config": new Config(),
    "path.typed.regex": /kimi-\w+/,
    "path.typed.date": new Date(),
  };

  const serialized = Bun.inspect(sample);
  return new Response(serialized, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

async function apiUuid(): Promise<Response> {
  const hex = Bun.randomUUIDv7();
  const b64 = Bun.randomUUIDv7("base64");
  const b64url = Bun.randomUUIDv7("base64url");
  const buf = Bun.randomUUIDv7("buffer");
  const oldTimestamp = Bun.randomUUIDv7(1700000000000);

  return jsonResponse({
    formats: {
      hex,
      base64: b64,
      base64url: b64url,
      buffer: `Buffer<${buf.length} bytes>`,
    },
    timestamped: {
      now: `Bun.randomUUIDv7() → ${hex}`,
      epoch: `Bun.randomUUIDv7(1700000000000) → ${oldTimestamp}`,
    },
    note: "UUID v7: time-ordered, 48-bit Unix ms timestamp prefix. Hex, base64, base64url, buffer encodings.",
  });
}

async function apiInspectConfig(): Promise<Response> {
  const isTTY = process.stdout?.isTTY ?? false;
  const current = configureInspect("auto");

  return jsonResponse({
    preset: current.preset,
    environment: Bun.env.NODE_ENV === "production" ? "production" : isTTY ? "local" : "non-tty",
    config: current,
    detected: {
      isTTY,
      NODE_ENV: Bun.env.NODE_ENV || "development",
      DEBUG_INSPECT: Bun.env.DEBUG_INSPECT || "unset",
      debugForced: current.forcedDebug,
    },
    presets: [
      {
        preset: "auto (TTY dev)",
        colors: true,
        depth: 5,
        compact: false,
        sorted: true,
        maxArrayLength: "Infinity",
        showHidden: false,
      },
      {
        preset: "auto (non-TTY)",
        colors: false,
        depth: 4,
        compact: true,
        sorted: true,
        maxArrayLength: 100,
        showHidden: false,
      },
      {
        preset: "auto (production)",
        colors: false,
        depth: 2,
        compact: true,
        sorted: false,
        maxArrayLength: 30,
        showHidden: false,
      },
      {
        preset: "debug",
        colors: "inherit",
        depth: "Infinity",
        compact: false,
        sorted: true,
        maxArrayLength: "Infinity",
        showHidden: true,
      },
      {
        preset: "compact",
        colors: false,
        depth: 3,
        compact: true,
        sorted: false,
        maxArrayLength: 50,
        showHidden: false,
      },
    ],
    note: current.forcedDebug
      ? "DEBUG_INSPECT forced the debug preset"
      : `Auto preset resolved to ${current.preset}`,
  });
}

async function apiDeps(): Promise<Response> {
  const ls = Bun.spawn(["bun", "pm", "ls", "--all"], { stdout: "pipe", stderr: "pipe" });
  const bin = Bun.spawn(["bun", "pm", "bin"], { stdout: "pipe", stderr: "pipe" });
  const bunx = Bun.spawn(["bunx", "--help"], { stdout: "pipe", stderr: "pipe" });
  const [lsOut, binOut, bunxOut] = await Promise.all([
    new Response(ls.stdout).text(),
    new Response(bin.stdout).text(),
    new Response(bunx.stdout).text(),
  ]);
  await Promise.all([ls.exited, bin.exited, bunx.exited]);

  const packages = lsOut.split("\n").filter((l) => l.includes("@")).length;
  return jsonResponse({
    binDir: binOut.trim(),
    totalPackages: packages,
    tree: lsOut.trim(),
    bunx: {
      available: Bun.which("bunx") !== null,
      usage: "bunx <package>[@version] [args]",
      example: "bunx oxlint@latest --version",
    },
    note: "bun pm ls --all + bun pm bin + bunx. CI: git diff --exit-code dependencies.txt",
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
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
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
      case "/api/build-info":
        return apiBuildInfo();
      case "/api/runtime-info":
        return apiRuntimeInfo();
      case "/api/toolchain/health":
        return apiToolchainHealth();
      case "/api/toolchain/heal":
        return apiToolchainHeal();
      case "/api/deps":
        return apiDeps();
      case "/api/inspect":
        return apiInspect();
      case "/api/inspect-simple":
        return apiInspectSimple();
      case "/api/inspect-config":
        return apiInspectConfig();
      case "/api/uuid":
        return apiUuid();
      case "/health":
        return new Response("ok");
      default:
        return new Response("Not Found", { status: 404 });
    }
  },
});

Bun.stdout.write(`Dashboard running at http://localhost:${server.port}\n`);
