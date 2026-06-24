import { join } from "path";
import {
  CANONICAL_DASHBOARD_PORT,
  resolveDashboardProjectRoot,
  resolveDashboardSettings,
} from "../../../../src/lib/dashboard-settings.ts";
import {
  entryScriptPath,
  isDirectRun,
  readableStreamToText,
} from "../../../../src/lib/bun-utils.ts";
import { resolveBin, USER_TOOLCHAIN_BIN } from "../lib/toolchain-paths.ts";
import { jsonResponse, runDoctorJson } from "./shared.ts";

export { jsonResponse } from "./shared.ts";

// ── API handlers ────────────────────────────────────────────────────

export async function apiBundle(): Promise<Response> {
  return runDoctorJson(["--bundle"]);
}

export async function apiCompile(): Promise<Response> {
  return runDoctorJson(["--compile-check"]);
}

export async function apiGates(): Promise<Response> {
  return runDoctorJson(["--effect-gates"]);
}

export async function apiSecrets(): Promise<Response> {
  const { buildSecretsApiResponse } = await import("../../../../src/lib/secrets-api.ts");
  const projectRoot = resolveDashboardProjectRoot(import.meta.dir);
  return jsonResponse(await buildSecretsApiResponse(projectRoot));
}

export async function apiEnv(request?: Request): Promise<Response> {
  const projectRoot = resolveDashboardProjectRoot(import.meta.dir);
  const requestUrl = request ? new URL(request.url) : undefined;
  const settings = await resolveDashboardSettings(projectRoot, { requestUrl });
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
    const parsed = Bun.TOML.parse(bunfigText) as Record<string, unknown>;
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
      PORT: Bun.env.PORT || String(settings.port),
      PROBE_SERVER_PORT: Bun.env.PROBE_SERVER_PORT || String(settings.probePort),
    },
    dashboardUrl: settings.dashboardUrl,
    listenPort: settings.port,
    probePort: settings.probePort,
    portSource: settings.sources.port,
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
  await readableStreamToText(depth2.stdout);
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
        const parsed = Bun.TOML.parse(await f.text()) as Record<string, unknown>;
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
    compileTime.BUILD_VERSION = (await readableStreamToText(gitDesc.stdout)).trim() || "unknown";
    await gitDesc.exited;

    const gitRev = Bun.spawn(["git", "rev-parse", "HEAD"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    compileTime.GIT_COMMIT =
      (await readableStreamToText(gitRev.stdout)).trim().slice(0, 8) || "unknown";
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
    definesSource: hasDefines
      ? `bunfig.toml [define]`
      : "none (add [define] entries to bunfig.toml)",
    consoleWriteRewritten: "console.write" in bunfigDefines,
    runtime,
    note: hasDefines
      ? "--define rewrites identifiers at AST level. Read from bunfig.toml [define]."
      : 'No [define] section in bunfig.toml. Add entries like: [define] "console.write" = "console.log"',
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
    main: isBun ? entryScriptPath() : null,
    isEntrypoint: isBun ? isDirectRun(import.meta.path) : false,
    whichBun: isBun ? Bun.which("bun") : null,
    note: "Bun.main = entrypoint path. Bun.which('bun') = resolved binary. --config overrides bunfig.toml.",
  });
}

export async function apiToolchainHealth(): Promise<Response> {
  // Use shared resolver from toolchain-paths module
  const { resolveBin } = await import("../lib/toolchain-paths.ts");
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
    {
      option: "colors",
      default: "TTY&!CI",
      value: true,
      flag: "bun --no-color",
      source: "terminal",
    },
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
      this.port = CANONICAL_DASHBOARD_PORT;
      this.host = "localhost";
    }
  }

  const sample = {
    "path.root": "kimi-toolchain-dashboard",
    "path.version": "0.1.0",
    "path.config.port": CANONICAL_DASHBOARD_PORT,
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
  const oldTimestamp = Bun.randomUUIDv7("hex", 1700000000000);

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
  const colors = debug ? "inherit" : isTTY && !isCI;
  const compact = !isTTY || isProd;
  const showHidden = debug;

  return jsonResponse({
    preset,
    environment: isProd ? "production" : isTTY ? "local" : "non-tty",
    config: {
      depth,
      colors,
      compact,
      sorted: false,
      maxArrayLength: isProd ? 30 : 100,
      showHidden,
    },
    detected: {
      isTTY,
      CI: Bun.env.CI || "unset",
      NODE_ENV: Bun.env.NODE_ENV || "unset",
      DEBUG_INSPECT: Bun.env.DEBUG_INSPECT || "unset",
    },
    presets: [
      {
        environment: "Local terminal (dev)",
        debug: "—",
        colors: "true (TTY)",
        depth: 5,
        compact: false,
        showHidden: false,
        useCase: "Best developer experience",
      },
      {
        environment: "CI / GitHub Actions / pipe",
        debug: "—",
        colors: "false (pipe)",
        depth: 4,
        compact: true,
        showHidden: false,
        useCase: "Clean, safe logs",
      },
      {
        environment: "Production",
        debug: "—",
        colors: "false",
        depth: 2,
        compact: true,
        showHidden: false,
        useCase: "Minimal output",
      },
      {
        environment: "Any (local/CI/prod)",
        debug: "1 / true",
        colors: "true (if TTY)",
        depth: "Infinity",
        compact: false,
        showHidden: true,
        useCase: "Maximum visibility for debugging",
      },
    ],
    note: debug
      ? "DEBUG_INSPECT=true — depth=Infinity, showHidden=true"
      : `Auto preset (${preset}). console.depth=4 from bunfig.toml`,
  });
}

export async function apiDeps(): Promise<Response> {
  const ls = Bun.spawn(["bun", "pm", "ls", "--all"], { stdout: "pipe", stderr: "pipe" });
  const bin = Bun.spawn(["bun", "pm", "bin"], { stdout: "pipe", stderr: "pipe" });
  const bunx = Bun.spawn(["bunx", "--help"], { stdout: "pipe", stderr: "pipe" });
  const [lsOut, binOut, _bunxOut] = await Promise.all([
    readableStreamToText(ls.stdout),
    readableStreamToText(bin.stdout),
    readableStreamToText(bunx.stdout),
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
    const projectRoot = resolveDashboardProjectRoot(import.meta.dir);
    const path = join(projectRoot, "bunfig.toml");
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return jsonResponse({ error: "No bunfig.toml found" });
    }
    const raw = await file.text();
    const parsed = Bun.TOML.parse(raw) as { install?: Record<string, unknown> };
    const { readMachineInstallSsot, buildSsotSummary } =
      await import("../../../../src/lib/machine-bun-ssot.ts");
    const { readUserBunfigInstall } = await import("../../../../src/lib/bunfig-redundancy.ts");
    const machine = await readUserBunfigInstall();
    const ssotEntries = await readMachineInstallSsot(
      (parsed.install as import("../../../../src/lib/bun-install-config.ts").BunfigInstallSection) ??
        null
    );
    const ssot = buildSsotSummary(ssotEntries);
    return jsonResponse({
      path: "./bunfig.toml",
      sections: parsed,
      machineBunfigPath: machine.bunfigPath,
      effectiveInstall: {
        linker: ssot.linker.effective,
        globalStore: ssot.globalStore.effective,
        cacheDir: ssot.cacheDir.effective,
      },
      ssot,
      inherited: ssotEntries
        .filter((entry) => entry.status === "inherited")
        .map((entry) => entry.note),
      mergeRule:
        "machine (~/.bunfig.toml) → project (./bunfig.toml) shallow merge → CLI flags override",
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
