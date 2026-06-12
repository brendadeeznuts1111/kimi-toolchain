#!/usr/bin/env bun
/**
 * Kimi Code PostToolUseFailure hook.
 *
 * Reads the hook event JSON from stdin, classifies the failure using
 * ~/.kimi-code/error-taxonomy.yml, and appends a JSON line to
 * ~/.kimi-code/var/tool-failures.jsonl.
 *
 * Configured in ~/.kimi-code/config.toml:
 *   [[hooks]]
 *   event = "PostToolUseFailure"
 *   command = "bun run /Users/nolarose/.kimi-code/kimi-hooks/log-tool-failure.ts"
 *   timeout = 10
 */

import { existsSync, mkdirSync } from "fs";
import { join } from "path";
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

  let payload: HookPayload;
  try {
    payload = JSON.parse(text) as HookPayload;
  } catch {
    return;
  }

  const toolName = payload.tool_name || "unknown";
  const output = (payload.error || payload.tool_output || "").toString();
  if (!output) return;

  const taxonomy = await loadTaxonomy();
  const match = classifyFailure(output, taxonomy);
  const record = buildClassifiedFailure(toolName, output, match);

  const varDir = join(Bun.env.HOME || "/tmp", ".kimi-code", "var");
  if (!existsSync(varDir)) mkdirSync(varDir, { recursive: true });
  const logPath = join(varDir, "tool-failures.jsonl");

  await Bun.write(logPath, JSON.stringify(record) + "\n", { createPath: true });
}

main().catch(() => {
  // Fail-open: observation-only hook must never block tool execution.
  process.exit(0);
});
