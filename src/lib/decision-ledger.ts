/**
 * Append-only decision ledger for `kimi why`.
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { decisionLedgerPath } from "./paths.ts";
import { safeParse, sha256String } from "./utils.ts";
import { ensureProcessTrace } from "./effect/trace-context.ts";

export interface DecisionRecord {
  schemaVersion: 1;
  id: string;
  key: string;
  action: string;
  trigger: string;
  reasoning: string;
  alternatives: string[];
  outcome: string;
  timestamp: string;
  traceId?: string;
  capabilitySnapshotId?: string;
  metadata?: Record<string, unknown>;
}

export interface DecisionInput {
  key: string;
  action: string;
  trigger: string;
  reasoning: string;
  alternatives?: string[];
  outcome: string;
  traceId?: string;
  capabilitySnapshotId?: string;
  metadata?: Record<string, unknown>;
}

export interface DecisionExplanation {
  query: string;
  matches: DecisionRecord[];
  latest?: DecisionRecord;
}

export function createDecisionRecord(input: DecisionInput): DecisionRecord {
  const timestamp = new Date().toISOString();
  const trace = ensureProcessTrace();
  const body = {
    key: input.key,
    action: input.action,
    trigger: input.trigger,
    reasoning: input.reasoning,
    outcome: input.outcome,
    timestamp,
  };
  return {
    schemaVersion: 1,
    id: `decision-${sha256String(JSON.stringify(body)).slice(0, 16)}`,
    key: input.key,
    action: input.action,
    trigger: input.trigger,
    reasoning: input.reasoning,
    alternatives: input.alternatives ?? [],
    outcome: input.outcome,
    timestamp,
    traceId: input.traceId ?? trace.traceId,
    capabilitySnapshotId: input.capabilitySnapshotId,
    metadata: input.metadata,
  };
}

export function recordDecision(
  input: DecisionInput,
  path: string = decisionLedgerPath()
): DecisionRecord {
  const record = createDecisionRecord(input);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
  return record;
}

export async function readDecisionLedger(
  path: string = decisionLedgerPath()
): Promise<DecisionRecord[]> {
  if (!existsSync(path)) return [];
  const text = await Bun.file(path).text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeParse<DecisionRecord | null>(line, null))
    .filter((record): record is DecisionRecord => isDecisionRecord(record));
}

export async function explainDecision(
  query: string,
  path: string = decisionLedgerPath()
): Promise<DecisionExplanation> {
  const records = await readDecisionLedger(path);
  const needle = query.toLowerCase();
  const matches = records
    .filter((record) =>
      [record.key, record.action, record.trigger, record.reasoning, record.outcome]
        .join("\n")
        .toLowerCase()
        .includes(needle)
    )
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    query,
    matches,
    latest: matches[matches.length - 1],
  };
}

function isDecisionRecord(value: unknown): value is DecisionRecord {
  return (
    !!value &&
    typeof value === "object" &&
    (value as DecisionRecord).schemaVersion === 1 &&
    typeof (value as DecisionRecord).id === "string" &&
    typeof (value as DecisionRecord).key === "string" &&
    typeof (value as DecisionRecord).action === "string" &&
    typeof (value as DecisionRecord).trigger === "string" &&
    typeof (value as DecisionRecord).reasoning === "string" &&
    typeof (value as DecisionRecord).outcome === "string" &&
    Array.isArray((value as DecisionRecord).alternatives)
  );
}
