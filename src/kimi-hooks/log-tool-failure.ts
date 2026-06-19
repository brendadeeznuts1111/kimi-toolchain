#!/usr/bin/env bun
/**
 * Kimi Code PostToolUseFailure hook.
 *
 * Reads the hook event JSON from stdin, classifies the failure using
 * ~/.kimi-code/error-taxonomy.yml, and appends a JSON line to
 * ~/.kimi-code/var/tool-failures.jsonl.
 */

import { existsSync, mkdirSync } from "fs";
import { safeParse } from "../lib/utils.ts";
import {
  buildClassifiedFailure,
  classifyFailure,
  formatFailureOutput,
  loadTaxonomy,
} from "../lib/error-taxonomy.ts";
import { failureLedgerPath } from "../lib/paths.ts";
import {
  PARENT_TRACE_ID_ENV,
  TRACE_ID_ENV,
  TRACE_STARTED_AT_ENV,
} from "../lib/effect/trace-context.ts";
import { buildTraceEvent, recordTraceEvent } from "../lib/trace-ledger.ts";
import { appendFailureRecord } from "../lib/failure-ledger.ts";
import { embedFailure, encodeEmbedding } from "../lib/error-embedding.ts";
import { readTraceEvents } from "../lib/trace-ledger.ts";

interface HookPayload {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: unknown;
  error?: unknown;
}

async function main() {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(chunk);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  const text = new TextDecoder().decode(combined).trim();
  if (!text) return;

  const payload = safeParse(text, null as HookPayload | null);
  if (!payload) return;

  const toolName = payload.tool_name || "unknown";
  const output = formatFailureOutput(payload.error, payload.tool_output);
  if (!output) return;

  const sessionId =
    payload.session_id || Bun.env.KIMI_CODE_SESSION || Bun.env.KIMI_AGENT_SESSION || undefined;
  const traceId = Bun.env[TRACE_ID_ENV];
  const parentTraceId = Bun.env[PARENT_TRACE_ID_ENV];

  const taxonomy = await loadTaxonomy();
  const match = classifyFailure(output, taxonomy);
  const record = buildClassifiedFailure(toolName, output, match, {
    sessionId,
    traceId,
    parentTraceId,
    childTraceIds: [],
    context: {
      inputs: payload.tool_input,
      environment: payload.cwd ? { cwd: payload.cwd } : {},
    },
  });

  const traces = await readTraceEvents();
  const { vector } = embedFailure(record, traces);
  record.embedding = encodeEmbedding(vector);

  const logPath = failureLedgerPath();
  const varDir = logPath.slice(0, logPath.lastIndexOf("/"));
  if (!existsSync(varDir)) mkdirSync(varDir, { recursive: true });

  await appendFailureRecord(record, logPath);

  if (traceId) {
    const startedAt = Bun.env[TRACE_STARTED_AT_ENV] || record.timestamp;
    await recordTraceEvent(
      buildTraceEvent({
        traceId,
        parentTraceId,
        childTraceIds: [],
        eventType: "hook",
        tool: toolName,
        status: "error",
        startedAt,
        endedAt: record.timestamp,
        durationMs: Math.max(0, Date.parse(record.timestamp) - Date.parse(startedAt)),
        error: output.slice(0, 500),
        metadata: {
          taxonomyId: record.taxonomyId,
          hookEventName: payload.hook_event_name,
          errorId: record.errorId,
        },
      })
    );
  }
}

main().catch(() => {
  process.exit(0);
});
