/**
 * Gate type definitions — L1 tactical, L2 strategic, L3 governance.
 *
 * @see runner.ts — topological execution
 * @see registry.ts — gate discovery and closure
 */

export type GateStatus = "pass" | "warn" | "fail";

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

export interface GateRunOptions {
  projectRoot?: string;
  saveArtifact?: boolean;
}

export interface Gate {
  name: string;
  description: string;
  /** Control-plane level. L1=tactical, L2=strategic, L3=governance. */
  level: GateLevel;
  /**
   * Gates that must run (and pass) before this one (execution order).
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
