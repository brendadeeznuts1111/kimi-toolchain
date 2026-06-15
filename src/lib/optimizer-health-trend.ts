/**
 * Append-only optimizer health trend ledger (.kimi/var/optimizer-health.ndjson).
 */

import { existsSync } from "fs";
import { appendNdjsonRecord, readNdjsonFile } from "./ndjson.ts";
import { optimizerHealthTrendPath } from "./paths.ts";
import { getProjectName } from "./utils.ts";
import type { OptimizerDoctorMachineCheck } from "./constant-optimizer.ts";

export const OPTIMIZER_HEALTH_TREND_SCHEMA_VERSION = 1;
const MAX_TREND_RECORDS = 500;
const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

export interface OptimizerHealthTrendRecord {
  schemaVersion: typeof OPTIMIZER_HEALTH_TREND_SCHEMA_VERSION;
  timestamp: string;
  project: string;
  windowMs: number;
  summary: {
    entries: number;
    warnCount: number;
    errorCount: number;
  };
  checks: OptimizerDoctorMachineCheck[];
}

function isTrendRecord(value: unknown): value is OptimizerHealthTrendRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === OPTIMIZER_HEALTH_TREND_SCHEMA_VERSION &&
    typeof record.timestamp === "string" &&
    typeof record.project === "string" &&
    Array.isArray(record.checks)
  );
}

function summarizeChecks(
  checks: OptimizerDoctorMachineCheck[]
): OptimizerHealthTrendRecord["summary"] {
  const actionable = checks.filter((check) => check.constant !== "summary");
  return {
    entries: actionable.length,
    warnCount: actionable.filter((check) => check.status === "warn").length,
    errorCount: actionable.filter((check) => check.status === "error").length,
  };
}

function checksFingerprint(checks: OptimizerDoctorMachineCheck[]): string {
  return JSON.stringify(
    checks.map((check) => ({
      constant: check.constant,
      status: check.status,
      confidence: check.confidence,
      driftPercent: check.driftPercent,
    }))
  );
}

async function shouldSkipAppend(
  path: string,
  checks: OptimizerDoctorMachineCheck[],
  nowMs: number
): Promise<boolean> {
  const onlySummary =
    checks.length === 1 && checks[0]?.constant === "summary" && checks[0]?.status === "ok";
  if (onlySummary) return true;

  const records = await readNdjsonFile<OptimizerHealthTrendRecord>(path, isTrendRecord);
  const last = records.at(-1);
  if (!last) return false;

  const lastMs = Date.parse(last.timestamp);
  if (!Number.isFinite(lastMs) || nowMs - lastMs >= DEDUPE_WINDOW_MS) return false;

  return checksFingerprint(last.checks) === checksFingerprint(checks);
}

async function pruneTrendFile(path: string): Promise<void> {
  const records = await readNdjsonFile<OptimizerHealthTrendRecord>(path, isTrendRecord);
  if (records.length <= MAX_TREND_RECORDS) return;
  const trimmed = records.slice(-MAX_TREND_RECORDS);
  await Bun.write(path, `${trimmed.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

export async function appendOptimizerHealthTrend(
  projectRoot: string,
  checks: OptimizerDoctorMachineCheck[],
  options: { windowMs?: number; nowMs?: number } = {}
): Promise<OptimizerHealthTrendRecord | null> {
  const path = optimizerHealthTrendPath(projectRoot);
  const nowMs = options.nowMs ?? Date.now();
  if (await shouldSkipAppend(path, checks, nowMs)) return null;

  const record: OptimizerHealthTrendRecord = {
    schemaVersion: OPTIMIZER_HEALTH_TREND_SCHEMA_VERSION,
    timestamp: new Date(nowMs).toISOString(),
    project: await getProjectName(projectRoot),
    windowMs: options.windowMs ?? 0,
    summary: summarizeChecks(checks),
    checks,
  };

  await appendNdjsonRecord(path, record);
  if (existsSync(path)) await pruneTrendFile(path);
  return record;
}

export async function readOptimizerHealthTrend(
  projectRoot: string
): Promise<OptimizerHealthTrendRecord[]> {
  return readNdjsonFile(optimizerHealthTrendPath(projectRoot), isTrendRecord);
}
