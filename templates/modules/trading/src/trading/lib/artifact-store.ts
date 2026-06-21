/**
 * Versioned gate artifacts under `.kimi/artifacts/<gate>/`.
 *
 * Supports declarative `dependsOn` queries at save time and runtime `lineage`
 * from the gate runner. Prune retention is level-aware via `GATE_LEVEL_PRUNE_MS`.
 *
 * @see src/gates/runner.ts — `persistGateArtifact`, `buildGateContext`
 * @see examples/artifact-trading-loop.md — L2 feedback loop demo
 */
import { hostname } from "os";
import { join } from "path";
import { listDir, makeDir, pathExists, removePath } from "./bun-io.ts";
import { GATE_LEVEL_PRUNE_MS } from "../gates/types.ts";
import { generateArtifactLineageMermaid, generateRunLineageMermaid } from "./graph-to-mermaid.ts";
import { safeParse } from "./utils.ts";

export const ARTIFACT_SCHEMA_VERSION = 1;
export const DEFAULT_ARTIFACT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ArtifactRecord {
  path: string;
  relativePath: string;
  payload: unknown;
}

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

export interface ResolvedArtifactDependency {
  query: ArtifactDependencyQuery;
  paths: string[];
}

export interface ArtifactRunLineage {
  dependencies: string[];
  upstreamArtifacts: string[];
}

export interface ArtifactSessionContext {
  /** Kimi Code or agent session (`KIMI_CODE_SESSION` / `KIMI_AGENT_SESSION`). */
  sessionId?: string;
  /** Herdr workspace (`HERDR_WORKSPACE_ID`). */
  workspaceId?: string;
  /** Agent or pane id (`KIMI_AGENT_ID` / `HERDR_PANE_ID`). */
  agentId?: string;
}

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

export interface ArtifactListEntry extends ArtifactSessionContext {
  path: string;
  timestamp: string | null;
  size?: number;
  resultSize?: number;
}

export interface ArtifactListEntriesResult extends ArtifactListResult {
  entries: ArtifactListEntry[];
}

