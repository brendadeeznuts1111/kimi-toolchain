/**
 * Memory governor — classify system memory pressure and adapt runtime behavior.
 *
 * Combines `process.memoryUsage()` with OS-level memory stats to give a single
 * pressure classification. On macOS it tries to distinguish real memory pressure
 * from aggressive file-cache usage, since Apple Silicon unified memory often
 * reports very high "used" percentages while still being healthy.
 */

import { heapStats } from "bun:jsc";
import {
  formatMemoryBytes,
  inspectMemoryRuntime,
  processMemoryUsage,
  readableStreamToText,
} from "../bun-utils.ts";

/** Memory pressure buckets. */
export type MemoryPressure = "none" | "fair" | "serious" | "critical";

/** Selected JavaScriptCore heap stats from `bun:jsc` `heapStats()`. */
export interface JscHeapSnapshot {
  heapSize: number;
  heapCapacity: number;
  extraMemorySize: number;
  objectCount: number;
}

/** Combined process + system + JSC heap memory snapshot. */
export interface MemoryGovernorSnapshot {
  /** `process.memoryUsage()` values. */
  process: ReturnType<typeof processMemoryUsage>;
  /** JavaScriptCore heap stats (`bun:jsc` `heapStats()`). */
  jscHeap: JscHeapSnapshot;
  /** System memory from `os.totalmem()` / `os.freemem()`. */
  system: ReturnType<typeof inspectMemoryRuntime>;
  /** System used memory percentage (0–100, one decimal). */
  usedPercent: number;
}

/** Read a combined process + system + JSC heap memory snapshot. */
export function snapshot(): MemoryGovernorSnapshot {
  const processMem = processMemoryUsage();
  const system = inspectMemoryRuntime();
  const stats = heapStats();
  return {
    process: processMem,
    jscHeap: {
      heapSize: stats.heapSize,
      heapCapacity: stats.heapCapacity,
      extraMemorySize: stats.extraMemorySize,
      objectCount: stats.objectCount,
    },
    system,
    usedPercent: system.usedPercent,
  };
}

/**
 * Classify system memory pressure from a snapshot.
 *
 * Thresholds:
 * - none:    < 70% used
 * - fair:    70–85% used
 * - serious: 85–95% used
 * - critical: > 95% used
 */
export function classifyPressure(snap: MemoryGovernorSnapshot): MemoryPressure {
  const pct = snap.usedPercent;
  if (pct > 95) return "critical";
  if (pct >= 85) return "serious";
  if (pct >= 70) return "fair";
  return "none";
}

/**
 * On macOS, high "used" memory is often file cache, not real pressure.
 * Returns true only when pressure is critical AND the process heap is also
 * elevated relative to system used bytes.
 */
export function isActuallyCritical(snap: MemoryGovernorSnapshot): boolean {
  if (snap.usedPercent <= 95) return false;
  if (process.platform !== "darwin") return true;
  // If heap is tiny compared to "used" system memory, it's mostly file cache.
  const heapRatio = snap.process.heapUsed / snap.system.usedBytes;
  return heapRatio > 0.3;
}

const PRESSURE_TTL_MULTIPLIERS: Record<MemoryPressure, number> = {
  none: 1,
  fair: 0.5,
  serious: 0.1,
  critical: 0,
};

/**
 * Adjust a base cache TTL based on current memory pressure.
 *
 * @param baseTTL Desired TTL in milliseconds under no pressure.
 * @param snap Optional snapshot; reads live snapshot if omitted.
 * @returns Reduced TTL when memory pressure is elevated. Returns 0 in critical.
 */
export function adaptiveCacheTTL(baseTTL: number, snap?: MemoryGovernorSnapshot): number {
  const pressure = classifyPressure(snap ?? snapshot());
  return Math.max(0, Math.round(baseTTL * PRESSURE_TTL_MULTIPLIERS[pressure]));
}

/** Result of a preflight memory check. */
export interface PreflightResult {
  ok: boolean;
  pressure: MemoryPressure;
  actuallyCritical: boolean;
  message: string;
}

/**
 * Gate an expensive operation by memory pressure.
 *
 * Returns `{ ok: true }` unless pressure is critical and looks like a real
 * OOM risk. Logs a structured message on block.
 */
