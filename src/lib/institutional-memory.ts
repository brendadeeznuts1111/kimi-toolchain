/**
 * Append-only institutional memory ledger — durable record of toolchain actions.
 * Separate from decision-ledger.jsonl (kimi-why) and sessions.db (kimi-memory trends).
 */

import { appendText, makeDir, pathExists } from "./bun-io.ts";

import { dirname } from "path";
import { institutionalMemoryPath } from "./paths.ts";
import { ensureProcessTrace } from "./effect/trace-context.ts";
import { safeParse, sha256String } from "./utils.ts";

export const INSTITUTIONAL_MEMORY_SCHEMA_VERSION = 1;

export type MemoryActionType =
  | "heal_attempt"
  | "heal_outcome"
  | "contract_drift_heal"
  | "contract_update"
  | "hook_registration"
  | "mcp_config_change"
  | "cluster_assignment"
  | "manual_triage";

export type MemoryActor = "auto" | "manual";

export type MemoryOutcome = "success" | "failure" | "skipped" | "pending";

export interface InstitutionalMemoryRecord {
  schemaVersion: typeof INSTITUTIONAL_MEMORY_SCHEMA_VERSION;
  id: string;
  actionType: MemoryActionType;
  timestamp: string;
  traceId: string;
  parentTraceId?: string;
  childTraceIds?: string[];
  errorId?: string;
  clusterId?: string;
  clusterConfidence?: number;
  rationale: string;
  payloadSummary?: string;
  outcome: MemoryOutcome;
  actor: MemoryActor;
  metadata?: Record<string, unknown>;
}

export interface MemoryRecordInput {
  actionType: MemoryActionType;
  rationale: string;
  outcome?: MemoryOutcome;
  actor?: MemoryActor;
  traceId?: string;
  parentTraceId?: string;
  childTraceIds?: string[];
  errorId?: string;
  clusterId?: string;
  clusterConfidence?: number;
  payloadSummary?: string;
  metadata?: Record<string, unknown>;
}

function isMemoryRecord(value: unknown): value is InstitutionalMemoryRecord {
  return (
    !!value &&
    typeof value === "object" &&
    (value as InstitutionalMemoryRecord).schemaVersion === INSTITUTIONAL_MEMORY_SCHEMA_VERSION &&
    typeof (value as InstitutionalMemoryRecord).id === "string" &&
    typeof (value as InstitutionalMemoryRecord).actionType === "string" &&
    typeof (value as InstitutionalMemoryRecord).traceId === "string"
  );
}

function createRecordId(input: {
  actionType: MemoryActionType;
  traceId: string;
  timestamp: string;
  rationale: string;
}): string {
  return `mem-${sha256String(JSON.stringify(input)).slice(0, 16)}`;
}

export function buildMemoryRecord(input: MemoryRecordInput): InstitutionalMemoryRecord {
  const trace = ensureProcessTrace();
  const timestamp = new Date().toISOString();
  const traceId = input.traceId ?? trace.traceId;
  const record: InstitutionalMemoryRecord = {
    schemaVersion: INSTITUTIONAL_MEMORY_SCHEMA_VERSION,
    id: createRecordId({
      actionType: input.actionType,
      traceId,
      timestamp,
      rationale: input.rationale,
    }),
    actionType: input.actionType,
    timestamp,
    traceId,
    parentTraceId: input.parentTraceId ?? trace.parentTraceId,
    childTraceIds: input.childTraceIds,
    errorId: input.errorId,
    clusterId: input.clusterId,
    clusterConfidence: input.clusterConfidence,
    rationale: input.rationale,
    payloadSummary: input.payloadSummary,
    outcome: input.outcome ?? "pending",
    actor: input.actor ?? "auto",
    metadata: input.metadata,
  };
  return record;
}

export function appendMemoryRecord(
  input: MemoryRecordInput,
  path: string = institutionalMemoryPath()
): InstitutionalMemoryRecord {
  const record = buildMemoryRecord(input);
  makeDir(dirname(path), { recursive: true });
  appendText(path, `${JSON.stringify(record)}\n`);
  return record;
}

export async function readMemoryRecords(
  path: string = institutionalMemoryPath()
): Promise<InstitutionalMemoryRecord[]> {
  if (!pathExists(path)) return [];
  const text = await Bun.file(path).text();
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (typeof Bun.JSONL?.parse === "function") {
    try {
      const parsed = Bun.JSONL.parse(text) as unknown[];
      return parsed.filter(isMemoryRecord);
    } catch {
      // fall through to line-by-line parse
    }
  }

  return lines
    .map((line) => safeParse<InstitutionalMemoryRecord | null>(line, null))
    .filter((record): record is InstitutionalMemoryRecord => isMemoryRecord(record));
}

export function filterMemoryByTraceId(
  records: InstitutionalMemoryRecord[],
  traceId: string
): InstitutionalMemoryRecord[] {
  return records.filter(
    (record) =>
      record.traceId === traceId ||
      record.parentTraceId === traceId ||
      record.childTraceIds?.includes(traceId)
  );
}

export function filterMemoryByErrorId(
  records: InstitutionalMemoryRecord[],
  errorId: string
): InstitutionalMemoryRecord[] {
  return records.filter((record) => record.errorId === errorId);
}
