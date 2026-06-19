export { MODULE_REGISTRY, DEFAULT_THRESHOLDS, thresholdKeyFor } from "./module-registry.ts";
export {
  loadThresholds,
  writeTrainedThresholds,
  setThresholdsPath,
  getThresholdsPath,
  resetThresholdCache,
  overrideThresholds,
  loadBunfigThresholds,
  resolveThresholdSources,
} from "./thresholds.ts";
export type { ThresholdSources } from "./thresholds.ts";
export { runEffectBenchmarks, measure } from "./perf-monitor.ts";
export type { BenchmarkOptions } from "./perf-monitor.ts";
export {
  registryKeysForChanged,
  changedTouchesDashboardHarness,
  normalizeDashboardPath,
} from "./registry-scope.ts";
export { resolvePerfChangedFiles } from "./changed-context.ts";
export { perfGate } from "./perf-gate.ts";
export { generatePerfHTML } from "./html-reporter.ts";
export { trainThresholds } from "./train.ts";
export { getHttpBenchServers, stopHttpBenchServers, fetchHttp2Supported } from "./http-bench.ts";
export {
  getFileBenchServer,
  stopFileBenchServers,
  benchFileServeFull,
  benchFileServeRange,
} from "./file-bench.ts";
export {
  benchMinimalInstall,
  installBenchAvailable,
  installBenchEnabled,
  stopInstallBenchContext,
} from "./install-bench.ts";
export {
  runPerfWatchLoop,
  bindPerfWatchSignals,
  unbindPerfWatchSignals,
  PERF_WATCH_REL_PATHS,
  PERF_WATCH_DEBOUNCE_MS,
} from "./perf-watch.ts";
export type { Metric, PerfGateResult, ModuleRegistryEntry, TrainResult } from "./types.ts";