export function preflightCheck(label: string): PreflightResult {
  const snap = snapshot();
  const pressure = classifyPressure(snap);
  const actuallyCritical = isActuallyCritical(snap);
  const ok = pressure !== "critical" || !actuallyCritical;

  const result: PreflightResult = {
    ok,
    pressure,
    actuallyCritical,
    message: ok
      ? `${label}: memory pressure ${pressure} (${snap.usedPercent}%)`
      : `${label}: blocked — memory critical (${snap.usedPercent}%, heap ratio critical)`,
  };

  if (!ok) {
    console.error(result.message);
  }
  return result;
}

/**
 * Force garbage collection synchronously.
 *
 * Prefers `Bun.gc(true)` when available; falls back to `globalThis.gc()`.
 */
export function forceGarbageCollection(): void {
  const bun = Bun as typeof Bun & { gc?: (sync: boolean) => void };
  if (typeof bun.gc === "function") {
    bun.gc(true);
  } else if (typeof globalThis.gc === "function") {
    globalThis.gc();
  }
}

/**
 * Attempt to relieve memory pressure. Forces GC if available and logs the
 * resulting pressure classification.
 */
export function relievePressure(): MemoryGovernorSnapshot {
  const before = snapshot();
  forceGarbageCollection();
  const after = snapshot();
  const freed = before.process.rss - after.process.rss;
  console.log(
    `Relieved ${(freed / 1_000_000).toFixed(1)} MB · pressure ${classifyPressure(after)}`
  );
  return after;
}

/** Print a human-readable memory table to stdout. */
export function printMemoryTable(): void {
  const snap = snapshot();
  const rows = [
    { category: "RSS", value: formatMemoryBytes(snap.process.rss) },
    { category: "Process Heap Used", value: formatMemoryBytes(snap.process.heapUsed) },
    { category: "Process Heap Total", value: formatMemoryBytes(snap.process.heapTotal) },
    { category: "External", value: formatMemoryBytes(snap.process.external) },
    { category: "ArrayBuffers", value: formatMemoryBytes(snap.process.arrayBuffers) },
    { category: "JSC Heap Size", value: formatMemoryBytes(snap.jscHeap.heapSize) },
    { category: "JSC Heap Capacity", value: formatMemoryBytes(snap.jscHeap.heapCapacity) },
    { category: "JSC Extra Memory", value: formatMemoryBytes(snap.jscHeap.extraMemorySize) },
    { category: "JSC Object Count", value: snap.jscHeap.objectCount.toLocaleString() },
    { category: "System Used", value: formatMemoryBytes(snap.system.usedBytes) },
    { category: "System Total", value: formatMemoryBytes(snap.system.totalBytes) },
    { category: "Used %", value: `${snap.usedPercent}%` },
    { category: "Pressure", value: classifyPressure(snap) },
    { category: "Actually Critical", value: String(isActuallyCritical(snap)) },
  ];
  console.log(Bun.inspect.table(rows));
}

/** Options for {@link captureMimallocStats}. */
export interface MimallocStatsOptions {
  /** Extra arguments passed to the target script. */
  args?: string[];
  /** Working directory for the subprocess. */
  cwd?: string;
  /** Timeout in milliseconds. */
  timeout?: number;
}

/** Parsed mimalloc heap stats. */
export interface MimallocStats {
  reserved: { peak: number; total: number; freed: number; current: number };
  committed: { peak: number; total: number; freed: number; current: number };
  reset: { peak: number; total: number; freed: number; current: number };
  touched: { peak: number; total: number; freed: number; current: number };
  segments: { peak: number; total: number; freed: number; current: number };
  abandoned: { peak: number; total: number; freed: number; current: number };
  cached: { peak: number; total: number; freed: number; current: number };
  pages: { peak: number; total: number; freed: number; current: number };
  threads: { peak: number; total: number; freed: number; current: number };
  elapsedSeconds: number;
  process: {
    userSeconds: number;
    systemSeconds: number;
    faults: number;
    rssBytes: number;
    commitBytes: number;
  };
}

function parseMimallocSize(value: string): number {
  const normalized = value.trim().toLowerCase().replace(/,/g, "");
  if (normalized === "0" || normalized === "") return 0;
  const match = normalized.match(/^([0-9.]+)\s*(b|kib|mib|gib|kb|mb|gb|k|m|g)?$/);
  if (!match) return Number.NaN;
  const num = Number.parseFloat(match[1]);
  const unit = match[2] ?? "b";
  const multipliers: Record<string, number> = {
    b: 1,
    k: 1024,
    m: 1024 ** 2,
    g: 1024 ** 3,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
  };
  return num * (multipliers[unit] ?? 1);
}

