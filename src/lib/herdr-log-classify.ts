/**
 * Batch classify Herdr log tails against error-taxonomy.yml.
 */

import { classifyFailure, type Taxonomy, type TaxonomyMatch } from "./error-taxonomy.ts";
import { readErrorLogTail } from "./error-log-discovery.ts";
import { herdrServerLogPath } from "./paths.ts";

export type TaxonomyHit = {
  taxonomyId: string;
  categoryName: string;
  severity: string;
  pid: number | null;
  matchedPattern?: string;
  suggestion?: string;
  autoFix?: string;
  classifiedAt: string;
  source: "herdr-server" | "herdr-client" | "blob";
};

export type ClassifyLogBlobOptions = {
  batchSize?: number;
  source?: TaxonomyHit["source"];
  classifiedAt?: string;
};

const DEFAULT_BATCH_SIZE = 50;

/** Extract the first `pid=<n>` from Herdr structured log lines. */
export function parsePidFromLogText(text: string): number | null {
  const match = text.match(/\bpid=(\d+)\b/);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isFinite(pid) && pid > 1 ? pid : null;
}

function matchToHit(
  match: TaxonomyMatch,
  context: { pid: number | null; source: TaxonomyHit["source"]; classifiedAt: string }
): TaxonomyHit | null {
  if (match.category.id === "unknown") return null;
  return {
    taxonomyId: match.category.id,
    categoryName: match.category.name,
    severity: match.category.severity,
    pid: context.pid,
    matchedPattern: match.matchedPattern,
    suggestion: match.category.suggestion || match.category.description,
    autoFix: match.category.autoFix,
    classifiedAt: context.classifiedAt,
    source: context.source,
  };
}

/** Classify batched log lines — one taxonomy category per batch blob (first match wins). */
export function classifyLogBlob(
  lines: readonly string[],
  taxonomy: Taxonomy,
  options: ClassifyLogBlobOptions = {}
): TaxonomyHit[] {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const source = options.source ?? "blob";
  const classifiedAt = options.classifiedAt ?? new Date().toISOString();
  const hits: TaxonomyHit[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i += batchSize) {
    const blob = lines.slice(i, i + batchSize).join("\n");
    if (!blob.trim()) continue;
    const match = classifyFailure(blob, taxonomy);
    const hit = matchToHit(match, {
      pid: parsePidFromLogText(blob),
      source,
      classifiedAt,
    });
    if (!hit || seen.has(hit.taxonomyId)) continue;
    seen.add(hit.taxonomyId);
    hits.push(hit);
  }

  return hits;
}

/** Tail and classify ~/.config/herdr/herdr-server.log. */
export async function classifyHerdrServerLogTail(
  taxonomy: Taxonomy,
  options: { tail?: number; home?: string } = {}
): Promise<{ lines: string[]; hits: TaxonomyHit[] }> {
  const path = herdrServerLogPath(options.home);
  const { lines } = await readErrorLogTail(path, options.tail ?? 50);
  const hits = classifyLogBlob(lines, taxonomy, { source: "herdr-server" });
  return { lines, hits };
}
