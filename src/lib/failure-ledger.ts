/**
 * Failure ledger read/write with cluster assignment persistence.
 */

import { failureLedgerPath } from "./paths.ts";
import { safeParse } from "./utils.ts";
import { appendNdjsonRecord, writeNdjsonFile } from "./ndjson.ts";
import { deriveErrorId, readFailureTraceRecords, type FailureTraceRecord } from "./trace-ledger.ts";

export type { FailureTraceRecord };

export async function readFailureRecords(
  path: string = failureLedgerPath()
): Promise<FailureTraceRecord[]> {
  return readFailureTraceRecords(path);
}

export async function writeFailureRecords(
  records: FailureTraceRecord[],
  path: string = failureLedgerPath()
): Promise<void> {
  await writeNdjsonFile(path, records);
}

export async function appendFailureRecord(
  record: FailureTraceRecord,
  path: string = failureLedgerPath()
): Promise<FailureTraceRecord> {
  if (!record.errorId) {
    record.errorId = deriveErrorId(record, Date.now());
  }
  await appendNdjsonRecord(path, record);
  return record;
}

export function findFailureById(
  records: FailureTraceRecord[],
  errorId: string
): FailureTraceRecord | undefined {
  return records.find((record) => record.errorId === errorId);
}

export function applyClusterAssignments(
  records: FailureTraceRecord[],
  assignments: Map<string, string>,
  embeddings?: Map<string, string>
): FailureTraceRecord[] {
  return records.map((record) => {
    const errorId = record.errorId;
    if (!errorId) return record;
    const clusterId = assignments.get(errorId);
    const embedding = embeddings?.get(errorId);
    if (!clusterId && !embedding) return record;
    return {
      ...record,
      ...(clusterId ? { clusterId } : {}),
      ...(embedding ? { embedding } : {}),
    };
  });
}

export function parseLedgerLine(line: string, index: number): FailureTraceRecord | null {
  const record = safeParse<FailureTraceRecord | null>(line.trim(), null);
  if (!record) return null;
  if (!record.errorId) record.errorId = deriveErrorId(record, index);
  return record;
}
