/**
 * Shared artifact type definitions and constants.
 *
 * Kept in a dedicated module so artifact-index.ts and artifact-store.ts can
 * share types without creating a circular import.
 */

export const ARTIFACT_SCHEMA_VERSION = 1;

/** Declarative input lineage — query-based or pinned paths (Level 1). */
export interface ArtifactDependencyQuery {
  gate: string;
  /** ISO-8601 lower bound when resolving by query. */
  since?: string;
  /** Newest N artifacts when resolving by query. */
  limit?: number;
  /** Pin exact artifact relative paths instead of querying. */
  paths?: string[];
}

export interface ArtifactRunLineage {
  dependencies: string[];
  upstreamArtifacts: string[];
}

export interface ArtifactSessionContext {
  /** Kimi Code or agent session (`KIMI_CODE_SESSION` / `KIMI_AGENT_SESSION`). */
  sessionId?: string;
  /** Herdr workspace/session (`HERDR_WORKSPACE_ID` / `HERDR_SESSION_ID` / `HERDR_SESSION`). */
  workspaceId?: string;
  /** Herdr pane id (`HERDR_PANE_ID`). */
  paneId?: string;
  /** Agent id (`KIMI_AGENT_ID`; falls back to `paneId` for legacy envelopes). */
  agentId?: string;
  /** Unique id per gate-runner / doctor invocation (`run_*`). */
  runId?: string;
  /** Parent run when nested via `KIMI_PARENT_RUN_ID`. */
  parentRunId?: string;
}

export type ArtifactRunStatus = "pass" | "warn" | "fail";

export interface ArtifactSaveMeta extends ArtifactSessionContext {
  /** Control-plane level copied from gate definition (for prune/docs). */
  level?: 1 | 2 | 3;
  /** Artifact lineage declared at save time (not inferred). */
  dependsOn?: ArtifactDependencyQuery[];
  /** Pre-rendered Mermaid lineage graph (set automatically when `dependsOn` is saved). */
  lineageMermaid?: string;
  /** Runtime provenance injected by the gate runner after dependsOn gates complete. */
  lineage?: ArtifactRunLineage;
  [key: string]: unknown;
}

export interface ArtifactMetadata extends ArtifactSaveMeta {
  hostname: string;
  pid: number;
  bunVersion: string;
  /** Byte length of serialized `payload` (not the full envelope). */
  resultSize: number;
}

export interface ArtifactEnvelope {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  gate: string;
  savedAt: string;
  size: number;
  metadata?: ArtifactMetadata;
  payload: unknown;
}
