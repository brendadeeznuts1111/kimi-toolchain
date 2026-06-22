/**
 * Memory governor — classify system memory pressure and adapt runtime behavior.
 *
 * Combines `process.memoryUsage()` with OS-level memory stats to give a single
 * pressure classification. On macOS it tries to distinguish real memory pressure
 * from aggressive file-cache usage, since Apple Silicon unified memory often
 * reports very high "used" percentages while still being healthy.
 */

import { heapStats } from "bun:jsc";
import { formatMemoryBytes, inspectMemoryRuntime, processMemoryUsage } from "../bun-utils.ts";

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
