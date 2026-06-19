/**
 * MCP invocation telemetry — append-only audit log for MCP tool calls.
 *
 * Logged to ~/.kimi-code/var/mcp-invocations.ndjson
 */

import { appendNdjsonRecord } from "./ndjson.ts";
import { mcpInvocationsPath } from "./paths.ts";

export interface McpInvocationRecord {
  schemaVersion: 1;
  timestamp: string;
  server: string;
  tool: string;
  latencyMs: number;
  outcome: "success" | "error" | "blocked";
  error?: string;
  taxonomyId?: string;
  projectRoot?: string;
  profile?: string;
}

export async function recordMcpInvocation(
  record: Omit<McpInvocationRecord, "schemaVersion" | "timestamp">,
  path: string = mcpInvocationsPath()
): Promise<McpInvocationRecord> {
  const full: McpInvocationRecord = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    ...record,
  };
  await appendNdjsonRecord(path, full);
  return full;
}

export function mcpInvocationTaxonomy(outcome: McpInvocationRecord["outcome"]): string {
  if (outcome === "success") return "mcp_invocation_success";
  if (outcome === "blocked") return "mcp_invocation_blocked";
  return "mcp_invocation_error";
}