export interface ArtifactListOptions extends ArtifactSessionContext {
  /** ISO-8601 lower bound (inclusive). */
  since?: string;
  /** Max entries to return (newest when list is chronological). */
  limit?: number;
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

/** Resolve session/workspace/agent context from the current process environment. */
export function resolveArtifactSessionContext(): ArtifactSessionContext {
  const sessionId =
    Bun.env.KIMI_CODE_SESSION?.trim() || Bun.env.KIMI_AGENT_SESSION?.trim() || undefined;
  const workspaceId = Bun.env.HERDR_WORKSPACE_ID?.trim() || undefined;
  const agentId = Bun.env.KIMI_AGENT_ID?.trim() || Bun.env.HERDR_PANE_ID?.trim() || undefined;
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(agentId ? { agentId } : {}),
  };
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
  const agentId =
    typeof metadata.agentId === "string" && metadata.agentId.length > 0
      ? metadata.agentId
      : undefined;
  return {
    ...(sessionId ? { sessionId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

/** True when artifact metadata matches optional session/workspace/agent filters. */
export function matchesArtifactSessionContext(
  metadata: ArtifactMetadata | undefined,
  options: ArtifactSessionContext = {}
): boolean {
  if (options.sessionId && metadata?.sessionId !== options.sessionId) return false;
  if (options.workspaceId && metadata?.workspaceId !== options.workspaceId) return false;
  if (options.agentId && metadata?.agentId !== options.agentId) return false;
  return true;
}

export function parseArtifactListQuery(searchParams: URLSearchParams): ArtifactListOptions {
  const options: ArtifactListOptions = {};
  const since = searchParams.get("since");
  if (since) options.since = since;

  const limitRaw = searchParams.get("limit");
  if (limitRaw !== null && limitRaw !== "") {
    const limit = Number(limitRaw);
    if (Number.isFinite(limit) && limit > 0) options.limit = Math.floor(limit);
  }

  const sessionId = readQueryString(searchParams, "sessionId");
  if (sessionId) options.sessionId = sessionId;
  const workspaceId = readQueryString(searchParams, "workspaceId");
  if (workspaceId) options.workspaceId = workspaceId;
  const agentId = readQueryString(searchParams, "agentId");
  if (agentId) options.agentId = agentId;

  return options;
}

function resolveArtifactsRelativeDir(override?: string): string {
  const env = Bun.env.KIMI_ARTIFACTS_DIR?.trim();
  const raw = override ?? env ?? join(".kimi", "artifacts");
  return raw.replace(/^\/+/, "");
}

/** Persist gate run results under `{projectRoot}/.kimi/artifacts/{gateName}/`. */
export class ArtifactStore {
  private readonly artifactsRelativeDir: string;

  constructor(
    private readonly projectRoot: string = process.cwd(),
    options: ArtifactStoreOptions = {}
  ) {
    this.artifactsRelativeDir = resolveArtifactsRelativeDir(options.artifactsRelativeDir);
  }

  private rootArtifactsDir(): string {
    return join(this.projectRoot, this.artifactsRelativeDir);
  }

  artifactsDir(gateName: string): string {
    return join(this.rootArtifactsDir(), gateName);
  }

  /** Gate names with at least one saved artifact, sorted alphabetically. */
  async listGates(): Promise<string[]> {
    const dir = this.rootArtifactsDir();
    if (!pathExists(dir)) return [];
    return listDir(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  /** Write JSON artifact envelope; returns absolute path. */
  async save(gateName: string, payload: unknown, meta?: ArtifactSaveMeta): Promise<string> {
    const dir = this.artifactsDir(gateName);
    makeDir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = join(dir, `${stamp}.json`);
    const relativePath = this.relativePath(path);
    const savedAt = new Date().toISOString();
    const resultSize = new TextEncoder().encode(JSON.stringify(payload)).length;

    let lineageMermaid = meta?.lineageMermaid;
    if (!lineageMermaid && meta?.dependsOn && meta.dependsOn.length > 0) {
      const resolved = await this.resolveDependsOn(meta.dependsOn);
      lineageMermaid = generateArtifactLineageMermaid(relativePath, resolved);
    }

    const sessionContext = resolveArtifactSessionContext();
    const metadata: ArtifactMetadata = {
      ...meta,
      ...(lineageMermaid ? { lineageMermaid } : {}),
      ...sessionContext,
      hostname: hostname(),
      pid: process.pid,
      bunVersion: Bun.version,
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
    const size = new TextEncoder().encode(text).length;
    const envelope: ArtifactEnvelope = { ...envelopeWithoutSize, size };
    await Bun.write(path, JSON.stringify(envelope, null, 2));
    return path;
  }

  /** Attach runtime gate-runner lineage to an existing artifact envelope. */
  async attachRunLineage(relativePath: string, lineage: ArtifactRunLineage): Promise<void> {
    const envelope = await this.readEnvelope(relativePath);
    if (!envelope) return;

    const metadata: ArtifactMetadata = {
      hostname: hostname(),
      pid: process.pid,
      bunVersion: Bun.version,
      resultSize:
        typeof envelope.metadata?.resultSize === "number"
          ? envelope.metadata.resultSize
          : new TextEncoder().encode(JSON.stringify(envelope.payload)).length,
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
    const size = new TextEncoder().encode(text).length;
    const absolutePath = join(this.projectRoot, relativePath);
    await Bun.write(absolutePath, JSON.stringify({ ...updated, size }, null, 2));
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

  /** List filtered artifacts with sizes read from envelope JSON (no stat). */
  async listEntries(
    gateName: string,
    options: ArtifactListOptions = {}
  ): Promise<ArtifactListEntriesResult> {
    const { sessionId, workspaceId, agentId, limit, ...pathOptions } = options;
    const sessionFilter: ArtifactSessionContext = {
      ...(sessionId ? { sessionId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(agentId ? { agentId } : {}),
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
    return { size: new TextEncoder().encode(text).length };
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
