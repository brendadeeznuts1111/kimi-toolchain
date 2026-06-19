/**
 * Doctor gate contracts — distinct from CI shell gates in `src/lib/gate-runner.ts`.
 *
 * `GateContext` is built by `runGatesWithDependencies` in `runner.ts`.
 * Retention defaults: `GATE_LEVEL_PRUNE_MS` by control-plane level (L1/L2/L3).
 */
export type GateStatus = "pass" | "warn" | "fail";

/** Default newest-N cap when `getArtifacts()` omits `limit` (backpressure). */
export const DEFAULT_GATE_ARTIFACT_LIMIT = 10;

/** Control-plane level: 1=tactical, 2=strategic, 3=governance. */
export type GateLevel = 1 | 2 | 3;

/** Default prune age per level (ms). */
export const GATE_LEVEL_PRUNE_MS: Record<GateLevel, number> = {
  1: 7 * 24 * 60 * 60 * 1000, // 7 days
  2: 30 * 24 * 60 * 60 * 1000, // 30 days
  3: 180 * 24 * 60 * 60 * 1000, // 180 days
};

/** Per-gate artifact retention; falls back to {@link GATE_LEVEL_PRUNE_MS} by level. */
export interface GateRetentionPolicy {
  maxAgeMs?: number;
  maxCount?: number;
}

/** Artifact from the current run or {@link ArtifactStore} fallback. */
export interface GateArtifact {
  gate: string;
  path?: string;
  relativePath?: string;
  payload: unknown;
}

export interface GateArtifactListOptions {
  /** ISO-8601 lower bound when reading from disk. */
  since?: string;
  /** Newest N artifacts when reading from disk. */
  limit?: number;
}

/** Gate run context — populated by the dependency runner. */
export interface GateContext {
  /** Single newest in-run or saved artifact for a dependency gate. */
  getArtifact: (gateName: string) => Promise<GateArtifact | null>;
  /** Multiple saved artifacts (in-run result first, then disk). */
  getArtifacts: (gateName: string, opts?: GateArtifactListOptions) => Promise<unknown[]>;
  /** Read payload from a relative or absolute artifact path. */
  readArtifact: (path: string) => Promise<unknown>;
}

export interface GateRunOptions {
  projectRoot?: string;
  saveArtifact?: boolean;
  /** @deprecated Use context fields directly when present. */
  getArtifact?: (gateName: string) => Promise<GateArtifact | null>;
  getArtifacts?: (gateName: string, opts?: GateArtifactListOptions) => Promise<unknown[]>;
  readArtifact?: (path: string) => Promise<unknown>;
}

export interface GateResult {
  status: GateStatus;
  reason?: string;
  artifactPath?: string;
  /** Upstream artifacts consumed by this gate run. */
  lineage?: {
    dependencies: string[];
    upstreamArtifacts: string[];
  };
}

export interface Gate {
  name: string;
  description: string;
  /** Control-plane level. L1=tactical, L2=strategic, L3=governance. */
  level: GateLevel;
  /**
   * Gates that must run (and pass) before this one (execution order).
   * Orchestration may run a higher-level policy gate before a lower-level
   * benchmark (e.g. `perf-gate` L2 → `bunfig-policy` L3). Artifact
   * `dependsOn` metadata follows separate upward-only lineage rules.
   */
  dependsOn?: string[];
  /**
   * When true, may run concurrently with other `parallel` gates at the same
   * dependency depth (topological level). Sequential by default.
   */
  parallel?: boolean;
  /** Applied after `saveArtifact` runs — age + count caps for this gate's store. */
  retentionPolicy?: GateRetentionPolicy;
  run: (opts?: GateRunOptions) => Promise<GateResult>;
  format?: (result: GateResult) => string[];
}
