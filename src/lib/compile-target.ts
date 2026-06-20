/**
 * compile-target.ts — Bun build --compile facade with format + bytecode support.
 *
 * Provides version-aware compilation for ESM + bytecode (Bun >= 1.3.9),
 * falling back to CJS + bytecode on older Bun versions. Also exposes
 * a capability probe for kimi-doctor.
 *
 * B3.6 — ESM --bytecode in --compile.
 * @see https://bun.com/docs/bundler/executables
 */

import { join } from "path";
import { bunRevision, bunVersion, readableStreamToText } from "./bun-utils.ts";

// ── Types ──────────────────────────────────────────────────────────

export type CompileFormat = "esm" | "cjs";

export interface CompileOptions {
  /** Entry point (TS/JS file path). */
  entryPoint: string;
  /** Output executable path. */
  outfile: string;
  /** Module format (default: "esm" when Bun >= 1.3.9, else "cjs"). */
  format?: CompileFormat;
  /** Enable bytecode cache (default: true). */
  bytecode?: boolean;
  /** Target runtime (default: "bun"). */
  target?: "bun" | "node";
  /** Working directory (default: process.cwd()). */
  cwd?: string;
}

export interface CompileResult {
  ok: boolean;
  outfile: string;
  format: CompileFormat;
  bytecode: boolean;
  /** Size of the output executable in bytes. */
  sizeBytes: number;
  /** Bun version used for compilation. */
  bunVersion: string;
  /** Wall-clock duration in ms. */
  durationMs: number;
  error?: string;
}

export interface CompileCapabilities {
  /** Bun version string (e.g. "1.4.0"). */
  bunVersion: string;
  /** Full revision string. */
  bunRevision: string;
  /** True when ESM + bytecode compilation is supported (Bun >= 1.3.9). */
  esmBytecode: boolean;
  /** True when --compile is available at all. */
  compile: boolean;
  /** True when --bytecode is available. */
  bytecode: boolean;
  /** Recommended format for current Bun version. */
  recommendedFormat: CompileFormat;
  /** True when --cpu-prof-interval is supported (Bun >= 1.3.7). */
  cpuProfInterval: boolean;
  /** True when --cpu-prof-md is supported (Bun >= 1.3.7). */
  cpuProfMd: boolean;
  /** True when --heap-prof is supported. */
  heapProf: boolean;
  /** True when --heap-prof-md is supported (Bun >= 1.3.7). */
  heapProfMd: boolean;
}

// ── Version helpers ────────────────────────────────────────────────

let _bunVersion: string | null = null;
let _bunRevision: string | null = null;

function resolveBunVersion(): { version: string; revision: string } {
  if (_bunVersion && _bunRevision) return { version: _bunVersion, revision: _bunRevision };

  _bunVersion = bunVersion() || "unknown";
  _bunRevision = bunRevision() || "unknown";
  return { version: _bunVersion, revision: _bunRevision };
}

/** Parse "1.4.0" → { major: 1, minor: 4, patch: 0 }. Exported for tests. */
export function parseVersion(
  version: string
): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

function versionGte(
  version: string,
  minMajor: number,
  minMinor: number,
  minPatch: number
): boolean {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  if (parsed.major !== minMajor) return parsed.major > minMajor;
  if (parsed.minor !== minMinor) return parsed.minor > minMinor;
  return parsed.patch >= minPatch;
}

// ── Capability probe ───────────────────────────────────────────────

/** Minimum Bun version for ESM + --bytecode support. */
const ESM_BYTECODE_MIN = { major: 1, minor: 3, patch: 9 };

let _capabilities: CompileCapabilities | null = null;

/** Probe Bun's compile capabilities. Cached after first call. */
export async function probeCompileCapabilities(): Promise<CompileCapabilities> {
  if (_capabilities) return _capabilities;

  const { version, revision } = resolveBunVersion();
  const hasCompile = true; // --compile exists since Bun 1.0
  const hasBytecode = true; // --bytecode exists since Bun 1.1
  const esmBytecode = versionGte(
    version,
    ESM_BYTECODE_MIN.major,
    ESM_BYTECODE_MIN.minor,
    ESM_BYTECODE_MIN.patch
  );
  const cpuProfInterval = versionGte(version, 1, 3, 7);
  const cpuProfMd = versionGte(version, 1, 3, 7);
  const heapProf = versionGte(version, 1, 2, 0);
  const heapProfMd = versionGte(version, 1, 3, 7);

  _capabilities = {
    bunVersion: version,
    bunRevision: revision,
    esmBytecode,
    compile: hasCompile,
    bytecode: hasBytecode,
    recommendedFormat: esmBytecode ? "esm" : "cjs",
    cpuProfInterval,
    cpuProfMd,
    heapProf,
    heapProfMd,
  };
  return _capabilities;
}

