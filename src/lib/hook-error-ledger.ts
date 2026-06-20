/**
 * Hook-internal error ledger.
 *
 * When a Kimi Code lifecycle hook (e.g. PostToolUseFailure) fails, the failure
 * must itself be observable. This module appends those meta-errors to
 * ~/.kimi-code/var/hook-errors.jsonl so they are not silently swallowed.
 */

import { appendNdjsonRecord } from "./ndjson.ts";
import { hookErrorsPath } from "./paths.ts";

export interface HookErrorRecord {
  schemaVersion: number;
  tool: "log-tool-failure";
  level: "error";
  message: string;
  stack?: string;
  timestamp: string;
  sessionId?: string;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return String(err);
  } catch {
    return "unknown hook error";
  }
}

function errorStack(err: unknown): string | undefined {
  if (err instanceof Error && err.stack) return err.stack;
  return undefined;
}

function sessionId(): string | undefined {
  return Bun.env.KIMI_CODE_SESSION || Bun.env.KIMI_AGENT_SESSION || undefined;
}

/** Append a hook-internal error record to the hook-errors ledger. */
export async function appendHookError(
  err: unknown,
  options: { path?: string } = {}
): Promise<HookErrorRecord> {
  const record: HookErrorRecord = {
    schemaVersion: 1,
    tool: "log-tool-failure",
    level: "error",
    message: errorMessage(err),
    stack: errorStack(err),
    timestamp: new Date().toISOString(),
    sessionId: sessionId(),
  };
  await appendNdjsonRecord(options.path ?? hookErrorsPath(), record);
  return record;
}
