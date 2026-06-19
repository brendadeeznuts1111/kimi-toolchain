import { hostname } from "node:os";
import { join } from "path";
import { listDir, makeDir, pathExists, removePath } from "./bun-io.ts";
import { projectKimiDir } from "./paths.ts";
import { safeParse } from "./utils.ts";

export const ARTIFACT_SCHEMA_VERSION = 1;
export const DEFAULT_ARTIFACT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ArtifactRecord {
  path: string;
  relativePath: string;
  payload: unknown;
}

export interface ArtifactMetadata {
  hostname: string;
  pid: number;
  bunVersion: string;
  /** Byte length of serialized `payload` (not the full envelope). */
  resultSize: number;
  [key: string]: unknown;
}

export interface ArtifactEnvelope {
  schemaVersion: typeof ARTIFACT_SCHEMA_VERSION;
  gate: string;
  savedAt: string;
  size: number;
  metadata?: ArtifactMetadata;
  payload: unknown;
}

export interface ArtifactListEntry {
  path: string;
  timestamp: string | null;
  size?: number;
  resultSize?: number;
}

export interface ArtifactListEntriesResult extends ArtifactListResult {
  entries: ArtifactListEntry[];
}

export interface PruneOptions {
  maxAgeMs?: number;
  dryRun?: boolean;
}

export interface PruneResult {
  removed: number;
  files: string[];
}

export interface ArtifactListOptions {
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
  /** Maximum age in ms (default 7 days). */
  maxAgeMs?: number;
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

export function parseArtifactListQuery(searchParams: URLSearchParams): ArtifactListOptions {
  const options: ArtifactListOptions = {};
  const since = searchParams.get("since");
  if (since) options.since = since;

  const limitRaw = searchParams.get("limit");
  if (limitRaw !== null && limitRaw !== "") {
    const limit = Number(limitRaw);
    if (Number.isFinite(limit) && limit > 0) options.limit = Math.floor(limit);
  }

  return options;
}

/** Persist gate run results under `{projectRoot}/.kimi/artifacts/{gateName}/`. */
export class ArtifactStore {
  constructor(private readonly projectRoot: string = process.cwd()) {}

  private rootArtifactsDir(): string {
    return join(projectKimiDir(this.projectRoot), "artifacts");
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
  async save(gateName: string, payload: unknown, meta?: Record<string, unknown>): Promise<string> {
    const dir = this.artifactsDir(gateName);
    makeDir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = join(dir, `${stamp}.json`);
    const savedAt = new Date().toISOString();
    const resultSize = new TextEncoder().encode(JSON.stringify(payload)).length;
    const metadata: ArtifactMetadata = {
      ...meta,
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
    const filtered = await this.listFiltered(gateName, options);
    const entries: ArtifactListEntry[] = [];
    for (const filePath of filtered.files) {
      entries.push({
        path: filePath,
        timestamp: extractArtifactTimestamp(filePath),
        ...(await this.readEnvelopeSummary(filePath)),
      });
    }
    return { ...filtered, entries };
  }

  private async readEnvelopeSummary(
    relativePath: string
  ): Promise<Pick<ArtifactListEntry, "size" | "resultSize">> {
    const absolutePath = absoluteArtifactPath(this.projectRoot, relativePath);
    if (!pathExists(absolutePath)) return {};
    const text = await Bun.file(absolutePath).text();
    const parsed = safeParse(text, null);
    if (
      parsed &&
      typeof parsed === "object" &&
      "schemaVersion" in parsed &&
      (parsed as ArtifactEnvelope).schemaVersion === ARTIFACT_SCHEMA_VERSION
    ) {
      const envelope = parsed as ArtifactEnvelope;
      return {
        size: typeof envelope.size === "number" ? envelope.size : undefined,
        resultSize:
          typeof envelope.metadata?.resultSize === "number"
            ? envelope.metadata.resultSize
            : undefined,
      };
    }
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

  /** Remove artifacts older than `maxAgeMs` (default 7 days). */
  async prune(gateName: string, opts: PruneOptions = {}): Promise<PruneResult> {
    const maxAgeMs = opts.maxAgeMs ?? DEFAULT_ARTIFACT_MAX_AGE_MS;
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

  /** Path relative to project root for CLI display. */
  relativePath(absolutePath: string): string {
    const root = this.projectRoot.endsWith("/") ? this.projectRoot : `${this.projectRoot}/`;
    if (absolutePath.startsWith(root)) {
      return absolutePath.slice(root.length);
    }
    return absolutePath;
  }
}