// ── Compile ────────────────────────────────────────────────────────

/**
 * Compile a TypeScript/JavaScript entry point to a standalone executable.
 *
 * Auto-selects format based on Bun version:
 * - Bun >= 1.3.9: --format=esm --bytecode (native ESM with bytecode)
 * - Bun < 1.3.9:  --format=cjs --bytecode (CJS fallback)
 */
export async function compileBinary(options: CompileOptions): Promise<CompileResult> {
  const start = Date.now();
  const caps = await probeCompileCapabilities();
  const format = options.format ?? caps.recommendedFormat;
  const bytecode = options.bytecode !== false;
  const cwd = options.cwd ?? process.cwd();

  const args = [
    "build",
    "--compile",
    options.entryPoint,
    "--outfile",
    options.outfile,
    "--target",
    options.target ?? "bun",
    "--format",
    format,
  ];

  if (bytecode) args.push("--bytecode");

  const proc = Bun.spawn(["bun", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
  ]);
  await proc.exited;

  const durationMs = Date.now() - start;

  if (proc.exitCode !== 0) {
    return {
      ok: false,
      outfile: options.outfile,
      format,
      bytecode,
      sizeBytes: 0,
      bunVersion: caps.bunVersion,
      durationMs,
      error: stderr || stdout || `bun build exited with code ${proc.exitCode}`,
    };
  }

  let sizeBytes = 0;
  try {
    const stat = await Bun.file(options.outfile).stat();
    sizeBytes = stat.size;
  } catch {
    // file may not exist if compilation failed to produce output
  }

  return {
    ok: true,
    outfile: options.outfile,
    format,
    bytecode,
    sizeBytes,
    bunVersion: caps.bunVersion,
    durationMs,
  };
}

// ── Doctor check ───────────────────────────────────────────────────

export interface CompileGateCheck {
  status: "ok" | "warn" | "error";
  capabilities: CompileCapabilities;
  messages: string[];
}

/** Run a quick compile gate: probe capabilities + do a smoke-test compile. */
export async function runCompileGate(projectRoot?: string): Promise<CompileGateCheck> {
  const caps = await probeCompileCapabilities();
  const messages: string[] = [];

  if (!caps.esmBytecode) {
    messages.push(
      `ESM + bytecode not supported (Bun ${caps.bunVersion} < 1.3.9). Falling back to CJS + bytecode.`
    );
  } else {
    messages.push(`ESM + bytecode supported (Bun ${caps.bunVersion}).`);
  }

  // Smoke test: compile a trivial script
  const cwd = projectRoot ?? process.cwd();
  const smokeFile = join(cwd, ".tmp-compile-smoke.ts");
  const smokeOut = join(cwd, ".tmp-compile-smoke-out");

  try {
    await Bun.write(smokeFile, "console.log('smoke');\n");
    const result = await compileBinary({
      entryPoint: smokeFile,
      outfile: smokeOut,
      cwd,
    });

    if (!result.ok) {
      messages.push(`Smoke test failed: ${result.error}`);
      return { status: "error", capabilities: caps, messages };
    }

    messages.push(
      `Smoke test passed: ${(result.sizeBytes / (1024 * 1024)).toFixed(1)} MB binary in ${result.durationMs}ms`
    );
    return { status: "ok", capabilities: caps, messages };
  } catch (err) {
    messages.push(`Smoke test threw: ${(err as Error).message}`);
    return { status: "error", capabilities: caps, messages };
  } finally {
    // Cleanup
    try {
      await Bun.file(smokeFile).delete();
    } catch {
      /* ignore */
    }
    try {
      await Bun.file(smokeOut).delete();
    } catch {
      /* ignore */
    }
  }
}