function parseMimallocRow(
  raw: string,
  name: string
): { peak: number; total: number; freed: number; current: number } | undefined {
  const linePattern = new RegExp("^[ \\t]*-?" + name.replace(/[-/]/g, "[-/]") + ":.*$", "im");
  const lineMatch = raw.match(linePattern);
  if (!lineMatch) return undefined;
  const columns = lineMatch[0]
    .split(/\s{2,}/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (columns.length < 5) return undefined;
  return {
    peak: parseMimallocSize(columns[1]),
    total: parseMimallocSize(columns[2]),
    freed: parseMimallocSize(columns[3]),
    current: parseMimallocSize(columns[4]),
  };
}

/**
 * Parse the raw text block produced by `MIMALLOC_SHOW_STATS=1`.
 * Returns `undefined` when the block is missing or unrecognizable.
 */
export function parseMimallocStats(raw: string): MimallocStats | undefined {
  if (!raw.includes("heap stats:")) return undefined;
  const reserved = parseMimallocRow(raw, "reserved");
  if (!reserved) return undefined;
  const committed = parseMimallocRow(raw, "committed") ?? reserved;
  const elapsedMatch = raw.match(/elapsed:\s+([0-9.]+)\s*s/i);
  const processMatch = raw.match(
    /process:\s*user:\s*([0-9.]+)\s*s,\s*system:\s*([0-9.]+)\s*s,\s*faults:\s*(\d+),\s*rss:\s*([0-9.]+)\s*(\S*),\s*commit:\s*([0-9.]+)\s*(\S*)/i
  );
  return {
    reserved,
    committed,
    reset: parseMimallocRow(raw, "reset") ?? { peak: 0, total: 0, freed: 0, current: 0 },
    touched: parseMimallocRow(raw, "touched") ?? { peak: 0, total: 0, freed: 0, current: 0 },
    segments: parseMimallocRow(raw, "segments") ?? { peak: 0, total: 0, freed: 0, current: 0 },
    abandoned: parseMimallocRow(raw, "abandoned") ?? { peak: 0, total: 0, freed: 0, current: 0 },
    cached: parseMimallocRow(raw, "cached") ?? { peak: 0, total: 0, freed: 0, current: 0 },
    pages: parseMimallocRow(raw, "pages") ?? { peak: 0, total: 0, freed: 0, current: 0 },
    threads: parseMimallocRow(raw, "threads") ?? { peak: 0, total: 0, freed: 0, current: 0 },
    elapsedSeconds: elapsedMatch ? Number.parseFloat(elapsedMatch[1]) : Number.NaN,
    process: processMatch
      ? {
          userSeconds: Number.parseFloat(processMatch[1]),
          systemSeconds: Number.parseFloat(processMatch[2]),
          faults: Number.parseInt(processMatch[3], 10),
          rssBytes: parseMimallocSize(`${processMatch[4]} ${processMatch[5]}`),
          commitBytes: parseMimallocSize(`${processMatch[6]} ${processMatch[7]}`),
        }
      : {
          userSeconds: Number.NaN,
          systemSeconds: Number.NaN,
          faults: Number.NaN,
          rssBytes: Number.NaN,
          commitBytes: Number.NaN,
        },
  };
}

/**
 * Run a Bun script with `MIMALLOC_SHOW_STATS=1` and return the captured
 * streams. Stats are printed on exit to stderr (or stdout on some builds),
 * so both streams are returned for inspection.
 *
 * @example
 * const { combined, exitCode } = await captureMimallocStats("scripts/runtime-info.ts");
 * console.log(combined);
 */
export async function captureMimallocStats(
  scriptPath: string,
  options: MimallocStatsOptions = {}
): Promise<{ stdout: string; stderr: string; combined: string; exitCode: number | null }> {
  const proc = Bun.spawn(["bun", scriptPath, ...(options.args ?? [])], {
    env: { ...Bun.env, MIMALLOC_SHOW_STATS: "1" },
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timeoutId: Timer | undefined;
  if (options.timeout) {
    timeoutId = setTimeout(() => proc.kill("SIGTERM"), options.timeout);
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
    proc.exited,
  ]);

  if (timeoutId) clearTimeout(timeoutId);

  return { stdout, stderr, combined: `${stdout}${stderr}`, exitCode };
}
