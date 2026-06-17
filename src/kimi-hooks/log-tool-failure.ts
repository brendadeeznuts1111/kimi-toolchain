#!/usr/bin/env bun
import { appendText, makeDir, pathExists } from "../lib/bun-io.ts";
/**
 * Kimi Code PostToolUseFailure hook.
 *
 * Reads the hook event JSON from stdin, classifies the failure using
 * ~/.kimi-code/error-taxonomy.yml, and appends a JSON line to
 * ~/.kimi-code/var/tool-failures.jsonl.
 */

import { Effect } from "effect";
import { safeParse } from "../lib/utils.ts";
import { buildClassifiedFailure, classifyFailure, loadTaxonomy } from "../lib/error-taxonomy.ts";
import { extractHookFailureText, type HookFailurePayload } from "../lib/hook-failure-text.ts";
import { failureLedgerPath, varDir } from "../lib/paths.ts";

interface HookPayload extends HookFailurePayload {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
}

async function main(): Promise<void> {
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

  const payload = safeParse<HookPayload | null>(text, null);
  if (!payload) return;

  const toolName = payload.tool_name || "unknown";
  const output = extractHookFailureText(payload);
  if (!output) return;

  const sessionId =
    payload.session_id || Bun.env.KIMI_CODE_SESSION || Bun.env.KIMI_AGENT_SESSION || undefined;

  const taxonomy = await loadTaxonomy();
  const match = classifyFailure(output, taxonomy);
  const record = buildClassifiedFailure(toolName, output, match, { sessionId });

  const varRoot = varDir();
  if (!pathExists(varRoot)) makeDir(varRoot, { recursive: true });
  const logPath = failureLedgerPath();

  appendText(logPath, JSON.stringify(record) + "\n");
}

(async () => {
  try {
    await Effect.runPromise(
      Effect.tryPromise({
        try: () => main(),
        catch: () => "hook-failed" as const,
      })
    );
  } catch {
    // Silent fail — hook recording is best-effort.
  }
  process.exit(0);
})();
