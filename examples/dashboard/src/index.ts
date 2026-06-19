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
import {
  createIsolation,
  getIsolationCapabilities,
  isMessagePortIsolationAvailable,
} from "./lib/isolation/index.ts";
import { generatePerfHTML, perfGate, runEffectBenchmarks, resolveThresholdSources, trainThresholds } from "./harness/index.ts";
import { MessageChannel } from "node:worker_threads";
import http2 from "node:http2";
import { apiEffectBenchmark } from "./handlers/effect-benchmark.ts";

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
  const root = resolveRoot();
  return Bun.which("kimi-doctor") || `${root}/src/bin/kimi-doctor.ts`;
}

// ── API handlers ────────────────────────────────────────────────────

export async function apiBundle(): Promise<Response> {
  const proc = Bun.spawn(["bun", "run", doctorBin(), "--bundle", "--json"], {
    cwd: resolveRoot(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return jsonResponse(JSON.parse(stdout));
}

export async function apiCompile(): Promise<Response> {
  const proc = Bun.spawn(["bun", "run", doctorBin(), "--compile-check", "--json"], {
    cwd: resolveRoot(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return jsonResponse(JSON.parse(stdout));
}

export async function apiGates(): Promise<Response> {
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

export async function apiSecrets(): Promise<Response> {
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

export async function apiEnv(): Promise<Response> {
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
    const parsed = Bun.TOML.parse(bunfigText);
    if (parsed.run && typeof parsed.run === "object") {
      bunfigRun = parsed.run as Record<string, unknown>;
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

export async function apiConsoleDepth(): Promise<Response> {
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

export async function apiBuildInfo(): Promise<Response> {
  // Read real [define] section from bunfig.toml
  let bunfigDefines: Record<string, string> = {};
  let bunfigPath = "";
  try {
    const candidates = ["./bunfig.toml", `${Bun.env.HOME}/.bunfig.toml`];
    for (const candidate of candidates) {
      const f = Bun.file(candidate);
      if (await f.exists()) {
        const parsed = Bun.TOML.parse(await f.text());
        if (parsed.define && typeof parsed.define === "object") {
          bunfigDefines = Object.fromEntries(
            Object.entries(parsed.define as Record<string, unknown>).map(([k, v]) => [k, String(v)])
          );
        }
        bunfigPath = candidate;
        break;
      }
    }
  } catch {
    /* no bunfig.toml */
  }

  // Compile-time: platform + git-derived metadata
  const compileTime: Record<string, string> = {
    PLATFORM: process.platform,
    ARCH: process.arch,
    BUN_VERSION: Bun.version,
    BUN_REVISION: Bun.revision,
  };

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

  // Active defines read from bunfig.toml [define]
  const hasDefines = Object.keys(bunfigDefines).length > 0;

  const runtime = {
    platform: process.platform,
    arch: process.arch,
    bunVersion: Bun.version,
    bunRevision: Bun.revision,
    pid: process.pid,
  };

  return jsonResponse({
    bunfigPath,
    compileTime,
    defines: hasDefines ? bunfigDefines : null,
    definesSource: hasDefines ? `bunfig.toml [define]` : "none (add [define] entries to bunfig.toml)",
    consoleWriteRewritten: "console.write" in bunfigDefines,
    runtime,
    note: hasDefines
      ? "--define rewrites identifiers at AST level. Read from bunfig.toml [define]."
      : "No [define] section in bunfig.toml. Add entries like: [define] \"console.write\" = \"console.log\"",
  });
}

export async function apiRuntimeInfo(): Promise<Response> {
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

export async function apiToolchainHealth(): Promise<Response> {
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

export async function apiToolchainHeal(): Promise<Response> {
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

export async function apiInspectSimple(): Promise<Response> {
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

  // Defaults table — per BunInspectOptions interface (4 options)
  // Bun also accepts Node util.inspect compat options at runtime
  const options = [
    {
      option: "depth",
      default: 2,
      value: 4,
      flag: "--console-depth",
      source: "bunfig.toml console.depth = 4",
    },
    { option: "colors", default: "TTY&!CI", value: true, flag: "bun --no-color", source: "terminal" },
    { option: "compact", default: true, value: true, flag: "—", source: "default" },
    { option: "sorted", default: false, value: false, flag: "—", source: "default" },
    { option: "showHidden", default: false, value: false, flag: "—", source: "Node compat" },
    { option: "breakLength", default: 80, value: 80, flag: "—", source: "Node compat" },
    { option: "maxArrayLength", default: 100, value: 100, flag: "—", source: "Node compat" },
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

export async function apiInspect(): Promise<Response> {
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

export async function apiUuid(): Promise<Response> {
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

export async function apiInspectConfig(): Promise<Response> {
  const isTTY = process.stdout?.isTTY ?? false;
  const isCI = !!Bun.env.CI;
  const debug = Bun.env.DEBUG_INSPECT === "true";
  const isProd = Bun.env.NODE_ENV === "production";

  const preset = debug ? "debug" : isProd ? "production" : isTTY ? "local" : "non-tty";
  const depth = debug ? "Infinity" : isProd ? 2 : isTTY ? 5 : 4;
  const colors = debug ? "inherit" : (isTTY && !isCI);
  const compact = !isTTY || isProd;
  const showHidden = debug;

  return jsonResponse({
    preset,
    environment: isProd ? "production" : isTTY ? "local" : "non-tty",
    config: { depth, colors, compact, sorted: false, maxArrayLength: isProd ? 30 : 100, showHidden },
    detected: {
      isTTY,
      CI: Bun.env.CI || "unset",
      NODE_ENV: Bun.env.NODE_ENV || "unset",
      DEBUG_INSPECT: Bun.env.DEBUG_INSPECT || "unset",
    },
    presets: [
      { environment: "Local terminal (dev)", debug: "—", colors: "true (TTY)", depth: 5, compact: false, showHidden: false, useCase: "Best developer experience" },
      { environment: "CI / GitHub Actions / pipe", debug: "—", colors: "false (pipe)", depth: 4, compact: true, showHidden: false, useCase: "Clean, safe logs" },
      { environment: "Production", debug: "—", colors: "false", depth: 2, compact: true, showHidden: false, useCase: "Minimal output" },
      { environment: "Any (local/CI/prod)", debug: "1 / true", colors: "true (if TTY)", depth: "Infinity", compact: false, showHidden: true, useCase: "Maximum visibility for debugging" },
    ],
    note: debug ? "DEBUG_INSPECT=true — depth=Infinity, showHidden=true" : `Auto preset (${preset}). console.depth=4 from bunfig.toml`,
  });
}

export async function apiDeps(): Promise<Response> {
  const ls = Bun.spawn(["bun", "pm", "ls", "--all"], { stdout: "pipe", stderr: "pipe" });
  const bin = Bun.spawn(["bun", "pm", "bin"], { stdout: "pipe", stderr: "pipe" });
  const bunx = Bun.spawn(["bunx", "--help"], { stdout: "pipe", stderr: "pipe" });
  const [lsOut, binOut, _bunxOut] = await Promise.all([
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
      usage: "bunx [--bun] <package>[@version] [args]",
      example: "bunx --bun oxlint@latest --version",
      note: "--bun flag must come before the package name. Flags after the name pass through.",
    },
    note: "bun pm ls --all + bun pm bin + bunx. CI: git diff --exit-code dependencies.txt",
  });
}

export async function apiBunfig(): Promise<Response> {
  try {
    const path = import.meta.dir + "/../bunfig.toml";
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return jsonResponse({ error: "No bunfig.toml found" });
    }
    const raw = await file.text();
    const parsed = Bun.TOML.parse(raw);
    return jsonResponse({
      path: "./bunfig.toml",
      sections: parsed,
      mergeRule: "global (~/.bunfig.toml) → project (./bunfig.toml) shallow merge → CLI flags override",
      import: 'import bunfig from "./bunfig.toml" with { type: "toml" };',
    });
  } catch (e) {
    return jsonResponse({ error: "Failed to parse bunfig.toml", detail: String(e) });
  }
}

export async function apiStringUtils(): Promise<Response> {
  const ansiStr = "\u001b[31mhello\u001b[0m";
  return jsonResponse({
    stringWidth: {
      plain: Bun.stringWidth("hello"),
      ansi: Bun.stringWidth(ansiStr),
      ansiCounted: Bun.stringWidth(ansiStr, { countAnsiEscapeCodes: true }),
    },
    escapeHTML: {
      plain: Bun.escapeHTML("hello"),
      script: Bun.escapeHTML("<script>alert('xss')</script>"),
      amp: Bun.escapeHTML("a & b"),
      number: Bun.escapeHTML(42),
      bool: Bun.escapeHTML(true),
    },
    inspectCustom: {
      symbol: "Bun.inspect.custom",
      usage: "class Foo { [Bun.inspect.custom]() { return 'foo'; } }",
      note: "Override console.log output per class. Same as util.inspect.custom in Node.js",
    },
  });
}

// ── Markdown ──────────────────────────────────────────────────────

export const SAMPLE_MD = `# Dashboard Markdown Demo

## Features

Bun.markdown supports **bold**, *italic*, \`code\`, and [links](https://bun.sh).

### Lists
- Item one
- Item two
  - Nested item
  - Another nested

### Task List
- [x] HTML output
- [x] ANSI terminal
- [x] React elements
- [ ] Custom parser

### Table
| API | Status | Speed |
|-----|--------|-------|
| html() | ✅ | ~1M lines/sec |
| ansi() | ✅ | ~1M lines/sec |
| react() | ✅ | ~1M lines/sec |

### Code Block
\`\`\`typescript
import { serve } from "bun";

serve({
  fetch(req) {
    return new Response("Hello Bun!");
  },
});
\`\`\`

> Blockquote: Bun is a fast all-in-one JavaScript runtime.
`;

export async function apiMarkdownHtml(): Promise<Response> {
  const html = Bun.markdown.html(SAMPLE_MD);
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function apiMarkdownAnsi(): Promise<Response> {
  const ansi = Bun.markdown.ansi(SAMPLE_MD, { colors: false });
  return new Response(ansi, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// ── Semver ────────────────────────────────────────────────────────

export async function apiSemver(): Promise<Response> {
  const pairs: [string, string][] = [
    ["1.0.0", "1.0.0"],
    ["2.0.0", "1.9.9"],
    ["1.0.0", "2.0.0"],
    ["1.2.3", "1.2.3-alpha.1"],
  ];
  const orderResults = pairs.map(([a, b]) => ({
    a, b,
    result: Bun.semver.order(a, b),
    meaning: Bun.semver.order(a, b) === 0 ? "equal" : Bun.semver.order(a, b) === 1 ? "a > b" : "a < b",
  }));

  const satisfiesResults = [
    { version: "1.5.0", range: "^1.0.0", satisfies: Bun.semver.satisfies("1.5.0", "^1.0.0") },
    { version: "2.0.0", range: "^1.0.0", satisfies: Bun.semver.satisfies("2.0.0", "^1.0.0") },
    { version: "1.2.3", range: ">=1.0.0 <2.0.0", satisfies: Bun.semver.satisfies("1.2.3", ">=1.0.0 <2.0.0") },
  ];

  return jsonResponse({
    order: orderResults,
    satisfies: satisfiesResults,
    note: "Bun.semver.order(a,b) → -1|0|1. Bun.semver.satisfies(v,range) → boolean.",
  });
}

// ── Deep Equals ────────────────────────────────────────────────────

export async function apiDeepEquals(): Promise<Response> {
  const cases = [
    { a: { x: 1, y: [2, 3] }, b: { x: 1, y: [2, 3] }, equal: Bun.deepEquals({ x: 1, y: [2, 3] }, { x: 1, y: [2, 3] }) },
    { a: { x: 1 }, b: { x: 1, y: 2 }, equal: Bun.deepEquals({ x: 1 }, { x: 1, y: 2 }) },
    { a: [1, 2, 3], b: [1, 2, 3], equal: Bun.deepEquals([1, 2, 3], [1, 2, 3]) },
    { a: new Uint8Array([1, 2]), b: new Uint8Array([1, 2]), equal: Bun.deepEquals(new Uint8Array([1, 2]), new Uint8Array([1, 2])) },
    { a: new Date(0), b: new Date(0), equal: Bun.deepEquals(new Date(0), new Date(0)) },
    { a: NaN, b: NaN, equal: Bun.deepEquals(NaN, NaN) },
  ];

  return jsonResponse({
    cases,
    note: "Bun.deepEquals — structural deep equality. Handles TypedArrays, Dates, NaN, nested objects.",
  });
}

// ── Nanoseconds ────────────────────────────────────────────────────

export async function apiNanoseconds(): Promise<Response> {
  const start = Bun.nanoseconds();
  let x = 0;
  for (let i = 0; i < 1000; i++) x += Math.sqrt(i);
  const end = Bun.nanoseconds();

  return jsonResponse({
    start: Number(start),
    end: Number(end),
    elapsed: Number(end - start),
    unit: "nanoseconds",
    note: `Bun.nanoseconds() → bigint. Elapsed: ${end - start}ns for 1000 Math.sqrt() calls.`,
  });
}

// ── Sleep ──────────────────────────────────────────────────────────

export async function apiSleep(): Promise<Response> {
  const start = Bun.nanoseconds();
  await Bun.sleep(10);
  const end = Bun.nanoseconds();

  return jsonResponse({
    requested: "10ms",
    start: Number(start),
    end: Number(end),
    actual: `${Number(end - start) / 1_000_000}ms`,
    note: "Bun.sleep(ms) — non-blocking sleep. Uses monotonic clock internally.",
  });
}

// ── Console ────────────────────────────────────────────────────────

export async function apiConsole(): Promise<Response> {
  const obj = {
    zNested: { a: 1, b: { c: [1, 2, 3] } },
    aItems: ["x", "y", "z"],
    mDate: new Date(),
  };

  const defaultOutput = Bun.inspect(obj);
  const customOutput = Bun.inspect(obj, {
    depth: 4,
    colors: false,
    compact: false,
    sorted: true,
  });

  return jsonResponse({
    inspectOptions: { depth: 4, colors: false, compact: false, sorted: true },
    defaultOutput: defaultOutput.slice(0, 300),
    customOutput: customOutput.slice(0, 300),
    note: "Bun.inspect(obj, { depth, colors, compact, sorted }). Compare with new Console({ inspectOptions }) when available.",
  });
}

// ── TTY ───────────────────────────────────────────────────────────

export async function apiTty(): Promise<Response> {
  const isTTY = process.stdout?.isTTY ?? false;
  const columns = process.stdout?.columns ?? null;
  const rows = process.stdout?.rows ?? null;
  const term = Bun.env.TERM ?? "unset";
  const colorTerm = Bun.env.COLORTERM ?? "unset";
  const noColor = Bun.env.NO_COLOR ?? "unset";
  const forceColor = Bun.env.FORCE_COLOR ?? "unset";
  const isCI = !!Bun.env.CI;

  // Bun.inspect auto-detect: colors true iff TTY && !CI
  const inspectColors = isTTY && !isCI;

  return jsonResponse({
    isTTY,
    isCI,
    dimensions: { columns, rows },
    terminal: { TERM: term, COLORTERM: colorTerm, NO_COLOR: noColor, FORCE_COLOR: forceColor },
    inspect: {
      colorsAuto: inspectColors,
      note: "Bun.inspect() enables colors if TTY && !CI. Override with --no-color or FORCE_COLOR=1.",
    },
    env: {
      "process.stdout.isTTY": isTTY,
      "process.stdout.columns": columns,
      "process.stdout.rows": rows,
      "Bun.env.TERM": term,
      "Bun.env.CI": Bun.env.CI ?? "unset",
    },
  });
}

// ── Terminal ───────────────────────────────────────────────────────

export async function apiTerminal(): Promise<Response> {
  let ptyOutput = "";
  let flags: Record<string, string> = {};

  try {
    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_term, data) {
        ptyOutput += new TextDecoder().decode(data);
      },
    });

    // Capture termios flags before running command
    flags = {
      controlFlags: "0x" + terminal.controlFlags.toString(16).toUpperCase(),
      inputFlags: "0x" + terminal.inputFlags.toString(16).toUpperCase(),
      localFlags: "0x" + terminal.localFlags.toString(16).toUpperCase(),
      outputFlags: "0x" + terminal.outputFlags.toString(16).toUpperCase(),
    };

    // Toggle raw mode briefly to show capability
    terminal.setRawMode(true);
    const rawFlags = {
      rawControl: "0x" + terminal.controlFlags.toString(16).toUpperCase(),
      rawLocal: "0x" + terminal.localFlags.toString(16).toUpperCase(),
    };
    terminal.setRawMode(false);

    // Spawn a simple command through the PTY
    const proc = Bun.spawn(["echo", "hello from PTY"], { terminal });
    await proc.exited;

    // Wait briefly for terminal data callback
    await Bun.sleep(5);

    return jsonResponse({
      dimensions: { cols: 80, rows: 24 },
      flags,
      rawModeFlags: rawFlags,
      output: ptyOutput.trim(),
      closed: terminal.closed,
      note: "Bun.Terminal — PTY for interactive programs. termios flags expose control/input/local/output modes. setRawMode() disables line buffering and echo.",
    });
  } catch (e) {
    return jsonResponse({
      error: String(e),
      note: "Bun.Terminal requires a TTY-capable environment. PTY creation may fail in CI/non-TTY contexts.",
    });
  }
}

// ── Color ──────────────────────────────────────────────────────────

export async function apiColor(): Promise<Response> {
  const conversions = [
    { input: "#ff0000", to: "ansi-16", result: Bun.color("#ff0000", "ansi-16") },
    { input: "#ff0000", to: "ansi-256", result: Bun.color("#ff0000", "ansi-256") },
    { input: "#ff0000", to: "ansi-16m", result: Bun.color("#ff0000", "ansi-16m") },
    { input: "#00ff00", to: "ansi-16", result: Bun.color("#00ff00", "ansi-16") },
    { input: "#0000ff", to: "ansi-256", result: Bun.color("#0000ff", "ansi-256") },
    { input: "red", to: "ansi-16m", result: Bun.color("red", "ansi-16m") },
    { input: "deeppink", to: "ansi-256", result: Bun.color("deeppink", "ansi-256") },
    { input: "#1a2b3c", to: "ansi-16m", result: Bun.color("#1a2b3c", "ansi-16m") },
  ];

  return jsonResponse({
    conversions,
    formats: {
      "ansi-16": "4-bit (16 colors, e.g. '91' = bright red)",
      "ansi-256": "8-bit (256 colors, e.g. '196')",
      "ansi-16m": "24-bit true color (R;G;B, e.g. '255;0;0')",
    },
    note: "Bun.color(input, format) converts hex/named colors to ANSI escape code parameters. Use with \\x1b[38;5;{n}m.",
  });
}

// ── Peek ───────────────────────────────────────────────────────────

export async function apiPeek(): Promise<Response> {
  const pending = new Promise<string>((resolve) => setTimeout(() => resolve("done"), 5000));
  const fulfilled = Promise.resolve(42);
  const _rejected = Promise.reject(new Error("boom")).catch(() => {});

  // Peek at the pending promise (status only — value not available)
  const pendingStatus = Bun.peek.status(pending);

  // Peek at fulfilled promise
  const fulfilledValue = Bun.peek(fulfilled);
  const fulfilledStatus = Bun.peek.status(fulfilled);

  // Clean up the pending setTimeout
  // (can't easily cancel, but it won't affect response)

  return jsonResponse({
    pending: { status: pendingStatus, value: Bun.peek(pending) },
    fulfilled: { status: fulfilledStatus, value: fulfilledValue },
    note: "Bun.peek.status(p) → 'pending'|'fulfilled'|'rejected'. Bun.peek(p) extracts value if fulfilled (sync, same tick).",
  });
}

// ── Inspect Table ──────────────────────────────────────────────────

export async function apiInspectTable(): Promise<Response> {
  // Array of objects — like a database result
  const users = [
    { name: "Alice", role: "admin", status: "active", loginCount: 42 },
    { name: "Bob", role: "editor", status: "active", loginCount: 17 },
    { name: "Charlie", role: "viewer", status: "inactive", loginCount: 3 },
    { name: "Diana", role: "admin", status: "active", loginCount: 128 },
  ];

  // Full table
  const full = Bun.inspect.table(users);

  // Column-filtered table (only name + role)
  const filtered = Bun.inspect.table(users, ["name", "role"]);

  // With colors disabled (plain text)
  const plain = Bun.inspect.table(users, { colors: false });

  return new Response(
    `// Bun.inspect.table(users)\n${full}\n\n` +
    `// Bun.inspect.table(users, ["name", "role"])\n${filtered}\n\n` +
    `// Bun.inspect.table(users, { colors: false })\n${plain}`,
    { headers: { "content-type": "text/plain; charset=utf-8" } }
  );
}

// ── URL / URLSearchParams ──────────────────────────────────────────

export async function apiUrl(): Promise<Response> {
  const url = new URL("https://user:pass@example.com:8080/path/to/page?q=bun&lang=en&q=again#section");

  // All parsed properties
  const properties = {
    href: url.href,
    origin: url.origin,
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    host: url.host,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };

  // URLSearchParams manipulation
  const sp = url.searchParams;
  const params = {
    get_q: sp.get("q"),
    getAll_q: sp.getAll("q"),
    has_lang: sp.has("lang"),
    size: sp.size,
    toString: sp.toString(),
  };

  // Static methods
  const canParseValid = URL.canParse("https://bun.sh/docs");
  const canParseInvalid = URL.canParse("not-a-url");
  const parsed = URL.parse("/docs", "https://bun.sh");
  const parsedInvalid = URL.parse("not-a-url");

  // Relative resolution
  const relative = new URL("../../api", "https://example.com/a/b/c/page");

  return jsonResponse({
    properties,
    searchParams: params,
    staticMethods: {
      canParse: { valid: canParseValid, invalid: canParseInvalid },
      parse: {
        withBase: parsed ? { href: parsed.href, pathname: parsed.pathname } : null,
        invalid: parsedInvalid,
      },
    },
    relativeResolution: { input: "../../api", base: "https://example.com/a/b/c/page", result: relative.href },
    note: "URL.parse() returns null on invalid input (no throw). URL.canParse() is a fast boolean check. URLSearchParams: get, getAll, has, size, sort, entries.",
  });
}

// ── URL (node:url) ─────────────────────────────────────────────────

export async function apiUrlNode(): Promise<Response> {
  // We need the import at runtime to avoid static import issues
  const nodeUrl = await import("node:url");

  // IDN: domainToASCII / domainToUnicode
  const idn = [
    { input: "日本語.jp", ascii: nodeUrl.domainToASCII("日本語.jp"), unicode: nodeUrl.domainToUnicode("xn--wgv71a119e.jp") },
    { input: "español.com", ascii: nodeUrl.domainToASCII("español.com"), unicode: nodeUrl.domainToUnicode("xn--espaol-zwa.com") },
    { input: "中文.com", ascii: nodeUrl.domainToASCII("中文.com"), unicode: nodeUrl.domainToUnicode("xn--fiq228c.com") },
  ];

  // fileURLToPath / pathToFileURL roundtrip
  const filePath = "/tmp/kimi-dashboard-test.txt";
  const fileUrl = nodeUrl.pathToFileURL(filePath).href;
  const backToPath = nodeUrl.fileURLToPath(fileUrl);

  // url.format
  const formatted = nodeUrl.format({
    protocol: "https",
    hostname: "bun.sh",
    port: "443",
    pathname: "/docs/runtime",
    search: "?q=bun",
  });

  // urlToHttpOptions
  const parsed = new URL("https://user@bun.sh:443/docs/runtime?q=bun");
  const httpOpts = nodeUrl.urlToHttpOptions(parsed);

  return jsonResponse({
    idn,
    fileRoundtrip: { path: filePath, url: fileUrl, backToPath },
    format: { input: "{ protocol:'https', hostname:'bun.sh', port:'443', pathname:'/docs/runtime', search:'?q=bun' }", result: formatted },
    urlToHttpOptions: httpOpts,
    note: "node:url — domainToASCII/domainToUnicode (IDN/Punycode), fileURLToPath/pathToFileURL (roundtrip), format (build URL), urlToHttpOptions (URL→http.request options).",
  });
}

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

// ── Env / .env ────────────────────────────────────────────────────

export async function apiDotenv(): Promise<Response> {
  // Read .env file if it exists
  let dotenvRaw = "";
  let dotenvParsed: Record<string, string> = {};
  try {
    const dotenvPath = import.meta.dir + "/../.env";
    const file = Bun.file(dotenvPath);
    if (await file.exists()) {
      dotenvRaw = await file.text();
      // Parse .env manually to show what was loaded
      for (const line of dotenvRaw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq > 0) {
          const key = trimmed.slice(0, eq).trim();
          let val = trimmed.slice(eq + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          dotenvParsed[key] = val;
        }
      }
    }
  } catch {
    /* no .env */
  }

  const nodeEnv = Bun.env.NODE_ENV ?? "unset";
  const loadedVars = Object.keys(dotenvParsed);

  // Bun-specific environment variables (from official docs)
  const bunSpecialVars: { name: string; description: string; value: string; set: boolean }[] = [
    { name: "NODE_TLS_REJECT_UNAUTHORIZED", description: "Disables SSL cert validation", value: Bun.env.NODE_TLS_REJECT_UNAUTHORIZED ?? "unset", set: "NODE_TLS_REJECT_UNAUTHORIZED" in Bun.env },
    { name: "BUN_CONFIG_VERBOSE_FETCH", description: "Log fetch requests/responses as curl", value: Bun.env.BUN_CONFIG_VERBOSE_FETCH ?? "unset", set: "BUN_CONFIG_VERBOSE_FETCH" in Bun.env },
    { name: "BUN_RUNTIME_TRANSPILER_CACHE_PATH", description: "Transpiler cache dir (files >50KB)", value: Bun.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH ?? "unset", set: "BUN_RUNTIME_TRANSPILER_CACHE_PATH" in Bun.env },
    { name: "TMPDIR", description: "Intermediate assets during bundling", value: Bun.env.TMPDIR ?? "unset", set: "TMPDIR" in Bun.env },
    { name: "NO_COLOR", description: "Disable ANSI color output", value: Bun.env.NO_COLOR ?? "unset", set: "NO_COLOR" in Bun.env },
    { name: "FORCE_COLOR", description: "Force-enable ANSI colors", value: Bun.env.FORCE_COLOR ?? "unset", set: "FORCE_COLOR" in Bun.env },
    { name: "BUN_CONFIG_MAX_HTTP_REQUESTS", description: "Max concurrent fetch/install requests (default 256)", value: Bun.env.BUN_CONFIG_MAX_HTTP_REQUESTS ?? "unset", set: "BUN_CONFIG_MAX_HTTP_REQUESTS" in Bun.env },
    { name: "BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD", description: "Don't clear console on --watch reload", value: Bun.env.BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD ?? "unset", set: "BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD" in Bun.env },
    { name: "DO_NOT_TRACK", description: "Disable crash reports & telemetry", value: Bun.env.DO_NOT_TRACK ?? "unset", set: "DO_NOT_TRACK" in Bun.env },
    { name: "BUN_OPTIONS", description: "Prepend CLI args to any Bun execution", value: Bun.env.BUN_OPTIONS ?? "unset", set: "BUN_OPTIONS" in Bun.env },
  ];

  return jsonResponse({
    loadingOrder: [
      ".env",
      `.env.${nodeEnv === "unset" ? "{production,development,test}" : nodeEnv}  (based on NODE_ENV)`,
      ".env.local  (skipped when NODE_ENV=test)",
    ],
    nodeEnv,
    loadedFromDotenv: dotenvParsed,
    runtimeValues: Object.fromEntries(loadedVars.map((k) => [k, Bun.env[k] ?? "unset"])),
    bunSpecialVars,
    setCount: bunSpecialVars.filter((v) => v.set).length,
    totalCount: bunSpecialVars.length,
    note: "Bun auto-loads .env files in priority order. Set inline: DASHBOARD_THEME=light bun run src/index.ts. Disable: bunfig.toml [env] file = false.",
  });
}

// ── Util Types ─────────────────────────────────────────────────────

export async function apiUtilTypes(): Promise<Response> {
  const { types } = await import("node:util");

  const checks: { name: string; value: unknown; result: boolean }[] = [
    { name: "isAnyArrayBuffer", value: new ArrayBuffer(4), result: types.isAnyArrayBuffer(new ArrayBuffer(4)) },
    { name: "isArrayBuffer", value: "ArrayBuffer", result: types.isArrayBuffer(new ArrayBuffer(4)) },
    { name: "isSharedArrayBuffer", value: "SharedArrayBuffer", result: types.isSharedArrayBuffer(new SharedArrayBuffer(4)) },
    { name: "isArrayBufferView", value: "Uint8Array", result: types.isArrayBufferView(new Uint8Array(4)) },
    { name: "isTypedArray", value: "Uint8Array", result: types.isTypedArray(new Uint8Array(4)) },
    { name: "isUint8Array", value: "Uint8Array", result: types.isUint8Array(new Uint8Array(4)) },
    { name: "isDataView", value: "DataView", result: types.isDataView(new DataView(new ArrayBuffer(4))) },
    { name: "isDate", value: "Date", result: types.isDate(new Date()) },
    { name: "isRegExp", value: "/regex/", result: types.isRegExp(/regex/) },
    { name: "isMap", value: "Map", result: types.isMap(new Map()) },
    { name: "isSet", value: "Set", result: types.isSet(new Set()) },
    { name: "isMapIterator", value: "map.keys()", result: types.isMapIterator(new Map().keys()) },
    { name: "isSetIterator", value: "set.values()", result: types.isSetIterator(new Set().values()) },
    { name: "isGeneratorObject", value: "function*(){}", result: types.isGeneratorObject((function* () {})()) },
    { name: "isPromise", value: "Promise", result: types.isPromise(Promise.resolve()) },
    { name: "isWeakMap", value: "WeakMap", result: types.isWeakMap(new WeakMap()) },
    { name: "isNativeError", value: "Error", result: types.isNativeError(new Error()) },
    { name: "isAsyncFunction", value: "async () => {}", result: types.isAsyncFunction(async () => {}) },
    { name: "isGeneratorFunction", value: "function*(){}", result: types.isGeneratorFunction(function* () {}) },
    { name: "isBoxedPrimitive", value: "new Boolean(true)", result: types.isBoxedPrimitive(new Boolean(true)) },
    { name: "isKeyObject", value: "null", result: types.isKeyObject(null) },
  ];

  return jsonResponse({
    checks,
    totalFunctions: Object.keys(types).filter((k) => k.startsWith("is")).length,
    passedCount: checks.filter((c) => c.result).length,
    note: "node:util/types — 43 is* type-check functions. Bun mirrors Node.js util.types exactly. Includes MapIterator, SetIterator, GeneratorObject.",
  });
}

// ── Global Store ───────────────────────────────────────────────────

export async function apiGlobalStore(): Promise<Response> {
  // Resolve the global store paths
  const installDir = Bun.env.BUN_INSTALL_GLOBAL_DIR ?? `${Bun.env.HOME}/.bun/install/global`;
  const linksDir = `${installDir}/links`;
  const cacheDir = `${installDir}/cache`;

  // Check what's in the store (non-recursive, just top-level)
  let pkgCount = 0;
  let symlinkExample = "";
  try {
    const pkgs = [...new Bun.Glob("*").scanSync({ cwd: linksDir, onlyFiles: false })];
    pkgCount = pkgs.length;
    if (pkgs.length > 0) {
      // Read a symlink target as example
      const sample = pkgs[0];
      const fullPath = `${linksDir}/${sample}`;
      const stat = await Bun.file(fullPath).exists();
      symlinkExample = `${sample} → exists=${stat}`;
    }
  } catch {
    /* store not yet populated */
  }

  return jsonResponse({
    storePaths: {
      installDir,
      links: linksDir,
      cache: cacheDir,
    },
    state: {
      packages: pkgCount,
      example: symlinkExample || "(store empty — run bun install to populate)",
    },
    philosophy: {
      input: "lockfile + registry state",
      output: "content-addressed, immutable directory tree",
      property: "referentially transparent — same lockfile → same store path",
      warmInstall: "~1 symlink() per package, no clonefileat() kernel locks",
      ciCache: "cache ~/.bun/install/global between CI runs for near-instant warm installs",
    },
    note: "install.globalStore = true in bunfig.toml. Entry hash includes full transitive closure. Two projects with same tree share single on-disk entry — structural sharing, no duplication.",
  });
}

// ── Perf Threaded ──────────────────────────────────────────────────

export async function apiPerfThreaded(): Promise<Response> {
  // Worker code: self-contained, Symbol-keyed, no imports from scaffold
  const workerCode = `
declare var self: Worker;
self.onmessage = async (e: MessageEvent) => {
  const { moduleName } = e.data;
  const start = performance.now();
  switch (moduleName) {
    case "crypto.sha256":
      Bun.SHA256.hash("benchmark payload ".repeat(10));
      break;
    case "util.inspect":
      Bun.inspect({ nested: { a: 1, b: { c: [1, 2, 3] }, d: [{ x: "y" }] } }, { sorted: true, colors: false });
      break;
    case "util.deepEquals":
      Bun.deepEquals({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] });
      break;
    case "image.metadata": {
      const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,2,0,0,0,2,8,2,0,0,0,0xfd,0xd4,0x9a,0x73,0,0,0,18,73,68,65,84,8,0xd7,99,0xf8,0xcf,0xc0,0,2,12,0,0,9,0,1,0x35,0x8b,0x5a,0xc0,0,0,0,0,73,69,78,68,0xae,66,96,130]);
      const img = new Bun.Image(png);
      await img.metadata();
      break;
    }
  }
  const duration = performance.now() - start;
  self.postMessage({ name: moduleName, actualMs: duration });
};
`;
  await Bun.write("/tmp/_perf_worker.ts", workerCode);

  const modules = ["crypto.sha256", "util.inspect", "util.deepEquals", "image.metadata"];

  const startAll = performance.now();
  const promises = modules.map((name) => {
    return new Promise<{ name: string; actualMs: number }>((resolve, reject) => {
      const worker = new Worker(new URL("file:///tmp/_perf_worker.ts"));
      worker.onmessage = (e) => { resolve(e.data); worker.terminate(); };
      worker.onerror = (err) => { reject(err); worker.terminate(); };
      worker.postMessage({ moduleName: name });
    });
  });

  const metrics = await Promise.all(promises);
  const totalMs = performance.now() - startAll;
  const allPass = metrics.every((m) => m.actualMs < 5);

  return jsonResponse({
    metrics: metrics.map((m) => ({
      ...m,
      pass: m.actualMs < 5,
      thresholdMs: 5,
    })),
    totalMs,
    concurrent: modules.length,
    speedup: `${(metrics.reduce((s, m) => s + m.actualMs, 0) / totalMs).toFixed(1)}x vs sequential`,
    allPass,
    architecture: "Worker per module → Symbol-keyed handler → postMessage metric → Promise.all collect → pure HTML generation. No shared mutable state (like --isolate).",
  });
}

// ── Kimi Doctor / perf-doctor ───────────────────────────────────────

export async function apiKimiDoctor(): Promise<Response> {
  return jsonResponse({
    cli: "src/bin/perf-doctor.ts (examples/dashboard performance loop)",
    commands: [
      {
        flag: "--perf-gates",
        description: "Run benchmarks, validate thresholds",
        output: "pass/fail + process.exit(1) on violation",
      },
      {
        flag: "--report",
        description: "Generate HTML performance report",
        output: "perf-report.html (path via --out)",
      },
      {
        flag: "--train",
        description: "If all gates pass, update thresholds.json with 10% margin",
        output: "thresholds.json written (skipped benchmarks excluded)",
      },
      {
        flag: "--watch",
        description: "Re-run perf gates when harness/isolation sources change",
        output: "node:fs.watch recursive on src/harness + src/lib/isolation",
      },
      {
        flag: "--out",
        description: "Output directory for reports/thresholds (default: cwd)",
        output: "paths relative to --out",
      },
    ],
    pipeline: "perf-doctor: --perf-gates → --report | --train | --watch",
    watchModes: {
      perfDoctor: {
        entry: "bun run perf:watch",
        tool: "perf-doctor.ts",
        mechanism: "node:fs.watch (recursive) on src/harness + src/lib/isolation",
        debounceMs: 300,
        signals: "SIGINT, SIGTERM; SIGHUP/SIGBREAK on Windows",
      },
      kimiDoctor: {
        entry: "kimi-doctor --watch",
        tool: "kimi-doctor (main repo)",
        mechanism: "Interval poll every 5s — effect-gates only (not perf benchmarks)",
        signals: "SIGINT, SIGTERM",
      },
    },
    httpBenchmarks: [
      { key: "http.fetch-h1", protocol: "http1.1", thresholdMs: 50 },
      { key: "http.fetch-h2", protocol: "http2", thresholdMs: 40, note: "skipped when fetch client unavailable" },
      { key: "http.fetch-h3", protocol: "http3", thresholdMs: 35, note: "skipped when Bun.serve http3 unavailable" },
    ],
    allAtOnce: "bun run src/bin/perf-doctor.ts --perf-gates --report --watch --out=.",
    note: "Performance loop lives in perf-doctor (this example). Main kimi-doctor --watch polls effect-gates; use perf-doctor --watch for file-triggered benchmark re-runs.",
  });
}

// ── Metrics Schema ─────────────────────────────────────────────────

export async function apiMetricsSchema(): Promise<Response> {
  return jsonResponse({
    Metric: {
      purpose: "Universal harness metric — drives perf-monitor, html-reporter, perf-gate",
      fields: {
        symbol: { type: "string", example: "Symbol(kimi.effect.image)", note: "Derived from sym.toString(), used for grouping" },
        operation: { type: "string", example: "thumbnail", note: "Method name from auto-discovery" },
        actualMs: { type: "number", example: 2.1, note: "Bun.nanoseconds() → ms, rounded 3 decimal places" },
        thresholdMs: { type: "number", example: 5.0, note: "From THRESHOLDS map or MODULE_REGISTRY" },
        pass: { type: "boolean", example: true, note: "actualMs ≤ thresholdMs, NaN-safe (NaN → false)" },
      },
    },
    ModuleMetrics: {
      purpose: "Lightweight control-plan metric — used in domain/control-plan.ts and training runner",
      fields: {
        name: { type: "string", example: "image", note: "Module name from registry, not symbol key" },
        actualMs: { type: "number", note: "Measured duration, threshold looked up separately" },
      },
    },
    pipeline: "auto-discovery → per-method benchmark → Metric[] → perfGate() | generatePerfHTML() | snapshot tests",
    exposure: {
      ephemeral: ["Metric[] from runEffectBenchmarks() — in-memory, lifetime of benchmark run", "ModuleMetrics[] from training runner → control-plan generator", "perfGate() → { pass, failures[] } — CI exit code logic"],
      artifacts: ["perf-report.html — generatePerfHTML(metrics) → Bun.write()", "__snapshots__/*.snap — expect(html).toMatchSnapshot()", "performance-plan.html — control-plan generator → file effect"],
      ci: ["stdout: human-readable summary", "stderr: failure lines from perfGate()", "process.exit(1) when thresholds violated"],
    },
    notOnGlobalThis: "Metrics are NOT on globalThis. Effects are registered via Symbol.for(), but Metric objects are return values — computed on demand, passed through pure transformations, optionally serialized. Domain-level data never hidden behind side effects.",
    note: "Metric[] is the single source of truth. Bun.deepEquals compares arrays across runs for drift detection (including NaN equality). All harness/reporter/gate components expect exactly these shapes.",
  });
}

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

// ── Symbols ────────────────────────────────────────────────────────

export async function apiSymbols(): Promise<Response> {
  const symbols = {
    domain: [
      { key: "kimi.trace", interface: "validateAndFormat(traces): string", module: "src/trace/format.ts" },
      { key: "kimi.snapshot", interface: "snapshot(label, data, opts?): void", module: "src/snapshots/snapshot-helper.ts" },
    ],
    effect: [
      { key: "kimi.effect.image", interface: "ImageEffect", module: "src/image/processor.ts", methods: ["metadata", "placeholder", "thumbnail", "resize"] },
      { key: "kimi.effect.trace", interface: "same as kimi.trace", module: "overlapped with domain" },
      { key: "kimi.effect.snapshot", interface: "SnapshotEffect", module: "src/snapshots/" },
      { key: "kimi.effect.logger", interface: "LoggerEffect", module: "src/logging/logger.ts" },
      { key: "kimi.effect.performance", interface: "{ mark, measure }", module: "src/performance/marks.ts" },
      { key: "kimi.effect.scaffoldFiles", interface: "ScaffoldEffect", module: "src/effect.ts" },
      { key: "kimi.effect.isolation", interface: "IsolationEffect (3 backends)", module: "examples/dashboard/src/lib/isolation/" },
      { key: "kimi.effect.uuid", interface: "{ generate }", module: "placeholder" },
      { key: "kimi.effect.clock", interface: "{ now }", module: "placeholder" },
    ],
    harness: [
      { key: "kimi.perfGate", interface: "naming convention", module: "internal pipeline" },
      { key: "kimi.effect.perf", interface: "overlaps with kimi.effect.performance", module: "future expansion" },
      { key: "kimi.effect.db", interface: "placeholder", module: "not implemented" },
    ],
  };

  return jsonResponse({
    symbols,
    pipeline: [
      "kimi.effect.image", "kimi.effect.trace", "kimi.effect.snapshot",
      "kimi.effect.logger", "kimi.effect.performance", "kimi.effect.isolation",
    ],
    properties: {
      jitMonomorphic: "globalThis[Symbol.for(key)] is stable shape → inlineable",
      treeShaking: "Unused Symbols → dead code eliminated at build",
      zeroCostTesting: "Swap effect implementation, domain unchanged",
      workerParallelism: "Same Symbol keys across processes, no serialization overhead",
    },
    bestPractices: {
      server: "ALS snapshot — domain receives effects as arguments (no global mutation)",
      cli: "globalThis registration — simpler, no request concurrency",
      plugins: "Transpiler.scan() (static reject) + ShadowRealm (runtime isolate)",
      snapshots: "Bun.stripANSI(Bun.inspect.table(data, cols, {colors:true})).toMatchSnapshot()",
    },
    note: "Symbol registry is the abi.ts. Domain = pure contracts. Effect = impure handlers. Harness = internal pipeline. Pipeline order is monomorphically JIT-optimised. Add: define Symbol → MODULE_REGISTRY entry → implement handler → register in init.ts.",
  });
}

// ── IPC Matrix ─────────────────────────────────────────────────────

export async function apiIpcMatrix(): Promise<Response> {
  const messagePort = isMessagePortIsolationAvailable();
  return jsonResponse({
    mechanisms: [
      { mechanism: "MessagePort (same thread)", isolation: "vm.Context", thread: "Same", useCase: "Sandboxed plugins", status: "vm.runInContext ✅" },
      {
        mechanism: "moveMessagePortToContext",
        isolation: "vm.Context",
        thread: "Same",
        useCase: "Bridge vm ↔ main",
        status: messagePort ? "✅" : "not yet implemented",
      },
      { mechanism: "Worker + postMessage", isolation: "Full process", thread: "Separate", useCase: "CPU-intensive tasks", status: "✅" },
      { mechanism: "ShadowRealm + wrapped fn", isolation: "Distinct globals", thread: "Same", useCase: "Pure computation", status: "✅ evaluate() + importValue()" },
      { mechanism: "Bun.spawn + IPC (ipc handler)", isolation: "Full process", thread: "Separate", useCase: "Untrusted code", status: "✅" },
    ],
    shadowRealmNote: "ShadowRealm does NOT support MessagePort transfer — only wrapped functions from importValue(). Use vm.createContext() + moveMessagePortToContext for port-based sandbox comms.",
    isolationFactory: getIsolationCapabilities(),
    note: "IPC isolation spectrum: same-thread (ShadowRealm, vm.Context) → separate thread (Worker) → separate process (Bun.spawn IPC). Choose by risk profile. Toggle via KIMI_ISOLATION=worker|realm|messageport.",
  });
}

// ── VM Context ─────────────────────────────────────────────────────

export async function apiVmContext(): Promise<Response> {
  const vm = await import("node:vm");
  const caps = getIsolationCapabilities();
  const requestedMode = Bun.env.KIMI_ISOLATION ?? "realm";
  const isolation = createIsolation(requestedMode);

  const ctx = vm.createContext({ x: 1 });
  vm.runInContext("x = x + 1", ctx);

  const { port1, port2 } = new MessageChannel();
  const messages: string[] = [];
  port2.on("message", (msg) => messages.push(String(msg)));
  port1.postMessage("hello from outer context");
  port2.close();

  let roundtripMs: number | null = null;
  if (isolation.mode === "messageport" && isolation.available) {
    try {
      const channel = isolation.createChannel();
      const start = performance.now();
      await new Promise<void>((resolve, reject) => {
        channel.hostPort.once("message", (msg: unknown) => {
          if (msg === "pong") resolve();
          else reject(new Error("unexpected roundtrip reply"));
        });
        channel.hostPort.postMessage("ping");
      });
      roundtripMs = performance.now() - start;
      channel.dispose();
    } catch {
      roundtripMs = null;
    }
  }

  const evalResult = await isolation.evaluateScript("1 + 1");

  const moveStatus = caps.messagePort
    ? "success"
    : "not yet implemented (moveMessagePortToContext probe failed)";

  return jsonResponse({
    vmContext: {
      initial: 1,
      afterRunInContext: vm.runInContext("x", ctx),
      verified: vm.runInContext("x", ctx) === 2,
    },
    messageChannel: {
      sent: "hello from outer context",
      received: messages,
    },
    isolationFactory: {
      requestedMode,
      resolvedMode: isolation.mode,
      available: isolation.available,
      evalResult,
      roundtripMs,
      capabilities: caps,
    },
    moveMessagePortToContext: moveStatus,
    isolationStack: {
      shadowRealm: caps.shadowRealm ? "✅ Available — evaluate() + importValue()" : "❌ unavailable",
      worker: caps.worker ? "✅ Available — new Worker() + postMessage" : "❌ unavailable",
      vmContext: "✅ Available — vm.createContext() + runInContext()",
      movePort: caps.messagePort ? "✅ success" : `❌ ${moveStatus}`,
    },
    note: "Isolation factory (KIMI_ISOLATION) selects worker / realm / messageport. messageport uses moveMessagePortToContext when the runtime probe passes; otherwise falls back to realm.",
  });
}

// ── ShadowRealm ────────────────────────────────────────────────────

export async function apiShadowRealm(): Promise<Response> {
  const realmIso = createIsolation("realm");

  await Bun.write("/tmp/_realm_module.js", `
export function add(a, b) { return a + b; }
export function multiply(a, b) { return a * b; }
export const version = "realm-v1";
`);

  const realm = new ShadowRealm();

  realm.evaluate("globalThis.secret = 'inside-realm'");
  const innerSecret = realm.evaluate("globalThis.secret");
  const outerSecret = (globalThis as { secret?: string }).secret;

  const factoryEval = await realmIso.evaluateScript("2 * 3");

  const add = await realm.importValue("/tmp/_realm_module.js", "add");
  const multiply = await realm.importValue("/tmp/_realm_module.js", "multiply");
  const version = await realm.importValue("/tmp/_realm_module.js", "version");

  let bridged: unknown = null;
  let bridgeError: string | null = null;
  try {
    await Bun.write("/tmp/_realm_bridge.js", `
export function applyCallback(cb, x) { return cb(x) * 2; }
`);
    const applyCallback = await realm.importValue("/tmp/_realm_bridge.js", "applyCallback");
    bridged = applyCallback((x: number) => x ** 3, 2);
  } catch (err) {
    bridgeError = err instanceof Error ? err.message : String(err);
  }

  return jsonResponse({
    factory: {
      mode: realmIso.mode,
      evaluateScript: factoryEval,
    },
    isolate: {
      innerSecret,
      outerSecret: outerSecret ?? "undefined",
      verified: innerSecret === "inside-realm" && outerSecret === undefined,
    },
    imports: {
      "add(2,3)": add(2, 3),
      "multiply(4,5)": multiply(4, 5),
      version,
    },
    bridging: {
      expression: "applyCallback(x => x**3, 2)",
      expected: 16,
      result: bridged,
      error: bridgeError,
    },
    note: "ShadowRealm — TC39 proposal. Factory evaluateScript() for code strings; importValue() for module bridging (direct ShadowRealm only).",
  });
}

// ── Transpiler Scan ────────────────────────────────────────────────

interface EffectMethod {
  file: string;
  exports: string[];
  importCount: number;
}

export async function apiTranspilerScan(): Promise<Response> {
  // Scan dashboard's own source files
  const files = ["src/index.ts", "src/lib/toolchain-paths.ts"];
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const results: EffectMethod[] = [];

  for (const f of files) {
    const path = `${import.meta.dir}/../${f}`;
    try {
      const source = await Bun.file(path).text();
      const scan = transpiler.scan(source);
      results.push({ file: f, exports: scan.exports, importCount: scan.imports.length });
    } catch {
      results.push({ file: f, exports: [], importCount: 0 });
    }
  }

  const totalExports = results.reduce((s, r) => s + r.exports.length, 0);

  return jsonResponse({
    results,
    totalExports,
    pipeline: [
      "Bun.Transpiler({ loader: 'ts' })",
      ".scan(source) → { exports: string[], imports: [...] }",
      "No execution — pure static analysis",
      "~10ms for entire effect directory",
      "Feeds into perf-monitor: know what to measure before calling",
    ],
    note: "Bun.Transpiler.scan() discovers exported names without executing code. Pure function, same source → same exports. Use for static manifests, auto-registration, CI gating.",
  });
}

// ── Extract Methods ────────────────────────────────────────────────

interface MethodDescriptor {
  name: string;
  async: boolean;
  params: string[];
}

export function extractEffectMethods(source: string): MethodDescriptor[] {
  const methods: MethodDescriptor[] = [];

  // export async function name(params)
  const fnRegex = /export\s+async\s+function\s+(\w+)\s*\(([^)]*)\)/g;
  let match;
  while ((match = fnRegex.exec(source)) !== null) {
    methods.push({ name: match[1], async: true, params: match[2].split(",").map((p) => p.trim()).filter(Boolean) });
  }

  // export const name = async (...) =>
  const arrowRegex = /export\s+const\s+(\w+)\s*=\s*async\s*\(([^)]*)\)\s*=>/g;
  while ((match = arrowRegex.exec(source)) !== null) {
    methods.push({ name: match[1], async: true, params: match[2].split(",").map((p) => p.trim()).filter(Boolean) });
  }

  // export function name(params) (sync, skip if already captured)
  const syncFnRegex = /export\s+function\s+(\w+)\s*\(([^)]*)\)/g;
  while ((match = syncFnRegex.exec(source)) !== null) {
    if (!methods.some((m) => m.name === match![1])) {
      methods.push({ name: match[1], async: false, params: match[2].split(",").map((p) => p.trim()).filter(Boolean) });
    }
  }

  return methods;
}

export async function apiExtractMethods(): Promise<Response> {
  // Scan the dashboard's own source files as a demo
  const files = ["src/index.ts", "src/lib/toolchain-paths.ts"];
  const results: { file: string; methods: MethodDescriptor[] }[] = [];

  for (const f of files) {
    const path = `${import.meta.dir}/../${f}`;
    try {
      const source = await Bun.file(path).text();
      results.push({ file: f, methods: extractEffectMethods(source) });
    } catch {
      results.push({ file: f, methods: [] });
    }
  }

  const exportedFromIndex = results.find((r) => r.file === "src/index.ts")?.methods.filter(
    (m) => m.name.startsWith("api") || m.name.startsWith("format") || m.name.startsWith("verify")
  ) ?? [];

  return jsonResponse({
    scanned: results,
    summary: `${results.reduce((s, r) => s + r.methods.length, 0)} methods across ${results.length} files`,
    exportedFromIndex: exportedFromIndex.slice(0, 10),
    philosophy: "Static analysis before runtime. extractEffectMethods(source) is pure — no globals, no runtime reflection. Bun.Transpiler can parse; regex for lightweight extraction. Same output → same method list.",
  });
}

// ── Scaffold ───────────────────────────────────────────────────────

export async function apiScaffold(): Promise<Response> {
  return jsonResponse({
    architecture: {
      scriptGenerator: { file: "src/domain/scaffold-plan.ts", exports: ["generatePackageScripts()", "generatePackageJson()"] },
      fileMappings: { file: "src/domain/scaffold-plan.ts", role: "computeFileMappings() generates package.json + init.ts" },
      cli: { file: "src/bin/kimi-scaffold.ts", role: "reads KIMI_MODULES, writes all files" },
    },
    example: {
      command: "KIMI_MODULES=trace,image,perf bun create kimi my-api",
      output: [
        "package.json with scripts: perf, perf:gates, perf:train, perf:report, perf:watch",
        "src/init.ts with Symbol registrations for each module",
        "src/harness/ — full performance monitoring suite",
        "src/guardian/perf-gate.ts — CI gate logic",
        "bunfig.toml — globalStore = true, [doctor.thresholds]",
      ],
    },
    scripts: {
      perf: "bun run src/bin/perf-doctor.ts --perf-gates --report",
      "perf:gates": "bun run src/bin/perf-doctor.ts --perf-gates",
      "perf:train": "bun run src/bin/perf-doctor.ts --perf-gates --train --out=.",
      "perf:report": "bun run src/bin/perf-doctor.ts --report --open",
      "perf:watch": "bun run src/bin/perf-doctor.ts --watch --perf-gates --report",
    },
    note: "Self-bootstrapping: KIMI_MODULES env var → computeFileMappings → generatePackageJson → write all files. One command to scaffold a complete, gated, self-calibrating Bun project.",
  });
}

// ── Effect Image ───────────────────────────────────────────────────

async function apiEffectImage(): Promise<Response> {
  // Stage 1: Static scan — discover what to measure
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const source = await Bun.file(`${import.meta.dir}/effect/image/processor.ts`).text();
  const scan = transpiler.scan(source);

  // Stage 2: Dynamic import — load the real effect
  const mod = await import("./effect/image/processor.ts");

  // Stage 3: Benchmark — measure each exported function
  const metrics: {
    operation: string;
    actualMs: number;
    thresholdMs: number;
    pass: boolean;
  }[] = [];

  for (const exp of scan.exports) {
    const fn = (mod as Record<string, unknown>)[exp];
    if (typeof fn !== "function" || exp === "imageEffect") continue;

    const start = performance.now();
    try {
      await (fn as () => Promise<unknown>)();
      const elapsed = performance.now() - start;
      const threshold = exp === "workload" ? 20 : exp === "convertFormats" ? 15 : 10;
      metrics.push({
        operation: exp,
        actualMs: Math.round(elapsed * 1000) / 1000,
        thresholdMs: threshold,
        pass: elapsed <= threshold,
      });
    } catch {
      metrics.push({
        operation: exp,
        actualMs: -1,
        thresholdMs: 10,
        pass: false,
      });
    }
  }

  // Stage 4: Train — compute new thresholds (10% margin)
  const trained: Record<string, number> = {};
  for (const m of metrics) {
    if (m.actualMs > 0) {
      trained[`kimi.effect.image.${m.operation}`] = Math.round(m.actualMs * 1.1 * 1000) / 1000;
    }
  }

  // Stage 5: Report — generate HTML table
  const passCount = metrics.filter((m) => m.pass).length;
  const report = `📊 ${passCount}/${metrics.length} operations within thresholds\n${metrics
    .map((m) => `  ${m.operation}: ${m.actualMs > 0 ? m.actualMs + "ms" : "ERR"} ≤ ${m.thresholdMs}ms ${m.pass ? "✅" : "❌"}`)
    .join("\n")}`;

  return jsonResponse({
    pipeline: ["1. Transpiler.scan(source) → 7 exports", "2. Dynamic import → real effect handler", "3. Benchmark each → Metric[]", "4. Train → thresholds with 10% margin", "5. Report → human-readable summary"],
    scan: { file: "effect/image/processor.ts", exports: scan.exports },
    metrics,
    trained,
    report,
    symbolKey: "Symbol.for('kimi.effect.image')",
    note: "Full closed loop proven: scan → import → benchmark → train → report. Same pipeline scales to any effect module. Add to MODULE_REGISTRY with workload + thresholdMs.",
  });
}

// ── File Split ─────────────────────────────────────────────────────

async function apiFileSplit(): Promise<Response> {
  // Demonstrate splitting a sample file by // ── Section ── markers
  const sample = `// ── Health ────────────────────────────────────────────────────────
export async function apiHealth() {
  return json({ status: "ok" });
}

// ── Inspect ────────────────────────────────────────────────────────
export async function apiInspect() {
  const obj = { nested: { a: 1 } };
  return json({ default: Bun.inspect(obj) });
}

// ── Crypto ─────────────────────────────────────────────────────────
export async function apiCrypto() {
  const hash = new Bun.CryptoHasher("sha256");
  hash.update("hello");
  return json({ sha256: hash.digest("hex") });
}`;

  // Split using the awk pattern
  const sections: { name: string; content: string }[] = [];
  let currentName = "preamble";
  let currentContent = "";

  for (const line of sample.split("\n")) {
    const match = line.match(/^\/\/ ── (.+) ──+$/);
    if (match) {
      if (currentContent.trim()) {
        sections.push({ name: currentName, content: currentContent.trim() });
      }
      currentName = match[1].replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
      currentContent = "";
    } else {
      currentContent += line + "\n";
    }
  }
  if (currentContent.trim()) {
    sections.push({ name: currentName, content: currentContent.trim() });
  }

  return jsonResponse({
    inputLines: sample.split("\n").length,
    sections: sections.map((s) => ({
      file: `${s.name}.ts`,
      lines: s.content.split("\n").filter(Boolean).length,
      preview: s.content.slice(0, 80) + (s.content.length > 80 ? "..." : ""),
    })),
    awkCommand: `for f in *.ts; do awk '/^\\/\\/ === .* ===$/{out=substr($0,6,length($0)-10); gsub(/[^a-z0-9.\\/]/,"-",out); next} out{print > out}' "$f"; done`,
    note: "awk one-liner splits TypeScript files by // ── Section ── markers into per-handler files. dashboard/src/handlers/ contains the split result (60 files). Zero dependencies, POSIX-compatible.",
  });
}

// ── Kimi Publish ───────────────────────────────────────────────────

export async function apiKimiPublish(): Promise<Response> {
  return jsonResponse({
    pipeline: [
      "1. ensureReadme() — generate README from package.json if missing",
      "2. ensureReadmeField() — add 'readme' field to package.json",
      "3. runPrePublishGates() — kimi-doctor --perf-gates (skip with --no-perf-gates)",
      "4. bun publish — actual publish (with --access, --tag, etc.)",
    ],
    flags: [
      { flag: "--no-perf-gates", description: "Skip performance gates before publish" },
      { flag: "--dry-run", description: "Print what would happen without publishing" },
    ],
    tomlOverridesNote: "bunfig.toml [doctor.thresholds] overrides: probes Bun.TOML.parse, silently skips if unavailable. Human overrides take highest precedence over thresholds.json and defaults.",
    note: "kimi publish ensures every published package has a README, a readme field in package.json, and passes performance gates. Artifact-quality gate before npm registry push.",
  });
}

// ── Threshold Overrides ────────────────────────────────────────────

export async function apiThresholdOverrides(): Promise<Response> {
  const dashboardRoot = `${import.meta.dir}/..`;
  const sources = await resolveThresholdSources(dashboardRoot);

  return jsonResponse({
    sources: {
      bunfig: "./bunfig.toml",
      trained: sources.trained,
      defaults: Object.keys(sources.defaults).length,
    },
    bunfigOverrides: sources.bunfig,
    trainedOverrides: sources.trained,
    programmaticOverrides: sources.programmatic,
    merged: sources.merged,
    precedence: [
      { layer: 1, source: "overrideThresholds() API", method: "Programmatic" },
      { layer: 2, source: "bunfig.toml", method: "Human config ([doctor.thresholds])" },
      { layer: 3, source: "thresholds.json", method: "Machine-trained (perf:train)" },
      { layer: 4, source: "DEFAULT_THRESHOLDS", method: "Built-in fallback" },
    ],
    exampleConfig: `# bunfig.toml
[doctor.thresholds]
"kimi.effect.image.metadata" = 3.5
"kimi.effect.isolation.roundtrip" = 150`,
    note: "4-layer precedence: overrideThresholds() > bunfig.toml > thresholds.json > DEFAULT_THRESHOLDS. loadThresholds() in perf-monitor applies this stack.",
  });
}

// ── Perf Auto-Discover ─────────────────────────────────────────────

export async function apiPerfAutoDiscover(): Promise<Response> {
  const files = [
    { path: "src/lib/isolation/factory.ts", symbol: "kimi.effect.isolation" },
    { path: "src/lib/isolation/realm.ts", symbol: "kimi.effect.isolation" },
    { path: "src/lib/isolation/worker.ts", symbol: "kimi.effect.isolation" },
  ];

  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const discovered: { file: string; symbol: string; exports: string[] }[] = [];
  for (const f of files) {
    const fullPath = `${import.meta.dir}/${f.path}`;
    try {
      const source = await Bun.file(fullPath).text();
      const scan = transpiler.scan(source);
      discovered.push({ file: f.path, symbol: f.symbol, exports: scan.exports });
    } catch {
      discovered.push({ file: f.path, symbol: f.symbol, exports: [] });
    }
  }

  // Auto-benchmark each discovered export
  const metrics: { symbol: string; operation: string; actualMs: number; pass: boolean }[] = [];
  for (const d of discovered) {
    for (const exp of d.exports) {
      const mod = await import(`./${d.file.replace(/\.ts$/, ".ts")}`);
      const fn = mod[exp];
      if (typeof fn !== "function") continue;
      const start = performance.now();
      try {
        if (exp === "createIsolation") {
          (fn("realm") as any).run?.(() => 1);
        } else {
          fn();
        }
        metrics.push({ symbol: d.symbol, operation: exp, actualMs: performance.now() - start, pass: true });
      } catch {
        metrics.push({ symbol: d.symbol, operation: exp, actualMs: -1, pass: false });
      }
    }
  }

  return jsonResponse({
    discovered,
    metrics,
    totalExports: discovered.reduce((s, d) => s + d.exports.length, 0),
    pipeline: "Transpiler.scan(source) → exports[] → dynamic import → benchmark each → Metric[]",
    philosophy: "No manual workload definitions. Source code IS the contract. Works for any effect module — just add its file path.",
  });
}

// ── Perf Registry ──────────────────────────────────────────────────

export async function apiPerfRegistry(): Promise<Response> {
  const metrics = await runEffectBenchmarks();
  const gate = perfGate(metrics);

  return jsonResponse({
    metrics: metrics.map((m) => ({
      name: m.registryKey ?? m.operation,
      symbol: m.symbol,
      actualMs: m.actualMs,
      thresholdMs: m.thresholdMs,
      pass: m.pass,
    })),
    allPass: gate.pass,
    registrySize: metrics.length,
    failures: gate.failures,
    philosophy:
      "MODULE_REGISTRY → runEffectBenchmarks() → loadThresholds() merges thresholds.json over defaults. --train closes the loop.",
  });
}

export async function apiPerfTrain(): Promise<Response> {
  const metrics = await runEffectBenchmarks();
  const result = await trainThresholds(metrics, import.meta.dir + "/..");
  return jsonResponse({ metrics, train: result });
}

export async function apiPerfReport(): Promise<Response> {
  const metrics = await runEffectBenchmarks();
  const html = generatePerfHTML(metrics);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function apiPerfHarness(): Promise<Response> {
  const metrics = await runEffectBenchmarks();
  const gate = perfGate(metrics);

  return jsonResponse({
    metrics: metrics.map((m) => ({
      name: m.registryKey ?? m.operation,
      symbol: m.symbol,
      actualMs: m.actualMs,
      thresholdMs: m.thresholdMs,
      pass: m.pass,
    })),
    allPass: gate.pass,
    failures: gate.failures,
    summary: `${metrics.filter((m) => m.pass).length}/${metrics.length} modules within threshold`,
    philosophy:
      "Same path as /api/perf-registry: MODULE_REGISTRY → runEffectBenchmarks() → loadThresholds() (defaults + thresholds.json + bunfig).",
  });
}

// ── Image ──────────────────────────────────────────────────────────

export async function apiImage(): Promise<Response> {
  // Valid 2x2 red PNG served as a data URL (Bun.Image accepts path, URL, TypedArray, or data: URL)
  const pngDataUrl =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGP4z8DwnwGM/zMwAAAf7gP9NRsAMwAAAABJRU5ErkJggg==";
  const inputBytes = Math.ceil(pngDataUrl.length * 0.75); // rough base64 byte count

  const img = new Bun.Image(pngDataUrl);

  // Resize + convert
  const thumb = img.resize(1);
  const webpBytes = await thumb.webp().bytes();
  const pngBytes = await thumb.png().bytes();

  // Metadata (no decode required)
  const meta = await img.metadata();

  return jsonResponse({
    input: { bytes: inputBytes, width: meta.width, height: meta.height },
    metadata: meta,
    pipeline: [".image()", ".metadata()", ".resize(1)", ".webp().bytes()", ".png().bytes()"],
    output: {
      webp: { bytes: webpBytes?.byteLength ?? 0 },
      png: { bytes: pngBytes?.byteLength ?? 0 },
    },
    availableMethods: ["metadata()", "placeholder()", "resize(w)", "jpeg()", "webp()", "png()", "avif()", "flip()", "flop()", "rotate(deg)", "modulate({hue,saturation,brightness})", "toBase64()", "blob()", "write(path)"],
    globalStore: "install.globalStore = true in bunfig.toml — immutable content-addressed cache, warm installs ~1 symlink/pkg",
    note: "Bun.Image — built-in image pipeline. metadata() reads dimensions without decoding. placeholder() generates thumbhash data URL for blur-up. Chain transforms, zero-copy. AsyncLocalStorage.snapshot() not yet available in v1.4.0-canary.",
  });
}

// ── Spawn Sync ─────────────────────────────────────────────────────

export async function apiSpawnSync(): Promise<Response> {
  const proc = Bun.spawnSync(["echo", "hello from spawnSync"]);
  const stdout = proc.stdout?.toString().trim() ?? "";
  const usage = proc.resourceUsage;

  return jsonResponse({
    stdout,
    exitCode: proc.exitCode,
    success: proc.success,
    pid: proc.pid,
    resourceUsage: usage ? {
      maxRSS: `${(usage.maxRSS / 1024 / 1024).toFixed(1)} MB`,
      cpuUser: `${usage.cpuTime.user} µs`,
      cpuSystem: `${usage.cpuTime.system} µs`,
      messages: usage.messages,
      contextSwitches: usage.contextSwitches,
    } : null,
    note: "Bun.spawnSync — blocking, returns Buffer stdout/stderr. 60% faster than Node.js child_process. resourceUsage() gives CPU, memory, context switches.",
  });
}

// ── IPC ────────────────────────────────────────────────────────────

export async function apiIpc(): Promise<Response> {
  const childCode = `
process.on("message", (msg) => {
  process.send({ echo: msg, from: "child", pid: process.pid });
});
process.send({ ready: true, pid: process.pid });
`;
  await Bun.write("/tmp/_ipc_child.ts", childCode);

  const messages: { direction: string; data: unknown }[] = [];

  return new Promise((resolve) => {
    const child = Bun.spawn(["bun", "run", "/tmp/_ipc_child.ts"], {
      ipc(msg) {
        messages.push({ direction: "child→parent", data: msg });
        // Got echo back — done
        if ((msg as any).echo) {
          child.kill();
        }
      },
      serialization: "json",
    });

    child.send({ hello: "from parent" });

    // Safety timeout
    setTimeout(async () => {
      try { child.kill(); } catch {}
      await child.exited.catch(() => {});
      resolve(jsonResponse({
        childPid: child.pid,
        messages,
        parentApi: "child.send(msg) + ipc(handler)",
        childApi: "process.send(msg) + process.on('message', handler)",
        serialization: "json (cross-engine compat)",
        note: "Bun.spawn IPC: native message passing. serialization: 'advanced' (default, JSC) or 'json' (Node.js compat). Bun↔Node IPC works with 'json'.",
      }));
    }, 3000);
  });
}

// ── Child Process ──────────────────────────────────────────────────

export async function apiExec(): Promise<Response> {
  const { exec } = await import("node:child_process");

  return new Promise((resolve) => {
    let results: Record<string, { stdout: string; stderr: string }> = {};
    let pending = 3;

    const done = () => {
      if (--pending === 0) {
        resolve(jsonResponse({
          results,
          note: "node:child_process.exec() — runs command string through a shell. Use quotes for paths with spaces. \\$ escapes variables. Bun mirrors Node.js exec exactly.",
        }));
      }
    };

    exec("echo hello from exec", (err, stdout, stderr) => {
      results.basic = { stdout: stdout.trim(), stderr: stderr.trim() };
      done();
    });

    exec('echo "path with spaces intact"', (err, stdout, stderr) => {
      results.quoted = { stdout: stdout.trim(), stderr: stderr.trim() };
      done();
    });

    exec("echo HOME is $HOME", (err, stdout, stderr) => {
      results.variableExpansion = { stdout: stdout.trim(), stderr: stderr.trim() };
      done();
    });
  });
}

// ── Glob Orphan ────────────────────────────────────────────────────

export async function apiGlobOrphan(): Promise<Response> {
  const { Glob } = await import("bun");

  // Scan repo for test files and snapshot files
  const snapPattern = "**/__snapshots__/*.snap";
  const testPattern = "**/*.test.ts";
  const snaps = [...new Glob(snapPattern).scanSync({ cwd: process.cwd() })];
  const tests = [...new Glob(testPattern).scanSync({ cwd: process.cwd() })];

  const orphans: string[] = [];
  for (const s of snaps) {
    // Remove __snapshots__/<name>.snap → derive expected test file base
    // Regex handles nested dirs: src/a/__snapshots__/foo.snap → src/a/foo
    const base = s.replace(/__snapshots__\/(.+)\.snap$/, "$1");
    const expectedTest = base + ".test.ts";
    if (!tests.some((t) => t === expectedTest || t.endsWith("/" + expectedTest))) {
      orphans.push(s);
    }
  }

  return jsonResponse({
    patterns: { snapshots: snapPattern, tests: testPattern },
    counts: { snapshots: snaps.length, tests: tests.length, orphans: orphans.length },
    orphans: orphans.slice(0, 10),
    // Per-package scan (monorepo style)
    perPackage: (() => {
      const pkgs = [...new Glob("packages/*").scanSync({ cwd: process.cwd(), onlyFiles: false })];
      return pkgs.slice(0, 3).map((pkg) => {
        const pkgSnaps = [...new Glob(`${pkg}/**/__snapshots__/**/*.snap`).scanSync({ cwd: process.cwd() })];
        return { package: pkg, snapshots: pkgSnaps.length };
      });
    })(),
    oneLiner: 'bun -e \'\n' +
      'const { Glob } = require("bun");\n' +
      'const snaps = [...new Glob("**/__snapshots__/*.snap").scanSync()];\n' +
      'const tests = [...new Glob("**/*.test.ts").scanSync()];\n' +
      'for (const s of snaps) {\n' +
      '  const base = s.replace(/__snapshots__\\/(.+)\\.snap$/, "$1");\n' +
      '  const expected = base + ".test.ts";\n' +
      '  if (!tests.some(t => t === expected || t.endsWith("/" + expected)))\n' +
      '    console.log("ORPHAN:", s);\n' +
      '}\'\n' +
      '// Monorepo per-package variant:\n' +
      '// const packages = [...new Glob("packages/*").scanSync()];\n' +
      '// for (const pkg of packages) {\n' +
      '//   const snaps = [...new Glob(`${pkg}/**/__snapshots__/**/*.snap`).scanSync()];\n' +
      '//   ...',
    note: "Autophagy scan: Bun.Glob.scanSync() cross-references __snapshots__ against test files. Regex handles nested dirs. Per-package variant for monorepos. Live-recomputed every request — no cached badges.",
  });
}

// ── Cron ──────────────────────────────────────────────────────────

export async function apiCron(): Promise<Response> {
  const started = Date.now();

  return new Promise((resolve) => {
    let fired = false;
    let firedAt = 0;
    let job: { stop(): void } | undefined;

    try {
      // Bun.cron uses 5 fields: minute hour day month weekday
      job = Bun.cron("* * * * *", () => {
        if (!fired) {
          fired = true;
          firedAt = Date.now();
          job?.stop();
          resolve(jsonResponse({
            pattern: "* * * * * (every minute)",
            fired: true,
            latencyMs: firedAt - started,
            note: "Bun.cron(cronExpression, callback) — native cron scheduler. job.stop() to cancel. Uses 5 fields (minute hour day month weekday).",
          }));
        }
      });
    } catch (err) {
      resolve(jsonResponse({
        pattern: "* * * * *",
        fired: false,
        error: err instanceof Error ? err.message : String(err),
        note: "Bun.cron may not be supported in this environment.",
      }));
      return;
    }

    // Timeout safety: resolve after 2s if cron doesn't fire
    setTimeout(() => {
      if (!fired) {
        job?.stop();
        resolve(jsonResponse({
          pattern: "* * * * *",
          fired: false,
          error: "Cron did not fire within 2s",
          note: "Bun.cron schedules at minute granularity; the demo timeout fired first.",
        }));
      }
    }, 2000);
  });
}

// ── Transpiler ─────────────────────────────────────────────────────

export async function apiTranspiler(): Promise<Response> {
  const tsCode = `import { serve } from "bun";

interface User {
  name: string;
  age: number;
}

const greet = (u: User): string => {
  return \`Hello, \${u.name} (\${u.age})\`;
};

serve({
  fetch(req: Request): Response {
    const u: User = { name: "Bun", age: 3 };
    return new Response(greet(u));
  },
});`;

  const t = new Bun.Transpiler({ loader: "ts" });
  const js = t.transformSync(tsCode);

  return jsonResponse({
    inputLines: tsCode.split("\n").length,
    inputBytes: tsCode.length,
    outputBytes: js.length,
    ratio: (js.length / tsCode.length).toFixed(2),
    output: js.slice(0, 400) + (js.length > 400 ? "\n// ..." : ""),
    features: ["type annotations stripped", "interfaces removed", "return types removed", "parameter types removed"],
    note: "Bun.Transpiler — fast TS/JSX → JS. loader: 'ts'|'tsx'|'jsx'. transformSync() or transform() for async.",
  });
}

// ── OS Info ────────────────────────────────────────────────────────

export async function apiOsInfo(): Promise<Response> {
  const os = await import("node:os");

  return jsonResponse({
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    homedir: os.homedir(),
    cpus: { count: os.cpus().length, model: os.cpus()[0]?.model ?? "unknown" },
    memory: {
      freeMB: (os.freemem() / 1024 / 1024).toFixed(0),
      totalGB: (os.totalmem() / 1024 / 1024 / 1024).toFixed(1),
    },
    uptime: { seconds: os.uptime(), hours: (os.uptime() / 3600).toFixed(1) },
    network: Object.fromEntries(Object.entries(os.networkInterfaces()).map(([k, v]) => [k, v?.length ?? 0])),
    userInfo: { username: os.userInfo().username, shell: os.userInfo().shell },
    note: "node:os — cross-platform OS info. Bun mirrors Node.js os module exactly.",
  });
}

// ── Random Bytes ───────────────────────────────────────────────────

export async function apiRandomBytes(): Promise<Response> {
  const { randomBytes, randomFillSync } = await import("node:crypto");

  const r1 = randomBytes(16);
  const r2 = randomBytes(8);
  const buf = new Uint8Array(12);
  randomFillSync(buf);

  return jsonResponse({
    randomBytes16: r1.toString("hex"),
    randomBytes8: r2.toString("hex"),
    randomFill12: Buffer.from(buf).toString("hex"),
    note: "node:crypto.randomBytes(n) and randomFillSync(buf) — CSPRNG. Bun mirrors Node.js crypto.randomBytes exactly.",
  });
}

// ── Shell ─────────────────────────────────────────────────────────

export async function apiShell(): Promise<Response> {
  const { $ } = await import("bun");

  // Read package.json fields
  const name = (await $`bun pm pkg get name`.quiet().text()).trim();
  const version = (await $`bun pm pkg get version`.quiet().text()).trim();

  // ShellError handling demo
  let shellError: Record<string, unknown> = { triggered: false };
  try {
    await $`nonexistent-cmd-xyz`.quiet();
  } catch (e: any) {
    if (e.exitCode !== undefined) {
      shellError = {
        triggered: true,
        constructor: e.constructor.name,
        exitCode: e.exitCode,
        stderr: e.stderr?.toString().slice(0, 60) ?? "",
      };
    }
  }

  // ShellPromise chaining
  const stdout = (await $`echo "hello from Bun Shell"`.nothrow().text()).trim();

  return jsonResponse({
    pkgFields: { name, version },
    shellError,
    stdout,
    methods: ["text()", "json()", "lines()", "arrayBuffer()", "bytes()", "blob()", "quiet()", "nothrow()", "throws(bool)", "cwd(dir)", "env(obj)", "run()"],
    note: "Bun Shell: $`cmd` template literals. ShellError.exitCode for branching. .quiet() suppresses echo. .nothrow() prevents throw on non-zero.",
  });
}

// ── Strip ANSI ─────────────────────────────────────────────────────

export async function apiStripAnsi(): Promise<Response> {
  const samples = [
    { input: "\x1b[31mHello\x1b[0m \x1b[32mWorld\x1b[0m", stripped: Bun.stripANSI("\x1b[31mHello\x1b[0m \x1b[32mWorld\x1b[0m") },
    { input: "\x1b[1m\x1b[4mBold and underlined\x1b[0m", stripped: Bun.stripANSI("\x1b[1m\x1b[4mBold and underlined\x1b[0m") },
    { input: "\x1b[33m\x1b[44mYellow on blue\x1b[0m", stripped: Bun.stripANSI("\x1b[33m\x1b[44mYellow on blue\x1b[0m") },
    { input: "Plain text", stripped: Bun.stripANSI("Plain text") },
  ];

  // String width comparison
  const colored = "\x1b[31mHello\x1b[0m \x1b[32mWorld\x1b[0m";
  const widthRaw = Bun.stringWidth(colored);
  const widthStripped = Bun.stringWidth(Bun.stripANSI(colored));

  return jsonResponse({
    samples,
    stringWidth: { raw: widthRaw, stripped: widthStripped, note: "stringWidth correctly ignores ANSI codes" },
    note: "Bun.stripANSI() — SIMD-accelerated, 6x-57x faster than strip-ansi npm. Removes all ANSI escape sequences.",
  });
}

// ── Bun Build ──────────────────────────────────────────────────────

export async function apiBuildCompile(): Promise<Response> {
  return jsonResponse({
    cliFlags: [
      { flag: "--compile", description: "Generate standalone executable" },
      { flag: "--target", description: "bun|bun-darwin-arm64|bun-linux-x64|bun-windows-x64|bun-linux-x64-musl|node" },
      { flag: "--outfile", description: "Output path (.exe on Windows)" },
      { flag: "--minify", description: "Minify output" },
      { flag: "--sourcemap", description: "Generate sourcemap (inline|external|none)" },
      { flag: "--compile-exec-argv", description: "Embed runtime args into executable (process.execArgv)" },
      { flag: "--user-agent", description: "Override User-Agent header for fetch()" },
      { flag: "--windows-title", description: "Windows EXE: application title" },
      { flag: "--windows-publisher", description: "Windows EXE: publisher name" },
      { flag: "--windows-version", description: "Windows EXE: version (e.g. 1.2.3.4)" },
      { flag: "--windows-description", description: "Windows EXE: file description" },
      { flag: "--windows-copyright", description: "Windows EXE: copyright string" },
      { flag: "--windows-icon", description: "Windows EXE: .ico file path" },
    ],
    apiExamples: [
      {
        label: "Shorthand target",
        code: `await Bun.build({
  entrypoints: ["./cli.ts"],
  compile: "bun-linux-x64-musl",  // cross-compile shorthand
});`,
      },
      {
        label: "Full config + Windows icon",
        code: `await Bun.build({
  entrypoints: ["./cli.ts"],
  compile: {
    target: "bun-windows-x64",
    outfile: "./my-app-windows",
    windows: { icon: "./icon.ico" },
  },
});`,
      },
      {
        label: "Embed runtime flags",
        code: `bun build ./index.ts --compile --outfile=my-app \\
  --compile-exec-argv="--smol --user-agent=MyApp/1.0"
// process.execArgv = ["--smol", "--user-agent=MyApp/1.0"]`,
      },
    ],
    bunxPackage: 'bunx --package renovate renovate-config-validator  # binary ≠ package name',
    sideEffectsGlob: 'package.json: { "sideEffects": ["**/*.css", "./src/components/*.js"] } — supports *, ?, **, [], {}',
    note: "Bun.build() now supports compile as string (shorthand) or object. bundler plugins supported. --compile-exec-argv embeds runtime args. bunx --package handles name≠binary.",
  });
}

// ── Bun Test ───────────────────────────────────────────────────────

export async function apiBunTest(): Promise<Response> {
  return jsonResponse({
    imports: ['test', 'expect', 'describe', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'mock', 'spyOn'],
    sampleTest: `import { test, expect } from "bun:test";

test("trace formatting", () => {
  const traces = [
    { traceId: "req-001", status: 200, contentType: "application/json", bodyHash: Bun.SHA256.hash("hello") },
  ];
  expect(traces[0].status).toBe(200);
  expect(traces[0].traceId).toMatch(/^req-/);
  expect(traces).toBeArray();
});`,
    snapshotHelper: `import { test, expect } from "bun:test";

// Reusable snapshot helper for any inspect output
const snapshot = (label, data, opts) => {
  test(label, () => {
    const out = Bun.inspect(data, { colors: true, sorted: true, ...opts });
    expect(Bun.stripANSI(out)).toMatchSnapshot();
  });
};

snapshot("HTTP trace table", traces, { depth: 2 });
snapshot("Deep error stack", error, { depth: 6, showHidden: true });`,
    expectMatchers: [
      "toBe(value)", "toEqual(value)", "toStrictEqual(value)",
      "toBeNull()", "toBeUndefined()", "toBeTruthy()", "toBeFalsy()",
      "toMatch(regex)", "toMatchSnapshot()",
      "toBeArray()", "toContain(item)", "toContainEqual(item)",
      "toThrow()", "toThrowErrorLike(obj)",
      "toBeInstanceOf(cls)", "toBeNaN()", "toBeFinite()",
      "toBeGreaterThan(n)", "toBeLessThan(n)",
      "toHaveProperty(key)", "toHaveLength(n)",
    ],
    mockFunctions: [
      "mock(() => value)", "mock((arg) => result)",
      "spyOn(obj, 'method')",
    ],
    runCommand: "bun test",
    cliFlags: [
      { flag: "--filter", value: '"@myorg/*"', description: "Run tests in matching workspace packages" },
      { flag: "--shard", value: "1/4", description: "Split tests across CI jobs (deterministic round-robin)" },
      { flag: "--parallel", value: "4", description: "Run N test files concurrently (work-stealing)" },
      { flag: "--isolate", description: "Run each test file in a separate subprocess" },
      { flag: "--rerun-each", value: "3", description: "Re-run each test file N times for flake hunting" },
      { flag: "--bail", value: "5", description: "Exit after N test failures" },
      { flag: "--timeout", value: "10000", description: "Per-test timeout in ms" },
    ],
    note: "bun:test — Bun's built-in test runner. --filter for monorepos, --shard for CI splitting, --parallel for speed, --isolate per process. expect() only inside test() blocks. Snapshot helper: Bun.inspect + Bun.stripANSI + toMatchSnapshot for color-stable output.",
  });
}

// ── Deep Match ─────────────────────────────────────────────────────

export async function apiDeepMatch(): Promise<Response> {
  const traces = [
    { traceId: "abc-123", status: 200, contentType: "application/json" },
    { traceId: "def-456", status: 404, contentType: "text/html" },
    { traceId: null, status: "bad", contentType: "text/plain" }, // bad shape
  ];

  const results = traces.map((t) => {
    // Production: manual type checks
    const prodCheck = typeof t.traceId === "string" && typeof t.status === "number";

    // Exact structural match
    const exactMatch = Bun.deepMatch(t, { traceId: "abc-123", status: 200, contentType: "application/json" });

    return {
      trace: JSON.stringify(t),
      prodCheck,
      exactMatch,
      shape: prodCheck ? "valid" : "invalid",
    };
  });

  return jsonResponse({
    results,
    validCount: results.filter((r) => r.prodCheck).length,
    note: "Bun.deepMatch(a, b) — exact structural match (not subset). Manual type checks (typeof) for shape validation. expect.any() matchers with deepMatch not yet available in Bun v1.4.0-canary.",
  });
}

// ── Trace Verify ───────────────────────────────────────────────────

interface TraceSummary {
  traceId: string;
  status: number;
  contentType: string;
  bodyHash: Uint8Array;
}

export function formatTraceTable(traces: TraceSummary[]): string {
  const toHex = (buf: Uint8Array) => Buffer.from(buf).toString("hex");
  const rows = traces.map((t) => ({
    traceId: t.traceId,
    status: String(t.status),
    type: t.contentType,
    hash: toHex(t.bodyHash).slice(0, 16) + "...",
    hashWidth: Bun.stringWidth(toHex(t.bodyHash)), // 64 for 32-byte SHA-256
  }));
  return Bun.inspect.table(rows, ["traceId", "status", "type", "hash"], { colors: false });
}

export function verifyTraceHash(trace: TraceSummary, expectedHex: string): { valid: boolean; checks: Record<string, boolean> } {
  const checks: Record<string, boolean> = {};
  checks.byteLength32 = trace.bodyHash.byteLength === 32;
  checks.hexLength64 = expectedHex.length === 64;
  checks.deepEquals = Bun.deepEquals(trace.bodyHash, Buffer.from(expectedHex, "hex"));
  return { valid: Object.values(checks).every(Boolean), checks };
}

export async function apiTraceVerify(): Promise<Response> {
  const traces: TraceSummary[] = [
    { traceId: "req-abc123", status: 200, contentType: "application/json", bodyHash: new Uint8Array(32).fill(0xab) },
    { traceId: "req-def456", status: 404, contentType: "text/html", bodyHash: new Uint8Array(32).fill(0xcd) },
    { traceId: "req-ghi789", status: 201, contentType: "application/octet-stream", bodyHash: new Uint8Array(32).fill(0xef) },
  ];

  const table = formatTraceTable(traces);

  // Verify first trace
  const expectedHex = "ab".repeat(32);
  const verify = verifyTraceHash(traces[0], expectedHex);

  return jsonResponse({
    table,
    verification: {
      traceId: traces[0].traceId,
      expectedHex: expectedHex.slice(0, 16) + "...",
      checks: verify.checks,
      valid: verify.valid,
    },
    note: "Trace verification: Bun.inspect.table(), Bun.stringWidth(), Bun.deepEquals() with Buffer.from(hex,'hex'). Bun.hex() not yet available — use Buffer.from(buf).toString('hex').",
  });
}

// ── Node HTTP ──────────────────────────────────────────────────────

export async function apiNodeHttp(): Promise<Response> {
  const http = await import("node:http");

  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      const body = "hello from node:http";
      res.writeHead(200, {
        "Content-Length": Buffer.byteLength(body),
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

// ── Stream Hash ────────────────────────────────────────────────────

export async function apiStreamHash(): Promise<Response> {
  // Write a test file
  const tmpPath = `/tmp/dashboard-stream-hash-${Date.now()}.bin`;
  const testData = "hello world ".repeat(100); // 1200 bytes
  await Bun.write(tmpPath, testData);

  const { createHash } = await import("node:crypto");

  // Streaming: read via Bun.file().stream(), hash via node:crypto
  const streamHash = createHash("sha256");
  const stream = Bun.file(tmpPath).stream();
  let chunkCount = 0;
  let totalBytes = 0;
  for await (const chunk of stream) {
    chunkCount++;
    totalBytes += chunk.byteLength;
    streamHash.update(chunk); // Uint8Array → works with both Bun and Node hashers
  }
  const streamDigest = streamHash.digest("hex");

  // Non-streaming: whole-file for comparison
  const wholeHash = createHash("sha256");
  const fileBytes = new Uint8Array(await Bun.file(tmpPath).arrayBuffer());
  wholeHash.update(fileBytes);
  const wholeDigest = wholeHash.digest("hex");

  // Also string-based
  const stringHash = createHash("sha256");
  stringHash.update(testData);
  const stringDigest = stringHash.digest("hex");

  // Bun-native one-liner: Bun.SHA256.hash(arrayBuffer())
  const bunHash = Bun.SHA256.hash(await Bun.file(tmpPath).arrayBuffer());
  const bunHex = Buffer.from(bunHash).toString("hex");

  try { await import("node:fs/promises").then(fs => fs.unlink(tmpPath)); } catch { /* ok */ }

  return jsonResponse({
    fileSize: 1200,
    stream: { chunks: chunkCount, totalBytes, digest: streamDigest.slice(0, 24) + "..." },
    whole: { digest: wholeDigest.slice(0, 24) + "..." },
    string: { digest: stringDigest.slice(0, 24) + "..." },
    bunNative: { digest: bunHex.slice(0, 24) + "...", approach: "Bun.SHA256.hash(arrayBuffer()) — one-liner" },
    allMatch: streamDigest === wholeDigest && wholeDigest === stringDigest && stringDigest === bunHex,
    note: "Stream: Bun.file().stream() + node:crypto. One-liner: Bun.SHA256.hash(await file.arrayBuffer()). Bun.hex() not yet available; use Buffer.from(hash).toString('hex').",
  });
}

// ── Smart Write ────────────────────────────────────────────────────

export async function apiWriteSmart(): Promise<Response> {
  const { types } = await import("node:util");
  const tmpPath = `/tmp/dashboard-smart-${Date.now()}.txt`;

  const testCases: { label: string; value: unknown; branch: string }[] = [
    { label: "string", value: "plain text", branch: "" },
    { label: "Uint8Array", value: new Uint8Array([104, 101, 108, 108, 111]), branch: "" },
    { label: "ArrayBuffer", value: new Uint8Array([119, 111, 114, 108, 100]).buffer, branch: "" },
    { label: "number → String", value: 42, branch: "" },
    { label: "null → String", value: null, branch: "" },
  ];

  const results: { label: string; branch: string; wrote: string; read: string }[] = [];

  for (const tc of testCases) {
    let branch = "";
    try {
      if (tc.value instanceof Blob) {
        branch = "Blob";
        await Bun.write(tmpPath, tc.value);
      } else if (typeof tc.value === "string" || types.isArrayBufferView(tc.value) || types.isAnyArrayBuffer(tc.value)) {
        branch = typeof tc.value === "string" ? "string" : types.isArrayBufferView(tc.value) ? "ArrayBufferView" : "ArrayBuffer";
        await Bun.write(tmpPath, tc.value);
      } else {
        branch = "String(value)";
        await Bun.write(tmpPath, String(tc.value));
      }
      const content = await Bun.file(tmpPath).text();
      results.push({ label: tc.label, branch, wrote: String(tc.value).slice(0, 30), read: content });
    } catch (err) {
      results.push({ label: tc.label, branch, wrote: "—", read: `ERROR: ${err}` });
    }
  }

  try { await import("node:fs/promises").then(fs => fs.unlink(tmpPath)); } catch { /* ok */ }

  return jsonResponse({
    results,
    note: "Smart write: branch on instanceof Blob → string → isArrayBufferView → isAnyArrayBuffer → fallback String(). Uses node:util/types for safe type detection.",
  });
}

// ── Inspect Defaults ───────────────────────────────────────────────

export async function apiInspectDefaults(): Promise<Response> {
  const { inspect } = await import("node:util");
  const defaultsBefore = { ...inspect.defaultOptions };

  // Simulate debug-level configuration
  const origDepth = inspect.defaultOptions.depth;
  const origColors = inspect.defaultOptions.colors;
  inspect.defaultOptions.depth = 6;
  inspect.defaultOptions.colors = false;

  const obj = { a: { b: { c: { d: { e: { f: "deep" } } } } } };
  const deepOutput = inspect(obj);

  // Restore
  inspect.defaultOptions.depth = origDepth;
  inspect.defaultOptions.colors = origColors;

  const normalOutput = inspect(obj);

  return jsonResponse({
    defaults: defaultsBefore,
    configured: { depth: 6, colors: false },
    deepOutput: deepOutput.slice(0, 200),
    normalOutput: normalOutput.slice(0, 200),
    note: "node:util.inspect.defaultOptions — configure global inspect behavior. Set depth/colors/compact/sorted. Bun.inspect.defaultOptions not yet available (use node:util).",
  });
}

// ── Password ──────────────────────────────────────────────────────

export async function apiPassword(): Promise<Response> {
  const password = "hunter2";
  const startHash = Bun.nanoseconds();
  const hash = await Bun.password.hash(password);
  const hashEnd = Bun.nanoseconds();
  const verifyOk = await Bun.password.verify(password, hash);
  const verifyBad = await Bun.password.verify("wrong", hash);

  return jsonResponse({
    algorithm: "argon2id (default)",
    hash: hash.slice(0, 40) + "...",
    fullHashLength: hash.length,
    verify: { correct: verifyOk, wrong: verifyBad },
    timing: {
      hashNs: Number(hashEnd - startHash),
      hashMs: Number(hashEnd - startHash) / 1_000_000,
    },
    note: "Bun.password.hash uses argon2id with random salt. Bun.password.verify is constant-time. Async (non-blocking).",
  });
}

// ── CryptoHasher ───────────────────────────────────────────────────

export async function apiCryptoHash(): Promise<Response> {
  // SHA-256 incremental
  const sha256 = new Bun.CryptoHasher("sha256");
  sha256.update("hello ");
  sha256.update("world");

  // SHA-512 one-shot
  const sha512 = new Bun.CryptoHasher("sha512");
  sha512.update("hello world");

  // Bytes output
  const sha256bytes = new Bun.CryptoHasher("sha256");
  sha256bytes.update("hello world");

  return jsonResponse({
    sha256: { input: "'hello ' + 'world'", incremental: true, hex: sha256.digest("hex") },
    sha512: { input: "'hello world'", hex: sha512.digest("hex").slice(0, 32) + "..." },
    bytes: { input: "'hello world'", length: sha256bytes.digest().byteLength },
    algorithms: ["sha256", "sha384", "sha512", "sha512_256", "sha1"],
    note: "Bun.CryptoHasher — incremental hashing. update() multiple times, digest('hex'|'base64'|buffer) to finalize.",
  });
}

// ── SQLite ─────────────────────────────────────────────────────────

export async function apiSqlite(): Promise<Response> {
  const db = new (await import("bun:sqlite")).Database(":memory:");
  db.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)");
  db.run("INSERT INTO users VALUES (?, ?, ?)", [1, "Alice", "alice@example.com"]);
  db.run("INSERT INTO users VALUES (?, ?, ?)", [2, "Bob", "bob@example.com"]);
  db.run("INSERT INTO users VALUES (?, ?, ?)", [3, "Charlie", "charlie@example.com"]);

  const all = db.query("SELECT * FROM users").all();
  const count = db.query("SELECT COUNT(*) as n FROM users").get() as { n: number };
  db.close();

  return jsonResponse({
    engine: "bun:sqlite (in-memory)",
    schema: ["CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)"],
    rows: all,
    count: count.n,
    note: "bun:sqlite Database(':memory:') — zero-config embedded SQL. WAL mode by default. Supports prepared statements, transactions.",
  });
}

// ── File I/O ───────────────────────────────────────────────────────

export async function apiFileIO(): Promise<Response> {
  const tmpPath = `/tmp/dashboard-demo-${Date.now()}.txt`;
  const writeStart = Bun.nanoseconds();
  await Bun.write(tmpPath, "Written by Bun.write() — fast, atomic, Bun-native.");
  const writeEnd = Bun.nanoseconds();

  const file = Bun.file(tmpPath);
  const text = await file.text();
  const size = file.size;
  const mime = file.type;
  const exists = await file.exists();

  // Cleanup (best-effort)
  try { await import("node:fs/promises").then(fs => fs.unlink(tmpPath)); } catch { /* ok */ }

  return jsonResponse({
    path: tmpPath,
    writeNs: Number(writeEnd - writeStart),
    read: { size, mime, text, exists },
    note: "Bun.write(path, data) — atomic write. Bun.file(path) — lazy file handle with .text(), .json(), .arrayBuffer(), .exists().",
  });
}

// ── Glob ───────────────────────────────────────────────────────────

export async function apiGlob(): Promise<Response> {
  const patterns = ["*.ts", "**/*.html", "*.{json,toml}"];

  const results: { pattern: string; count: number; matches: string[] }[] = [];
  for (const pat of patterns) {
    const glob = new Bun.Glob(pat);
    const matches: string[] = [];
    for await (const f of glob.scan({ cwd: import.meta.dir, absolute: false })) {
      matches.push(f);
      if (matches.length >= 5) break; // limit per pattern
    }
    results.push({ pattern: pat, count: matches.length, matches });
  }

  return jsonResponse({
    cwd: import.meta.dir,
    results,
    note: "Bun.Glob(pattern).scan() — async iterable. Supports **, *, {a,b} braces. Faster than fs.readdir + regex.",
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
      case "/api/console":
        return apiConsole();
      case "/api/tty":
        return apiTty();
      case "/api/terminal":
        return apiTerminal();
      case "/api/color":
        return apiColor();
      case "/api/peek":
        return apiPeek();
      case "/api/http2":
        return apiHttp2();
      case "/api/url":
        return apiUrl();
      case "/api/url-node":
        return apiUrlNode();
      case "/api/password":
        return apiPassword();
      case "/api/crypto-hash":
        return apiCryptoHash();
      case "/api/sqlite":
        return apiSqlite();
      case "/api/file-io":
        return apiFileIO();
      case "/api/glob":
        return apiGlob();
      case "/api/glob-orphan":
        return apiGlobOrphan();
      case "/api/util-types":
        return apiUtilTypes();
      case "/api/write-smart":
        return apiWriteSmart();
      case "/api/stream-hash":
        return apiStreamHash();
      case "/api/node-http":
        return apiNodeHttp();
      case "/api/exec":
        return apiExec();
      case "/api/ipc":
        return apiIpc();
      case "/api/spawn-sync":
        return apiSpawnSync();
      case "/api/image":
        return apiImage();
      case "/api/perf-harness":
        return apiPerfHarness();
      case "/api/perf-registry":
        return apiPerfRegistry();
      case "/api/perf-train":
        return apiPerfTrain();
      case "/api/perf-report":
        return apiPerfReport();
      case "/api/perf-auto-discover":
        return apiPerfAutoDiscover();
      case "/api/threshold-overrides":
        return apiThresholdOverrides();
      case "/api/kimi-publish":
        return apiKimiPublish();
      case "/api/scaffold":
        return apiScaffold();
      case "/api/file-split":
        return apiFileSplit();
      case "/api/effect-image":
        return apiEffectImage();
      case "/api/extract-methods":
        return apiExtractMethods();
      case "/api/transpiler-scan":
        return apiTranspilerScan();
      case "/api/shadow-realm":
        return apiShadowRealm();
      case "/api/vm-context":
        return apiVmContext();
      case "/api/ipc-matrix":
        return apiIpcMatrix();
      case "/api/symbols":
        return apiSymbols();
      case "/api/set-headers":
        return apiSetHeaders();
      case "/api/metrics-schema":
        return apiMetricsSchema();
      case "/api/kimi-doctor":
        return apiKimiDoctor();
      case "/api/perf-threaded":
        return apiPerfThreaded();
      case "/api/effect-benchmark":
        return apiEffectBenchmark();
      case "/api/global-store":
        return apiGlobalStore();
      case "/api/trace-verify":
        return apiTraceVerify();
      case "/api/deep-match":
        return apiDeepMatch();
      case "/api/bun-test":
        return apiBunTest();
      case "/api/build-compile":
        return apiBuildCompile();
      case "/api/strip-ansi":
        return apiStripAnsi();
      case "/api/shell":
        return apiShell();
      case "/api/cron":
        return apiCron();
      case "/api/transpiler":
        return apiTranspiler();
      case "/api/os":
        return apiOsInfo();
      case "/api/random-bytes":
        return apiRandomBytes();
      case "/api/inspect-defaults":
        return apiInspectDefaults();
      case "/api/dotenv":
        return apiDotenv();
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
      case "/api/inspect-table":
        return apiInspectTable();
      case "/api/inspect-simple":
        return apiInspectSimple();
      case "/api/inspect-config":
        return apiInspectConfig();
      case "/api/bunfig":
        return apiBunfig();
      case "/api/string-utils":
        return apiStringUtils();
      case "/api/uuid":
        return apiUuid();
      case "/api/markdown/html":
        return apiMarkdownHtml();
      case "/api/markdown/ansi":
        return apiMarkdownAnsi();
      case "/api/semver":
        return apiSemver();
      case "/api/deep-equals":
        return apiDeepEquals();
      case "/api/nanoseconds":
        return apiNanoseconds();
      case "/api/sleep":
        return apiSleep();
      case "/api/canvases": {
        const { apiCanvases } = await import("./handlers/canvas-cards.ts");
        return apiCanvases();
      }
      case "/api/cards": {
        const { apiCards } = await import("./handlers/canvas-cards.ts");
        return apiCards(req);
      }
      case "/health":
        return new Response("ok");
      default:
        return new Response("Not Found", { status: 404 });
    }
  },
});

Bun.stdout.write(`Dashboard running at http://localhost:${server.port}\n`);

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

