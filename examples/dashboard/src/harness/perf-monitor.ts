import { MODULE_REGISTRY, thresholdKeyFor } from "./module-registry.ts";
import { loadThresholds } from "./thresholds.ts";
import type { Metric } from "./types.ts";

async function measure(
  registryKey: string,
  symbol: symbol,
  operation: string,
  fn: () => Promise<void> | void,
  thresholds: Record<string, number>
): Promise<Metric> {
  const entry = MODULE_REGISTRY[registryKey];
  const thresholdKey = thresholdKeyFor(registryKey);
  const fallbackMs = entry?.thresholdMs ?? 100;
  const thresholdMs = thresholds[thresholdKey] ?? fallbackMs;

  if (entry?.skipIf && (await entry.skipIf())) {
    return {
      symbol: symbol.toString(),
      operation,
      actualMs: 0,
      thresholdMs,
      pass: true,
      skipped: true,
      skipReason: entry.skipReason ?? "skipped",
      registryKey,
    };
  }

  const start = Bun.nanoseconds();
  try {
    await fn();
  } catch {
    const actualMs = (Bun.nanoseconds() - start) / 1_000_000;
    return {
      symbol: symbol.toString(),
      operation,
      actualMs: Math.round(actualMs * 1000) / 1000,
      thresholdMs,
      pass: false,
      registryKey,
    };
  }

  const actualMs = (Bun.nanoseconds() - start) / 1_000_000;
  return {
    symbol: symbol.toString(),
    operation,
    actualMs: Math.round(actualMs * 1000) / 1000,
    thresholdMs,
    pass: actualMs <= thresholdMs,
    registryKey,
  };
}

export interface BenchmarkOptions {
  /** `null` = all registry keys; `[]` = run nothing. */
  registryKeys?: string[] | null;
}

/** Run MODULE_REGISTRY workloads and return Metric rows. */
export async function runEffectBenchmarks(opts?: BenchmarkOptions): Promise<Metric[]> {
  const thresholds = await loadThresholds();
  const metrics: Metric[] = [];
  const allEntries = Object.entries(MODULE_REGISTRY);
  const keys = opts?.registryKeys;
  const entries =
    keys === undefined || keys === null
      ? allEntries
      : allEntries.filter(([registryKey]) => keys.includes(registryKey));

  for (const [registryKey, entry] of entries) {
    const sym = Symbol.for(entry.symbol);
    const operation = registryKey.includes(".")
      ? registryKey.split(".").slice(1).join(".")
      : registryKey;
    metrics.push(await measure(registryKey, sym, operation, entry.workload, thresholds));
  }

  return metrics;
}

export { measure };
