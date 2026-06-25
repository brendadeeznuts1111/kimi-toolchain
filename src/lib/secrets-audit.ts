/**
 * secrets-audit.ts — NDJSON audit trail for all Bun.secrets access.
 *
 * Uses the existing ndjson.ts helpers (appendNdjsonRecord / readNdjsonFile)
 * for consistent append/read behavior across the toolchain.
 */

import { appendNdjsonRecord, readNdjsonFile } from "./ndjson.ts";
import type { SecretAuditRecord, AuditQuery } from "./secrets-types.ts";

function isSecretAuditRecord(value: unknown): value is SecretAuditRecord {
  const record = value as Record<string, unknown>;
  return (
    !!record &&
    typeof record.timestamp === "string" &&
    typeof record.action === "string" &&
    typeof record.service === "string" &&
    typeof record.name === "string" &&
    typeof record.consumer === "string" &&
    typeof record.success === "boolean"
  );
}

export async function appendSecretAudit(
  auditPath: string,
  record: SecretAuditRecord
): Promise<void> {
  await appendNdjsonRecord(auditPath, record);
}

export async function readSecretAudit(auditPath: string): Promise<SecretAuditRecord[]> {
  const records = await readNdjsonFile<SecretAuditRecord>(auditPath);
  return records.filter(isSecretAuditRecord);
}

export function filterSecretAudit(
  records: SecretAuditRecord[],
  query: AuditQuery
): SecretAuditRecord[] {
  return records.filter((record) => {
    if (query.since && record.timestamp < query.since) return false;
    if (query.consumer && record.consumer !== query.consumer) return false;
    if (query.service && record.service !== query.service) return false;
    if (query.name && record.name !== query.name) return false;
    if (query.action && record.action !== query.action) return false;
    return true;
  });
}

export async function querySecretAudit(
  auditPath: string,
  query: AuditQuery
): Promise<SecretAuditRecord[]> {
  const records = await readSecretAudit(auditPath);
  return filterSecretAudit(records, query);
}
