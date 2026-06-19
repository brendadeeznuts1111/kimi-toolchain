export type GateStatus = "pass" | "warn" | "fail";

/** Control-plane level: 1=tactical, 2=strategic, 3=governance. */
export type GateLevel = 1 | 2 | 3;

/** Default prune age per level (ms). */
export const GATE_LEVEL_PRUNE_MS: Record<GateLevel, number> = {
  1: 7 * 24 * 60 * 60 * 1000, // 7 days
  2: 30 * 24 * 60 * 60 * 1000, // 30 days
  3: 180 * 24 * 60 * 60 * 1000, // 180 days
};

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
  run: (opts?: GateRunOptions) => Promise<GateResult>;
  format?: (result: GateResult) => string[];
}
