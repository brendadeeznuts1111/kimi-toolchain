/**
 * Correlate pane.agent_status_changed with classified Herdr log taxonomy hits.
 * Read-only v1 — records dedupe state and correlation payload; no webhooks.
 */

import { pathExists, readText } from "./bun-io.ts";
import { appendNdjsonRecordSync } from "./ndjson.ts";
import { loadTaxonomy } from "./error-taxonomy.ts";
import {
  alertBucketKey,
  alertHourBucket,
  markAlertEmitted,
  shouldSuppressAlert,
  type AlertDedupeHit,
} from "./herdr-alert-dedupe.ts";
import { classifyHerdrServerLogTail, type TaxonomyHit } from "./herdr-log-classify.ts";
import { herdrAlertDedupeLedgerPath, herdrTaxonomyHitsLedgerPath } from "./paths.ts";
import { safeParse } from "./utils.ts";

export type CorrelatedTaxonomyHit = TaxonomyHit & {
  dedupeBucket: string;
  alertEligible: boolean;
};

export type AgentStatusCorrelation = {
  schemaVersion: 1;
  paneId?: string;
  agentStatus?: string;
  workspaceId?: string;
  hits: CorrelatedTaxonomyHit[];
  ingestedAt: string;
};

type DedupeLedgerRow = {
  bucketKey: string;
  taxonomyId: string;
  pid: number | null;
  emittedAtMs: number;
};

type TaxonomyHitsLedgerRow = TaxonomyHit;

export function loadAlertDedupeState(
  path: string = herdrAlertDedupeLedgerPath()
): Map<string, number> {
  const map = new Map<string, number>();
  if (!pathExists(path)) return map;
  for (const line of readText(path).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = safeParse<DedupeLedgerRow | null>(trimmed, null, (v): v is DedupeLedgerRow => {
      if (!v || typeof v !== "object") return false;
      const r = v as DedupeLedgerRow;
      return typeof r.bucketKey === "string" && typeof r.emittedAtMs === "number";
    });
    if (!row) continue;
    map.set(row.bucketKey, row.emittedAtMs);
  }
  return map;
}

export function appendDedupeLedgerRow(
  row: DedupeLedgerRow,
  path: string = herdrAlertDedupeLedgerPath()
): void {
  appendNdjsonRecordSync(path, row);
}

export function appendTaxonomyHitRow(
  hit: TaxonomyHit,
  path: string = herdrTaxonomyHitsLedgerPath()
): void {
  appendNdjsonRecordSync(path, hit);
}

export function loadRecentTaxonomyHits(
  sinceMs: number,
  path: string = herdrTaxonomyHitsLedgerPath()
): TaxonomyHit[] {
  if (!pathExists(path)) return [];
  const hits: TaxonomyHit[] = [];
  for (const line of readText(path).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = safeParse<TaxonomyHitsLedgerRow | null>(
      trimmed,
      null,
      (v): v is TaxonomyHitsLedgerRow => {
        if (!v || typeof v !== "object") return false;
        const r = v as TaxonomyHitsLedgerRow;
        return typeof r.taxonomyId === "string" && typeof r.classifiedAt === "string";
      }
    );
    if (!row) continue;
    const at = Date.parse(row.classifiedAt);
    if (!Number.isFinite(at) || at < sinceMs) continue;
    hits.push(row);
  }
  return hits;
}

function mergeHitsByTaxonomy(fresh: TaxonomyHit[], recent: TaxonomyHit[]): TaxonomyHit[] {
  const byId = new Map<string, TaxonomyHit>();
  for (const hit of [...recent, ...fresh]) {
    byId.set(hit.taxonomyId, hit);
  }
  return [...byId.values()];
}

export function applyAlertDedupe(
  hits: readonly TaxonomyHit[],
  lastEmitByBucket: Map<string, number>,
  nowMs = Date.now(),
  recordEmits = false
): CorrelatedTaxonomyHit[] {
  const hour = alertHourBucket(nowMs);
  return hits.map((hit) => {
    const dedupeHit: AlertDedupeHit = { taxonomyId: hit.taxonomyId, pid: hit.pid };
    const dedupeBucket = alertBucketKey(hit.taxonomyId, hit.pid, hour);
    const suppressed = shouldSuppressAlert(dedupeHit, lastEmitByBucket, nowMs);
    const alertEligible = !suppressed;
    if (alertEligible && recordEmits) {
      const key = markAlertEmitted(dedupeHit, lastEmitByBucket, nowMs);
      appendDedupeLedgerRow({
        bucketKey: key,
        taxonomyId: hit.taxonomyId,
        pid: hit.pid,
        emittedAtMs: nowMs,
      });
    }
    return { ...hit, dedupeBucket, alertEligible };
  });
}

export type CorrelateAgentStatusOptions = {
  tail?: number;
  lookbackMs?: number;
  home?: string;
  nowMs?: number;
  dedupeState?: Map<string, number>;
  /** When true, writes dedupe ledger rows for alert-eligible hits (webhook path). */
  recordEmits?: boolean;
  taxonomyPath?: string;
};

/** Ingest herdr-server log tail, merge recent hits, apply dedupe — read-only correlation. */
export async function correlateAgentStatusChanged(
  envelopeData: Record<string, unknown>,
  options: CorrelateAgentStatusOptions = {}
): Promise<AgentStatusCorrelation> {
  const nowMs = options.nowMs ?? Date.now();
  const lookbackMs = options.lookbackMs ?? 60 * 60 * 1000;
  const taxonomy = await loadTaxonomy(options.taxonomyPath);
  const { hits: fresh } = await classifyHerdrServerLogTail(taxonomy, {
    tail: options.tail ?? 50,
    home: options.home,
  });

  for (const hit of fresh) {
    appendTaxonomyHitRow(hit);
  }

  const recent = loadRecentTaxonomyHits(nowMs - lookbackMs);
  const merged = mergeHitsByTaxonomy(fresh, recent);
  const dedupeState = options.dedupeState ?? loadAlertDedupeState();
  const correlated = applyAlertDedupe(merged, dedupeState, nowMs, options.recordEmits ?? false);

  const paneId = typeof envelopeData.pane_id === "string" ? envelopeData.pane_id : undefined;
  const agentStatus =
    typeof envelopeData.agent_status === "string"
      ? envelopeData.agent_status
      : typeof envelopeData.custom_status === "string"
        ? envelopeData.custom_status
        : undefined;
  const workspaceId =
    typeof envelopeData.workspace_id === "string" ? envelopeData.workspace_id : undefined;

  return {
    schemaVersion: 1,
    paneId,
    agentStatus,
    workspaceId,
    hits: correlated,
    ingestedAt: new Date(nowMs).toISOString(),
  };
}
