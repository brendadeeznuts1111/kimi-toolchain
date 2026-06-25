/**
 * Versioned gate artifacts under `.kimi/artifacts/<gate>/`.
 *
 * Supports declarative `dependsOn` queries at save time and runtime `lineage`
 * from the gate runner. Prune retention is level-aware via `GATE_LEVEL_PRUNE_MS`.
 *
 * @see src/gates/runner.ts — `persistGateArtifact`, `buildGateContext`
 * @see examples/artifact-trading-loop.md — L2 feedback loop demo
 */
import { join } from "path";
import { bunVersion } from "./bun-utils.ts";
import { listDir, makeDir, pathExists, removePath } from "./bun-io.ts";
import { GATE_LEVEL_PRUNE_MS } from "../gates/types.ts";
import { generateArtifactLineageMermaid, generateRunLineageMermaid } from "./graph-to-mermaid.ts";
import { safeParse } from "./utils.ts";
import {
  ARTIFACT_SCHEMA_VERSION,
  ArtifactIndex,
  computeArtifactContentHash,
  type ArtifactDependencyQuery,
  type ArtifactEnvelope,
  type ArtifactIndexDistinct,
  type ArtifactIndexQuery,
  type ArtifactIndexRow,
  type ArtifactIndexStats,
  type ArtifactMetadata,
  type ArtifactMetadataCollectionEntry,
  type ArtifactRunLineage,
  type ArtifactRunStatus,
  type ArtifactSaveMeta,
  type ArtifactSessionContext,
} from "./artifact-index.ts";

export type {
  ArtifactIndexDistinct,
  ArtifactIndexQuery,
  ArtifactIndexRow,
  ArtifactIndexStats,
  ArtifactMetadataCollectionEntry,
};
export { computeArtifactContentHash };

export {
  ARTIFACT_SCHEMA_VERSION,
  type ArtifactDependencyQuery,
  type ArtifactEnvelope,
  type ArtifactMetadata,
  type ArtifactRunLineage,
  type ArtifactRunStatus,
  type ArtifactSaveMeta,
  type ArtifactSessionContext,
};

export const DEFAULT_ARTIFACT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum length for any identity field stored on an artifact. */
export const ARTIFACT_IDENTITY_MAX_LEN = 128;

/** Characters allowed in normalized identity fields: alphanumerics, hyphen, underscore, dot, colon. */
export const ARTIFACT_IDENTITY_SAFE_RE = /^[a-zA-Z0-9_.:-]+$/;

export interface ArtifactRecord {
  path: string;
  relativePath: string;
  payload: unknown;
}

export interface ResolvedArtifactDependency {
  query: ArtifactDependencyQuery;
  paths: string[];
}

/** Logical grouping of artifacts produced in one gate-runner invocation. */
export interface ArtifactRunManifest extends ArtifactSessionContext {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  runId: string;
  startedAt: string;
  completedAt: string;
  gates: string[];
  artifacts: Record<string, string>;
  status: ArtifactRunStatus;
  triggeredBy?: string;
  graphArtifactPath?: string;
}

export interface ArtifactListEntry extends ArtifactSessionContext {
  path: string;
  timestamp: string | null;
  size?: number;
  resultSize?: number;
  runId?: string;
  parentRunId?: string;
}

export interface ArtifactListEntriesResult extends ArtifactListResult {
  entries: ArtifactListEntry[];
}

export interface ArtifactListOptions extends ArtifactSessionContext {
  /** ISO-8601 lower bound (inclusive). */
  since?: string;
  /** ISO-8601 upper bound (inclusive). */
  until?: string;
  /** Max entries to return (newest when list is chronological). */
  limit?: number;
  /** Multi-value session filter (OR). */
  sessionIds?: string[];
  /** Multi-value workspace filter (OR). */
  workspaceIds?: string[];
  /** Multi-value pane filter (OR). */
  paneIds?: string[];
  /** Multi-value agent filter (OR). */
  agentIds?: string[];
  /** Multi-value run filter (OR). */
  runIds?: string[];
  /** Multi-value parent-run filter (OR). */
  parentRunIds?: string[];
  /** Multi-value status filter (OR). */
  statuses?: string[];
}

export interface ArtifactListResult {
  files: string[];
  total: number;
  since?: string;
  limit?: number;
}

export interface PruneOptions {
  /** If true, only report what would be deleted. */
  dryRun?: boolean;
  /** Maximum age in ms (default 7 days). Overridden by `level`. */
  maxAgeMs?: number;
  /** Gate level for default prune age: 1=7d, 2=30d, 3=180d. */
  level?: 1 | 2 | 3;
}

export interface PruneCountOptions {
  /** Keep newest N artifacts; remove older files beyond this count. */
  maxCount: number;
  dryRun?: boolean;
}

export interface ArtifactStoreOptions {
  /**
   * Relative path from project root for artifact storage.
   * Default: `KIMI_ARTIFACTS_DIR` env or `.kimi/artifacts`.
   */
  artifactsRelativeDir?: string;
}

export interface PruneResult {
  removed: number;
  files: string[];
}

/** Normalize and validate a single identity value. Returns undefined if invalid. */
export function normalizeArtifactIdentityValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > ARTIFACT_IDENTITY_MAX_LEN) return undefined;
  if (!ARTIFACT_IDENTITY_SAFE_RE.test(trimmed)) return undefined;
  return trimmed;
}

/** Normalize all identity fields on a session context, dropping invalid values. */
export function normalizeArtifactSessionContext(
  ctx: ArtifactSessionContext
): ArtifactSessionContext {
  return {
    ...(normalizeArtifactIdentityValue(ctx.sessionId)
      ? { sessionId: normalizeArtifactIdentityValue(ctx.sessionId) }
      : {}),
    ...(normalizeArtifactIdentityValue(ctx.workspaceId)
      ? { workspaceId: normalizeArtifactIdentityValue(ctx.workspaceId) }
      : {}),
    ...(normalizeArtifactIdentityValue(ctx.paneId)
      ? { paneId: normalizeArtifactIdentityValue(ctx.paneId) }
      : {}),
    ...(normalizeArtifactIdentityValue(ctx.agentId)
      ? { agentId: normalizeArtifactIdentityValue(ctx.agentId) }
      : {}),
    ...(normalizeArtifactIdentityValue(ctx.runId)
      ? { runId: normalizeArtifactIdentityValue(ctx.runId) }
      : {}),
    ...(normalizeArtifactIdentityValue(ctx.parentRunId)
      ? { parentRunId: normalizeArtifactIdentityValue(ctx.parentRunId) }
      : {}),
  };
}

