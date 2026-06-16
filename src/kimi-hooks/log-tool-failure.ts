#!/usr/bin/env bun
/**
 * Kimi Code PostToolUseFailure hook.
 *
 * Reads the hook event JSON from stdin, classifies the failure using
 * ~/.kimi-code/error-taxonomy.yml, and appends a JSON line to
 * ~/.kimi-code/var/tool-failures.jsonl.
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { Effect } from "effect";
import { safeParse } from "../lib/utils.ts";
import { buildClassifiedFailure, classifyFailure, loadTaxonomy } from "../lib/error-taxonomy.ts";

interface HookPayload {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: string;
  error?: string;
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
  const error = payload.error;
  if (!error) return;
  const output = error.toString();
  if (!output) return;

  const sessionId =
    payload.session_id || Bun.env.KIMI_CODE_SESSION || Bun.env.KIMI_AGENT_SESSION || undefined;

  const taxonomy = await loadTaxonomy();
  const match = classifyFailure(output, taxonomy);
  const record = buildClassifiedFailure(toolName, output, match, { sessionId });

  const varDir = join(Bun.env.HOME || "/tmp", ".kimi-code", "var");
  if (!existsSync(varDir)) mkdirSync(varDir, { recursive: true });
  const logPath = join(varDir, "tool-failures.jsonl");

  appendFileSync(logPath, JSON.stringify(record) + "\n");
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
