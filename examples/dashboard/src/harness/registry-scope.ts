import { MODULE_REGISTRY } from "./module-registry.ts";

/** Harness infra edits require the full registry (threshold merge, gate formatting, etc.). */
export const PERF_INFRA_PATHS = [
  "src/harness/perf-monitor.ts",
  "src/harness/perf-gate.ts",
  "src/harness/thresholds.ts",
  "src/harness/train.ts",
  "src/harness/types.ts",
  "src/harness/registry-scope.ts",
  "src/harness/index.ts",
  "src/bin/perf-doctor.ts",
] as const;

/** Registry key → source paths (relative to examples/dashboard). */
export const REGISTRY_FILE_DEPS: Record<string, readonly string[]> = {
  "crypto.sha256": ["src/harness/module-registry.ts", "src/harness/perf-monitor.ts"],
  "util.inspect": ["src/harness/module-registry.ts", "src/harness/perf-monitor.ts"],
  "util.deepEquals": ["src/harness/module-registry.ts", "src/harness/perf-monitor.ts"],
  "image.metadata": ["src/harness/module-registry.ts", "src/effect/image/processor.ts"],
  "http.fetch-h1": ["src/harness/http-bench.ts", "src/harness/module-registry.ts"],
  "http.fetch-h2": ["src/harness/http-bench.ts", "src/harness/module-registry.ts"],
  "http.fetch-h3": ["src/harness/http-bench.ts", "src/harness/module-registry.ts"],
  "file.serve-full": ["src/harness/file-bench.ts", "src/harness/module-registry.ts"],
  "file.serve-range": ["src/harness/file-bench.ts", "src/harness/module-registry.ts"],
  "package.install-minimal": [
    "src/harness/install-bench.ts",
    "src/harness/module-registry.ts",
    "src/harness/__fixtures__/install-minimal/package.json",
    "src/harness/__fixtures__/install-minimal/bun.lock",
  ],
  "isolation.realmEvaluate": [
    "src/lib/isolation/realm-bench.ts",
    "src/lib/isolation/index.ts",
    "src/harness/module-registry.ts",
  ],
  "isolation.createChannel": [
    "src/lib/isolation/worker-bench.ts",
    "src/lib/isolation/messageport-bench.ts",
    "src/lib/isolation/index.ts",
    "src/harness/module-registry.ts",
  ],
  "isolation.roundtrip": [
    "src/lib/isolation/worker-bench.ts",
    "src/lib/isolation/messageport-bench.ts",
    "src/lib/isolation/index.ts",
    "src/harness/module-registry.ts",
  ],
  "isolation.realm.run": [
    "src/lib/isolation/realm.ts",
    "src/lib/isolation/factory.ts",
    "src/lib/isolation/index.ts",
    "src/harness/module-registry.ts",
  ],
  "isolation.worker.run": [
    "src/lib/isolation/worker.ts",
    "src/lib/isolation/factory.ts",
    "src/lib/isolation/index.ts",
    "src/harness/module-registry.ts",
  ],
};

const DASHBOARD_PREFIX = "examples/dashboard/";

/** Strip monorepo prefix so git paths match dashboard-relative deps. */
export function normalizeDashboardPath(path: string): string {
  return path.startsWith(DASHBOARD_PREFIX) ? path.slice(DASHBOARD_PREFIX.length) : path;
}

export function pathTouchesDep(changedPath: string, dep: string): boolean {
  const normalized = normalizeDashboardPath(changedPath);
  return normalized === dep || normalized.endsWith(`/${dep}`);
}

export function changedTouchesPerfInfra(changedFiles: readonly string[]): boolean {
  return changedFiles.some((file) => PERF_INFRA_PATHS.some((dep) => pathTouchesDep(file, dep)));
}

export function changedTouchesDashboardHarness(changedFiles: readonly string[]): boolean {
  return changedFiles.some(
    (file) => file.startsWith(DASHBOARD_PREFIX) || file.startsWith("examples/dashboard/")
  );
}

/**
 * Resolve registry keys to benchmark for a changed-file set.
 * `null` = run full MODULE_REGISTRY; `[]` = no perf-relevant changes.
 */
export function registryKeysForChanged(changedFiles: readonly string[]): string[] | null {
  if (changedFiles.length === 0) return [];

  if (changedTouchesPerfInfra(changedFiles)) return null;

  const keys = new Set<string>();
  for (const [registryKey, deps] of Object.entries(REGISTRY_FILE_DEPS)) {
    if (deps.some((dep) => changedFiles.some((file) => pathTouchesDep(file, dep)))) {
      keys.add(registryKey);
    }
  }

  if (
    changedFiles.some(
      (file) =>
        pathTouchesDep(file, "thresholds.json") ||
        normalizeDashboardPath(file).endsWith("/thresholds.json")
    )
  ) {
    return null;
  }

  return [...keys].filter((key) => key in MODULE_REGISTRY);
}