/** Stable canonical scope key for grouping/filtering by session or workspace. */
export function artifactScopeKey(ctx: ArtifactSessionContext): string {
  return (
    ctx.sessionId ??
    ctx.workspaceId ??
    ctx.runId ??
    ctx.agentId ??
    ctx.paneId ??
    ctx.parentRunId ??
    "default"
  );
}

/** Parse ISO timestamp from artifact filename (no stat). */
export function extractArtifactTimestamp(relativePath: string): string | null {
  const base = relativePath.split("/").pop() ?? "";
  const stem = base.replace(/\.json$/i, "");
  const restored = stem.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d+)Z$/,
    "$1T$2:$3:$4.$5Z"
  );
  return restored === stem ? null : restored;
}

/** Milliseconds since epoch from artifact filename, or null when unparseable. */
export function extractArtifactTimestampMs(relativePath: string): number | null {
  const iso = extractArtifactTimestamp(relativePath);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function unwrapArtifactPayload(parsed: unknown): unknown {
  if (
    parsed &&
    typeof parsed === "object" &&
    "schemaVersion" in parsed &&
    (parsed as ArtifactEnvelope).schemaVersion === ARTIFACT_SCHEMA_VERSION &&
    "payload" in parsed
  ) {
    return (parsed as ArtifactEnvelope).payload;
  }
  return parsed;
}

function absoluteArtifactPath(projectRoot: string, relativePath: string): string {
  return join(projectRoot, relativePath);
}

/** Filter chronological artifact paths by filename timestamp and optional newest limit. */
export function filterArtifactPaths(
  relativePaths: string[],
  options: ArtifactListOptions = {}
): ArtifactListResult {
  const total = relativePaths.length;
  let files = relativePaths;

  if (options.since) {
    const sinceMs = Date.parse(options.since);
    if (Number.isFinite(sinceMs)) {
      files = files.filter((path) => {
        const ts = extractArtifactTimestampMs(path);
        return ts !== null && ts >= sinceMs;
      });
    }
  }

  const limit =
    options.limit !== undefined && Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : undefined;

  if (limit !== undefined) {
    files = files.slice(-limit);
  }

  return {
    files,
    total,
    ...(options.since ? { since: options.since } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

/** Normalize `dependsOn` from envelope metadata. */
export function parseArtifactDependencies(
  metadata: ArtifactMetadata | undefined
): ArtifactDependencyQuery[] {
  if (!metadata || !Array.isArray(metadata.dependsOn)) return [];
  const out: ArtifactDependencyQuery[] = [];
  for (const entry of metadata.dependsOn) {
    if (!entry || typeof entry !== "object") continue;
    const gate = (entry as ArtifactDependencyQuery).gate;
    if (typeof gate !== "string" || gate.length === 0) continue;
    const query: ArtifactDependencyQuery = { gate };
    const since = (entry as ArtifactDependencyQuery).since;
    if (typeof since === "string" && since.length > 0) query.since = since;
    const limit = (entry as ArtifactDependencyQuery).limit;
    if (typeof limit === "number" && Number.isFinite(limit) && limit > 0) {
      query.limit = Math.floor(limit);
    }
    const paths = (entry as ArtifactDependencyQuery).paths;
    if (Array.isArray(paths)) {
      query.paths = paths.filter((p): p is string => typeof p === "string" && p.length > 0);
    }
    out.push(query);
  }
  return out;
}

function readQueryString(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value && value.length > 0 ? value : undefined;
}

/** Create a unique run id: `run_YYYYMMDD_HHMMSS_xxxxxx`. */
export function generateRunId(now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "_");
  const suffix = Bun.randomUUIDv7().replace(/-/g, "").slice(-8);
  return `run_${stamp}_${suffix}`;
}

export interface ArtifactIdentityEnvInput {
  workspaceId?: string;
  /** Herdr session name (`HERDR_SESSION` / `HERDR_SESSION_ID`). */
  session?: string;
  paneId?: string;
  parentRunId?: string;
}

/** Env vars to inject into Herdr pane/agent spawns for artifact identity. */
export function artifactIdentityEnv(
  workspaceIdOrOptions?: string | ArtifactIdentityEnvInput,
  legacySession?: string
): Record<string, string> {
  const options: ArtifactIdentityEnvInput =
    typeof workspaceIdOrOptions === "string"
      ? { workspaceId: workspaceIdOrOptions, session: legacySession }
      : (workspaceIdOrOptions ?? {});

  const kimiSession =
    Bun.env.KIMI_CODE_SESSION?.trim() || Bun.env.KIMI_AGENT_SESSION?.trim() || undefined;
  const paneId = options.paneId?.trim() || Bun.env.HERDR_PANE_ID?.trim() || undefined;
  const parentRunId =
    options.parentRunId?.trim() ||
    Bun.env.KIMI_PARENT_RUN_ID?.trim() ||
    Bun.env.KIMI_RUN_ID?.trim() ||
    undefined;

  const out: Record<string, string> = {};
  if (options.workspaceId) out.HERDR_WORKSPACE_ID = options.workspaceId;
  if (options.session) {
    out.HERDR_SESSION = options.session;
    out.HERDR_SESSION_ID = options.session;
  }
  if (kimiSession) out.KIMI_CODE_SESSION = kimiSession;
  if (paneId) out.HERDR_PANE_ID = paneId;
  if (parentRunId) out.KIMI_PARENT_RUN_ID = parentRunId;
  return out;
}

/** Resolve session/workspace/pane/agent/run context from the current process environment. */
export function resolveArtifactSessionContext(): ArtifactSessionContext {
  const sessionId =
    Bun.env.KIMI_CODE_SESSION?.trim() || Bun.env.KIMI_AGENT_SESSION?.trim() || undefined;
  const workspaceId =
    Bun.env.HERDR_WORKSPACE_ID?.trim() ||
    Bun.env.HERDR_SESSION_ID?.trim() ||
    Bun.env.HERDR_SESSION?.trim() ||
    undefined;
  const paneId = Bun.env.HERDR_PANE_ID?.trim() || undefined;
  const agentId = Bun.env.KIMI_AGENT_ID?.trim() || paneId || undefined;
  const runId = Bun.env.KIMI_RUN_ID?.trim() || undefined;
  const parentRunId = Bun.env.KIMI_PARENT_RUN_ID?.trim() || undefined;
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(paneId ? { paneId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(runId ? { runId } : {}),
    ...(parentRunId ? { parentRunId } : {}),
  };
}

function resolveArtifactIdentityContext(options?: { runId?: string }): ArtifactSessionContext & {
  runId: string;
} {
  const base = resolveArtifactSessionContext();
  const runId = normalizeArtifactIdentityValue(options?.runId) || base.runId || generateRunId();
  return { ...base, runId };
}

function readArtifactSessionFields(metadata: ArtifactMetadata | undefined): ArtifactSessionContext {
  if (!metadata) return {};
  const sessionId =
    typeof metadata.sessionId === "string" && metadata.sessionId.length > 0
      ? metadata.sessionId
      : undefined;
  const workspaceId =
    typeof metadata.workspaceId === "string" && metadata.workspaceId.length > 0
      ? metadata.workspaceId
      : undefined;
  const paneId =
    typeof metadata.paneId === "string" && metadata.paneId.length > 0 ? metadata.paneId : undefined;
  const agentId =
    typeof metadata.agentId === "string" && metadata.agentId.length > 0
      ? metadata.agentId
      : undefined;
  const runId =
    typeof metadata.runId === "string" && metadata.runId.length > 0 ? metadata.runId : undefined;
  const parentRunId =
    typeof metadata.parentRunId === "string" && metadata.parentRunId.length > 0
      ? metadata.parentRunId
      : undefined;
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(paneId ? { paneId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(runId ? { runId } : {}),
    ...(parentRunId ? { parentRunId } : {}),
  };
}

/** True when artifact metadata matches optional identity filters. */
export function matchesArtifactSessionContext(
  metadata: ArtifactMetadata | undefined,
  options: ArtifactSessionContext = {}
): boolean {
  if (options.sessionId && metadata?.sessionId !== options.sessionId) return false;
  if (options.workspaceId && metadata?.workspaceId !== options.workspaceId) return false;
  if (options.paneId && metadata?.paneId !== options.paneId) return false;
  if (options.agentId && metadata?.agentId !== options.agentId) return false;
  if (options.runId && metadata?.runId !== options.runId) return false;
  if (options.parentRunId && metadata?.parentRunId !== options.parentRunId) return false;
  return true;
}

/** Map a path segment from `/api/sessions/:session/...` to artifact identity filters. */
export function artifactFilterFromSessionRoute(session: string): ArtifactListOptions {
  const normalized = decodeURIComponent(session).trim();
  if (!normalized || normalized === "primary") return {};
  if (normalized.startsWith("wd_") || normalized.startsWith("kimi_")) {
    return { sessionId: normalized };
  }
  return { workspaceId: normalized };
}

function readQueryStrings(searchParams: URLSearchParams, key: string): string[] {
  const raw = searchParams.getAll(key);
  const values = raw
    .flatMap((v) => v.split(","))
    .map((v) => normalizeArtifactIdentityValue(v))
    .filter((v): v is string => v !== undefined);
  return [...new Set(values)];
}

export function parseArtifactListQuery(searchParams: URLSearchParams): ArtifactListOptions {
  const options: ArtifactListOptions = {};
  const since = searchParams.get("since");
  if (since) options.since = since;
  const until = searchParams.get("until");
  if (until) options.until = until;

  const limitRaw = searchParams.get("limit");
  if (limitRaw !== null && limitRaw !== "") {
    const limit = Number(limitRaw);
    if (Number.isFinite(limit) && limit > 0) options.limit = Math.floor(limit);
  }

  const sessionId = normalizeArtifactIdentityValue(readQueryString(searchParams, "sessionId"));
  if (sessionId) options.sessionId = sessionId;
  const workspaceId = normalizeArtifactIdentityValue(readQueryString(searchParams, "workspaceId"));
  if (workspaceId) options.workspaceId = workspaceId;
  /** Herdr session scope (`?session=staging`) — maps to `workspaceId` on saved artifacts. */
  const herdrSession = normalizeArtifactIdentityValue(readQueryString(searchParams, "session"));
  if (herdrSession && !options.workspaceId) options.workspaceId = herdrSession;
  const paneId = normalizeArtifactIdentityValue(readQueryString(searchParams, "paneId"));
  if (paneId) options.paneId = paneId;
  const agentId = normalizeArtifactIdentityValue(readQueryString(searchParams, "agentId"));
  if (agentId) options.agentId = agentId;
  const runId = normalizeArtifactIdentityValue(readQueryString(searchParams, "runId"));
  if (runId) options.runId = runId;
  const parentRunId = normalizeArtifactIdentityValue(readQueryString(searchParams, "parentRunId"));
  if (parentRunId) options.parentRunId = parentRunId;

  const sessionIds = readQueryStrings(searchParams, "sessionIds");
  if (sessionIds.length > 0) options.sessionIds = sessionIds;
  const workspaceIds = readQueryStrings(searchParams, "workspaceIds");
  if (workspaceIds.length > 0) options.workspaceIds = workspaceIds;
  const paneIds = readQueryStrings(searchParams, "paneIds");
  if (paneIds.length > 0) options.paneIds = paneIds;
  const agentIds = readQueryStrings(searchParams, "agentIds");
  if (agentIds.length > 0) options.agentIds = agentIds;
  const runIds = readQueryStrings(searchParams, "runIds");
  if (runIds.length > 0) options.runIds = runIds;
  const parentRunIds = readQueryStrings(searchParams, "parentRunIds");
  if (parentRunIds.length > 0) options.parentRunIds = parentRunIds;
  const statuses = readQueryStrings(searchParams, "statuses");
  if (statuses.length > 0) options.statuses = statuses;

  return options;
}

function artifactListOptionsToIndexQuery(
  filter: ArtifactListOptions,
  gate?: string
): ArtifactIndexQuery {
  const sessionIds = [
    ...(filter.sessionIds ?? []),
    ...(filter.sessionId ? [filter.sessionId] : []),
  ];
  const workspaceIds = [
    ...(filter.workspaceIds ?? []),
    ...(filter.workspaceId ? [filter.workspaceId] : []),
  ];
  const paneIds = [...(filter.paneIds ?? []), ...(filter.paneId ? [filter.paneId] : [])];
  const agentIds = [...(filter.agentIds ?? []), ...(filter.agentId ? [filter.agentId] : [])];
  const runIds = [...(filter.runIds ?? []), ...(filter.runId ? [filter.runId] : [])];
  const parentRunIds = [
    ...(filter.parentRunIds ?? []),
    ...(filter.parentRunId ? [filter.parentRunId] : []),
  ];

  return {
    ...(gate ? { gates: [gate] } : {}),
    ...(sessionIds.length > 0 ? { sessionIds } : {}),
    ...(workspaceIds.length > 0 ? { workspaceIds } : {}),
    ...(paneIds.length > 0 ? { paneIds } : {}),
    ...(agentIds.length > 0 ? { agentIds } : {}),
    ...(runIds.length > 0 ? { runIds } : {}),
    ...(parentRunIds.length > 0 ? { parentRunIds } : {}),
    ...(filter.statuses && filter.statuses.length > 0 ? { statuses: filter.statuses } : {}),
    ...(filter.since ? { since: filter.since } : {}),
    ...(filter.until ? { until: filter.until } : {}),
    ...(filter.limit !== undefined ? { limit: filter.limit } : {}),
    order: "desc",
  };
}

function resolveArtifactsRelativeDir(override?: string): string {
  const env = Bun.env.KIMI_ARTIFACTS_DIR?.trim();
  const raw = override ?? env ?? join(".kimi", "artifacts");
  return raw.replace(/^\/+/, "");
}

/** Persist gate run results under `{projectRoot}/.kimi/artifacts/{gateName}/`. */
export class ArtifactStore {
  private readonly artifactsRelativeDir: string;
  private readonly index: ArtifactIndex;

  constructor(
    private readonly projectRoot: string = process.cwd(),
    options: ArtifactStoreOptions = {}
  ) {
    this.artifactsRelativeDir = resolveArtifactsRelativeDir(options.artifactsRelativeDir);
    this.index = new ArtifactIndex(this.rootArtifactsDir());
  }

  /** Access the underlying SQLite index (for dashboards and advanced queries). */
  getIndex(): ArtifactIndex {
    return this.index;
  }

  /** Rebuild the read-only SQLite index from filesystem envelopes (idempotent). */
  async rebuildIndex(): Promise<number> {
    return this.index.rebuild(async (gateRelativePath) => {
      const relativePath = join(this.artifactsRelativeDir, gateRelativePath);
      const envelope = await this.readEnvelope(relativePath);
      if (!envelope) return null;
      return { envelope, relativePath };
    });
  }

  /** Count envelope JSON files on disk (excludes `runs/` manifests). */
  async countFilesystemArtifacts(): Promise<number> {
    const dir = this.rootArtifactsDir();
    if (!pathExists(dir)) return 0;
    let count = 0;
    for (const entry of listDir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "runs") continue;
      count += listDir(join(dir, entry.name)).filter((name) => name.endsWith(".json")).length;
    }
    return count;
  }

  /** Warm the index when artifact files exist but `.index.sqlite` is missing. */
  async ensureIndex(): Promise<boolean> {
    if (this.index.exists()) return false;
    const dir = this.rootArtifactsDir();
    if (!pathExists(dir)) return false;
    for (const entry of listDir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "runs") continue;
      const gateDir = join(dir, entry.name);
      if (listDir(gateDir).some((name) => name.endsWith(".json"))) {
        await this.rebuildIndex();
        return true;
      }
    }
    return false;
  }

  /**
   * Rebuild the SQLite index when filesystem and index row counts diverge.
   * Returns whether a rebuild ran.
   */
  async syncIndexIfDrifted(): Promise<{ rebuilt: boolean; fsCount: number; indexCount: number }> {
    let rebuilt = await this.ensureIndex();
    const fsCount = await this.countFilesystemArtifacts();
    if (fsCount === 0) {
      return {
        rebuilt,
        fsCount: 0,
        indexCount: this.index.exists() ? this.index.stats().totalArtifacts : 0,
      };
    }
    if (!this.index.exists()) {
      const indexed = await this.rebuildIndex();
      return { rebuilt: true, fsCount, indexCount: indexed };
    }
    const indexCount = this.index.stats().totalArtifacts;
    if (fsCount !== indexCount) {
      const indexed = await this.rebuildIndex();
      return { rebuilt: true, fsCount, indexCount: indexed };
    }
    return { rebuilt, fsCount, indexCount };
  }

  /** SQLite index summary (read-only layer). */
  async getIndexStats(): Promise<ArtifactIndexStats & { fsArtifactCount: number }> {
    const sync = await this.syncIndexIfDrifted();
    return { ...this.index.stats(), fsArtifactCount: sync.fsCount };
  }

  /** Indexed metadata collection — reads `metadata_json` from `.index.sqlite`. */
  async collectMetadata(
    filter: ArtifactListOptions = {},
    options: { gate?: string } = {}
  ): Promise<{
    ok: true;
    entries: ArtifactMetadataCollectionEntry[];
    total: number;
    indexSource: "sqlite";
  }> {
    await this.syncIndexIfDrifted();
    const query = artifactListOptionsToIndexQuery(filter, options.gate);
    const entries = this.index.findMetadataCollection(query);
    return { ok: true, entries, total: entries.length, indexSource: "sqlite" };
  }

  /** Compare two artifact envelopes by content hash and indexed metadata. */
  async diffArtifactPaths(
    pathA: string,
    pathB: string
  ): Promise<{
    ok: boolean;
    pathA: string;
    pathB: string;
    hashA: string | null;
    hashB: string | null;
    equal: boolean;
    statusA?: string;
    statusB?: string;
    runIdA?: string;
    runIdB?: string;
    error?: string;
  }> {
    await this.syncIndexIfDrifted();
    const envelopeA = await this.readEnvelope(pathA);
    const envelopeB = await this.readEnvelope(pathB);
    if (!envelopeA || !envelopeB) {
      return {
        ok: false,
        pathA,
        pathB,
        hashA: null,
        hashB: null,
        equal: false,
        error: !envelopeA ? `Artifact not found: ${pathA}` : `Artifact not found: ${pathB}`,
      };
    }
    const hashA = computeArtifactContentHash(envelopeA.payload);
    const hashB = computeArtifactContentHash(envelopeB.payload);
    const rowA = this.index.findByRelativePath(pathA);
    const rowB = this.index.findByRelativePath(pathB);
    return {
      ok: true,
      pathA,
      pathB,
      hashA: rowA?.contentHash ?? hashA,
      hashB: rowB?.contentHash ?? hashB,
      equal: hashA === hashB,
      ...(rowA?.status ? { statusA: rowA.status } : {}),
      ...(rowB?.status ? { statusB: rowB.status } : {}),
      ...(rowA?.runId ? { runIdA: rowA.runId } : {}),
      ...(rowB?.runId ? { runIdB: rowB.runId } : {}),
    };
  }

  /**
   * Resolve artifact paths for a run — prefers SQLite index, falls back to manifest map.
   * Files remain authoritative; the index is the fast read path.
   */
  async listRunArtifactRefs(
    runId: string,
    manifest: ArtifactRunManifest
  ): Promise<Array<{ gate: string; relativePath: string; indexSource: boolean }>> {
    await this.syncIndexIfDrifted();
    const indexed = this.index.findByRunId(runId, { order: "asc" });
    if (indexed.length > 0) {
      return indexed.map((row) => ({
        gate: row.gate,
        relativePath: row.relativePath,
        indexSource: true,
      }));
    }
    return manifest.gates
      .map((gate) => ({
        gate,
        relativePath: manifest.artifacts[gate] ?? "",
        indexSource: false,
      }))
      .filter((row) => row.relativePath.length > 0);
  }

  private rootArtifactsDir(): string {
    return join(this.projectRoot, this.artifactsRelativeDir);
  }

  artifactsDir(gateName: string): string {
    return join(this.rootArtifactsDir(), gateName);
  }

  /** Gate names with at least one saved artifact, sorted alphabetically. */
  async listGates(): Promise<string[]> {
    await this.syncIndexIfDrifted();
    if (this.index.exists()) {
      return this.index.listGates();
    }
    const dir = this.rootArtifactsDir();
    if (!pathExists(dir)) return [];
    return listDir(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "runs")
      .map((entry) => entry.name)
      .sort();
  }

  private runsDir(): string {
    return join(this.rootArtifactsDir(), "runs");
  }

  runManifestRelativePath(runId: string): string {
    return join(this.artifactsRelativeDir, "runs", `${runId}.json`);
  }

  /** Persist a run manifest grouping artifacts from one gate-runner invocation. */
  async saveRunManifest(manifest: ArtifactRunManifest): Promise<string> {
    const dir = this.runsDir();
    makeDir(dir, { recursive: true });
    const path = join(dir, `${manifest.runId}.json`);
    await Bun.write(path, JSON.stringify(manifest, null, 2));
    return path;
  }

  /** Read a run manifest by id. */
  async readRunManifest(runId: string): Promise<ArtifactRunManifest | null> {
    const path = join(this.runsDir(), `${runId}.json`);
    if (!pathExists(path)) return null;
    const parsed = safeParse(await Bun.file(path).text(), null);
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as ArtifactRunManifest;
    return typeof row.runId === "string" && row.runId.length > 0 ? row : null;
  }

  /** List run ids (newest manifest mtime first). */
  async listRunIds(): Promise<string[]> {
    const dir = this.runsDir();
    if (!pathExists(dir)) return [];
    const names = listDir(dir).filter((name) => name.endsWith(".json"));
    const rows = await Promise.all(
      names.map(async (name) => {
        const path = join(dir, name);
        const stat = await Bun.file(path).stat();
        return { runId: name.replace(/\.json$/i, ""), mtimeMs: stat.mtimeMs ?? 0 };
      })
    );
    return rows.sort((a, b) => b.mtimeMs - a.mtimeMs).map((row) => row.runId);
  }

  /** List run manifests, newest first, with optional identity filters. */
  async listRunManifests(options: ArtifactListOptions = {}): Promise<ArtifactRunManifest[]> {
    const runIds = await this.listRunIds();
    const manifests: ArtifactRunManifest[] = [];
    for (const runId of runIds) {
      const manifest = await this.readRunManifest(runId);
      if (!manifest) continue;
      if (options.sessionId && manifest.sessionId !== options.sessionId) continue;
      if (options.workspaceId && manifest.workspaceId !== options.workspaceId) continue;
      if (options.paneId && manifest.paneId !== options.paneId) continue;
      if (options.agentId && manifest.agentId !== options.agentId) continue;
      if (options.runId && manifest.runId !== options.runId) continue;
      if (options.parentRunId && manifest.parentRunId !== options.parentRunId) continue;
      manifests.push(manifest);
      if (options.limit !== undefined && manifests.length >= options.limit) break;
    }
    return manifests;
  }

  /** Distinct identity values across indexed artifacts and run manifests. */
  async distinctIdentityFields(): Promise<{
    sessionIds: string[];
    workspaceIds: string[];
    paneIds: string[];
    agentIds: string[];
    runIds: string[];
  }> {
    const fromIndex = this.index.distinct();
    const sessionIds = new Set(fromIndex.sessionIds);
    const workspaceIds = new Set(fromIndex.workspaceIds);
    const paneIds = new Set(fromIndex.paneIds);
    const agentIds = new Set(fromIndex.agentIds);
    const runIds = new Set(fromIndex.runIds);

    for (const manifest of await this.listRunManifests()) {
      if (manifest.sessionId) sessionIds.add(manifest.sessionId);
      if (manifest.workspaceId) workspaceIds.add(manifest.workspaceId);
      if (manifest.paneId) paneIds.add(manifest.paneId);
      if (manifest.agentId) agentIds.add(manifest.agentId);
      if (manifest.runId) runIds.add(manifest.runId);
    }

    return {
      sessionIds: [...sessionIds].sort(),
      workspaceIds: [...workspaceIds].sort(),
      paneIds: [...paneIds].sort(),
      agentIds: [...agentIds].sort(),
      runIds: [...runIds].sort(),
    };
  }

  /** Write JSON artifact envelope; returns absolute path. */
  async save(gateName: string, payload: unknown, meta?: ArtifactSaveMeta): Promise<string> {
    const dir = this.artifactsDir(gateName);
    makeDir(dir, { recursive: true });
    let stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let path = join(dir, `${stamp}.json`);
    // Millisecond precision can collide for rapid successive saves in tests.
    // Sleep until the timestamp changes so every artifact gets a unique filename.
    while (pathExists(path)) {
      await Bun.sleep(1);
      stamp = new Date().toISOString().replace(/[:.]/g, "-");
      path = join(dir, `${stamp}.json`);
    }
    const relativePath = this.relativePath(path);
    const savedAt = new Date().toISOString();
    const resultSize = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    const contentHash = computeArtifactContentHash(payload);

    let lineageMermaid = meta?.lineageMermaid;
    if (!lineageMermaid && meta?.dependsOn && meta.dependsOn.length > 0) {
      const resolved = await this.resolveDependsOn(meta.dependsOn);
      lineageMermaid = generateArtifactLineageMermaid(relativePath, resolved);
    }

    const identity = normalizeArtifactSessionContext(
      resolveArtifactIdentityContext({ runId: meta?.runId?.trim() })
    );
    const parentRunId = normalizeArtifactIdentityValue(meta?.parentRunId) || identity.parentRunId;
    const metadata: ArtifactMetadata = {
      ...meta,
      ...(lineageMermaid ? { lineageMermaid } : {}),
      ...identity,
      ...(parentRunId ? { parentRunId } : {}),
      hostname: osHostname(),
      pid: process.pid,
      bunVersion: bunVersion(),
      resultSize,
    };
    const envelopeWithoutSize: Omit<ArtifactEnvelope, "size"> = {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      gate: gateName,
      savedAt,
      metadata,
      payload,
    };
    const text = JSON.stringify(envelopeWithoutSize, null, 2);
    const size = new TextEncoder().encode(text).byteLength;
    const envelope: ArtifactEnvelope = { ...envelopeWithoutSize, size };
    await Bun.write(path, JSON.stringify(envelope, null, 2));
    this.index.indexEnvelope(envelope, relativePath, path, contentHash);
    return path;
  }

  /** Attach runtime gate-runner lineage to an existing artifact envelope. */
  async attachRunLineage(relativePath: string, lineage: ArtifactRunLineage): Promise<void> {
    const envelope = await this.readEnvelope(relativePath);
    if (!envelope) return;

    const metadata: ArtifactMetadata = {
      hostname: osHostname(),
      pid: process.pid,
      bunVersion: bunVersion(),
      resultSize:
        typeof envelope.metadata?.resultSize === "number"
          ? envelope.metadata.resultSize
          : new TextEncoder().encode(JSON.stringify(envelope.payload)).byteLength,
      ...envelope.metadata,
      lineage,
    };

    const updated: Omit<ArtifactEnvelope, "size"> = {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      gate: envelope.gate,
      savedAt: envelope.savedAt,
      metadata,
      payload: envelope.payload,
    };
    const text = JSON.stringify(updated, null, 2);
    const size = new TextEncoder().encode(text).byteLength;
    const absolutePath = join(this.projectRoot, relativePath);
    const newEnvelope: ArtifactEnvelope = { ...updated, size };
    await Bun.write(absolutePath, JSON.stringify(newEnvelope, null, 2));
    this.index.indexEnvelope(newEnvelope, relativePath, absolutePath);
  }

  /** List artifact relative paths for a gate, oldest → newest. */
  async list(gateName: string): Promise<string[]> {
    const dir = this.artifactsDir(gateName);
    if (!pathExists(dir)) return [];
    return listDir(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => this.relativePath(join(dir, name)));
  }

  /** List with optional `since` (ISO) and `limit` (newest N) filters — no stat calls. */
  async listFiltered(
    gateName: string,
    options: ArtifactListOptions = {}
  ): Promise<ArtifactListResult> {
    const all = await this.list(gateName);
    return filterArtifactPaths(all, options);
  }

  /** Build an ArtifactListEntry from an indexed row (no extra envelope read). */
  private indexRowToEntry(row: {
    gate: string;
    path: string;
    relativePath: string;
    savedAt: string;
    savedAtMs: number;
    size: number;
    resultSize?: number;
    status?: string;
    sessionId?: string;
    workspaceId?: string;
    paneId?: string;
    agentId?: string;
    runId?: string;
    parentRunId?: string;
    contentHash?: string;
  }): ArtifactListEntry {
    return {
      path: row.relativePath,
      timestamp: extractArtifactTimestamp(row.relativePath),
      size: row.size,
      ...(row.resultSize !== undefined ? { resultSize: row.resultSize } : {}),
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
      ...(row.workspaceId ? { workspaceId: row.workspaceId } : {}),
      ...(row.paneId ? { paneId: row.paneId } : {}),
      ...(row.agentId ? { agentId: row.agentId } : {}),
      ...(row.runId ? { runId: row.runId } : {}),
      ...(row.parentRunId ? { parentRunId: row.parentRunId } : {}),
    };
  }

  /** True when any identity/status/range filter is active beyond since/limit. */
  private hasAdvancedFilter(options: ArtifactListOptions): boolean {
    return Boolean(
      options.sessionId ||
      options.workspaceId ||
      options.paneId ||
      options.agentId ||
      options.runId ||
      options.parentRunId ||
      options.until ||
      options.sessionIds?.length ||
      options.workspaceIds?.length ||
      options.paneIds?.length ||
      options.agentIds?.length ||
      options.runIds?.length ||
      options.parentRunIds?.length ||
      options.statuses?.length
    );
  }

  /** Convert ArtifactListOptions to the index query format. */
  private toIndexQuery(
    gateName: string | undefined,
    options: ArtifactListOptions
  ): ArtifactIndexQuery {
    const query: ArtifactIndexQuery = {};
    if (gateName) query.gates = [gateName];
    if (options.since) query.since = options.since;
    if (options.until) query.until = options.until;
    if (options.limit !== undefined) query.limit = options.limit;

    const addSingle = (key: keyof ArtifactIndexQuery, value: string | undefined): void => {
      if (!value) return;
      const arr = (query[key] as string[] | undefined) ?? [];
      if (!arr.includes(value)) arr.push(value);
      (query as Record<string, unknown>)[key] = arr;
    };

    addSingle("sessionIds", options.sessionId);
    addSingle("workspaceIds", options.workspaceId);
    addSingle("paneIds", options.paneId);
    addSingle("agentIds", options.agentId);
    addSingle("runIds", options.runId);
    addSingle("parentRunIds", options.parentRunId);

    const merge = (key: keyof ArtifactIndexQuery, values: string[] | undefined): void => {
      if (!values || values.length === 0) return;
      const arr = ((query[key] as string[] | undefined) ?? []).slice();
      for (const v of values) {
        if (!arr.includes(v)) arr.push(v);
      }
      (query as Record<string, unknown>)[key] = arr;
    };

    merge("sessionIds", options.sessionIds);
    merge("workspaceIds", options.workspaceIds);
    merge("paneIds", options.paneIds);
    merge("agentIds", options.agentIds);
    merge("runIds", options.runIds);
    merge("parentRunIds", options.parentRunIds);
    merge("statuses", options.statuses);

    return query;
  }

  /** List filtered artifacts with sizes read from envelope JSON (no stat). */
  async listEntries(
    gateName: string,
    options: ArtifactListOptions = {}
  ): Promise<ArtifactListEntriesResult> {
    await this.syncIndexIfDrifted();
    const useIndex = this.index.exists() && this.hasAdvancedFilter(options);

    if (useIndex) {
      const rows = this.index.find(this.toIndexQuery(gateName, options));
      const entries = rows.map((row) => this.indexRowToEntry(row));
      return {
        files: entries.map((e) => e.path),
        total: entries.length,
        entries,
        ...(options.since ? { since: options.since } : {}),
        ...(options.until ? { until: options.until } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
      };
    }

    const { sessionId, workspaceId, paneId, agentId, runId, parentRunId, limit, ...pathOptions } =
      options;
    const sessionFilter: ArtifactSessionContext = {
      ...(sessionId ? { sessionId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(paneId ? { paneId } : {}),
      ...(agentId ? { agentId } : {}),
      ...(runId ? { runId } : {}),
      ...(parentRunId ? { parentRunId } : {}),
    };
    const hasSessionFilter = Object.keys(sessionFilter).length > 0;
    const filtered = await this.listFiltered(gateName, hasSessionFilter ? pathOptions : options);

    const buildEntry = async (filePath: string): Promise<ArtifactListEntry> => {
      const envelope = await this.readEnvelope(filePath);
      return {
        path: filePath,
        timestamp: extractArtifactTimestamp(filePath),
        ...readArtifactSessionFields(envelope?.metadata),
        ...(envelope
          ? {
              size: typeof envelope.size === "number" ? envelope.size : undefined,
              resultSize:
                typeof envelope.metadata?.resultSize === "number"
                  ? envelope.metadata.resultSize
                  : undefined,
            }
          : await this.readEnvelopeSummary(filePath)),
      };
    };

    if (!hasSessionFilter) {
      const entries: ArtifactListEntry[] = [];
      for (const filePath of filtered.files) {
        entries.push(await buildEntry(filePath));
      }
      return { ...filtered, entries };
    }

    const entries: ArtifactListEntry[] = [];
    for (const filePath of filtered.files.toReversed()) {
      const envelope = await this.readEnvelope(filePath);
      if (!matchesArtifactSessionContext(envelope?.metadata, sessionFilter)) continue;
      entries.unshift(await buildEntry(filePath));
      if (limit !== undefined && entries.length >= limit) break;
    }

    return {
      ...filtered,
      files: entries.map((entry) => entry.path),
      total: filtered.total,
      entries,
      ...(limit !== undefined ? { limit } : {}),
    };
  }

  /** Read full envelope for a relative artifact path. */
  async readEnvelope(relativePath: string): Promise<ArtifactEnvelope | null> {
    const absolutePath = absoluteArtifactPath(this.projectRoot, relativePath);
    if (!pathExists(absolutePath)) return null;
    const parsed = safeParse(await Bun.file(absolutePath).text(), null);
    if (
      parsed &&
      typeof parsed === "object" &&
      "schemaVersion" in parsed &&
      (parsed as ArtifactEnvelope).schemaVersion === ARTIFACT_SCHEMA_VERSION
    ) {
      return parsed as ArtifactEnvelope;
    }
    return null;
  }

  /** Declared `dependsOn` queries from artifact metadata. */
  async getDependencies(relativePath: string): Promise<ArtifactDependencyQuery[]> {
    const envelope = await this.readEnvelope(relativePath);
    return parseArtifactDependencies(envelope?.metadata);
  }

  /** Build Mermaid lineage for a saved artifact (declarative, runtime, or stored). */
  async buildLineageGraph(relativePath: string): Promise<{
    relativePath: string;
    gate: string;
    queries: ArtifactDependencyQuery[];
    resolved: ResolvedArtifactDependency[];
    runLineage: ArtifactRunLineage | null;
    lineageSource: "stored" | "declarative" | "runtime" | "none";
    mermaid: string;
    stored: boolean;
  } | null> {
    const envelope = await this.readEnvelope(relativePath);
    if (!envelope) return null;

    const queries = parseArtifactDependencies(envelope.metadata);
    const runLineage = envelope.metadata?.lineage ?? null;
    const storedMermaid = envelope.metadata?.lineageMermaid;
    if (typeof storedMermaid === "string" && storedMermaid.length > 0) {
      const resolved = await this.resolveDependsOn(queries);
      return {
        relativePath,
        gate: envelope.gate,
        queries,
        resolved,
        runLineage,
        lineageSource: "stored",
        mermaid: storedMermaid,
        stored: true,
      };
    }

    const resolved = await this.resolveDependsOn(queries);
    const hasDeclarativeDeps = resolved.some((block) => block.paths.length > 0);
    if (hasDeclarativeDeps) {
      return {
        relativePath,
        gate: envelope.gate,
        queries,
        resolved,
        runLineage,
        lineageSource: "declarative",
        mermaid: generateArtifactLineageMermaid(relativePath, resolved),
        stored: false,
      };
    }

    if (
      runLineage &&
      (runLineage.upstreamArtifacts.length > 0 || runLineage.dependencies.length > 0)
    ) {
      return {
        relativePath,
        gate: envelope.gate,
        queries,
        resolved,
        runLineage,
        lineageSource: "runtime",
        mermaid: generateRunLineageMermaid(relativePath, runLineage),
        stored: false,
      };
    }

    return {
      relativePath,
      gate: envelope.gate,
      queries,
      resolved,
      runLineage,
      lineageSource: "none",
      mermaid: generateArtifactLineageMermaid(relativePath, resolved),
      stored: false,
    };
  }

  /** Resolve declared dependencies to concrete artifact paths. */
  async resolveDependsOn(
    queries: ArtifactDependencyQuery[]
  ): Promise<ResolvedArtifactDependency[]> {
    const resolved: ResolvedArtifactDependency[] = [];
    for (const query of queries) {
      if (query.paths && query.paths.length > 0) {
        const paths = query.paths.filter((p) =>
          pathExists(absoluteArtifactPath(this.projectRoot, p))
        );
        resolved.push({ query, paths });
        continue;
      }
      const listed = await this.listFiltered(query.gate, {
        since: query.since,
        limit: query.limit,
      });
      resolved.push({ query, paths: listed.files });
    }
    return resolved;
  }

  private async readEnvelopeSummary(
    relativePath: string
  ): Promise<Pick<ArtifactListEntry, "size" | "resultSize">> {
    const envelope = await this.readEnvelope(relativePath);
    if (envelope) {
      return {
        size: typeof envelope.size === "number" ? envelope.size : undefined,
        resultSize:
          typeof envelope.metadata?.resultSize === "number"
            ? envelope.metadata.resultSize
            : undefined,
      };
    }
    const absolutePath = absoluteArtifactPath(this.projectRoot, relativePath);
    if (!pathExists(absolutePath)) return {};
    const text = await Bun.file(absolutePath).text();
    return { size: new TextEncoder().encode(text).byteLength };
  }

  /** Newest artifact for a gate, or null when the directory is empty. */
  async getLatest(gateName: string): Promise<ArtifactRecord | null> {
    const dir = this.artifactsDir(gateName);
    if (!pathExists(dir)) return null;
    const names = listDir(dir)
      .filter((name) => name.endsWith(".json"))
      .sort();
    const latest = names.at(-1);
    if (!latest) return null;
    const path = join(dir, latest);
    const text = await Bun.file(path).text();
    const parsed = safeParse(text, null);
    return {
      path,
      relativePath: this.relativePath(path),
      payload: unwrapArtifactPayload(parsed),
    };
  }

  /** Remove artifacts older than threshold. `level` resolves maxAgeMs from {@link GATE_LEVEL_PRUNE_MS}. */
  async prune(gateName: string, opts: PruneOptions = {}): Promise<PruneResult> {
    const maxAgeMs =
      opts.maxAgeMs ??
      (opts.level ? GATE_LEVEL_PRUNE_MS[opts.level] : undefined) ??
      DEFAULT_ARTIFACT_MAX_AGE_MS;
    const cutoff = Date.now() - maxAgeMs;
    const relativePaths = await this.list(gateName);
    const files: string[] = [];

    for (const relativePath of relativePaths) {
      const timestampMs = extractArtifactTimestampMs(relativePath);
      if (timestampMs === null || timestampMs >= cutoff) continue;
      const absolutePath = absoluteArtifactPath(this.projectRoot, relativePath);
      if (!pathExists(absolutePath)) continue;
      files.push(relativePath);
      if (!opts.dryRun) {
        removePath(absolutePath, { force: true });
        this.index.removeByPath(absolutePath);
      }
    }

    return { removed: files.length, files };
  }

  /** Keep newest `maxCount` artifacts; remove older files (oldest first). */
  async pruneByCount(gateName: string, opts: PruneCountOptions): Promise<PruneResult> {
    const maxCount = Math.max(1, Math.floor(opts.maxCount));
    const relativePaths = await this.list(gateName);
    if (relativePaths.length <= maxCount) return { removed: 0, files: [] };

    const files = relativePaths.slice(0, relativePaths.length - maxCount);
    if (!opts.dryRun) {
      for (const relativePath of files) {
        const absolutePath = join(this.projectRoot, relativePath);
        if (pathExists(absolutePath)) {
          removePath(absolutePath, { force: true });
          this.index.removeByPath(absolutePath);
        }
      }
    }
    return { removed: files.length, files };
  }

  /** Path relative to project root for CLI display. */
  relativePath(absolutePath: string): string {
    const root = this.projectRoot.endsWith("/") ? this.projectRoot : `${this.projectRoot}/`;
    if (absolutePath.startsWith(root)) {
      return absolutePath.slice(root.length);
    }
    return absolutePath;
  }
}
