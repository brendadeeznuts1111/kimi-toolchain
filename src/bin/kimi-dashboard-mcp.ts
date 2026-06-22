#!/usr/bin/env bun
/**
 * kimi-dashboard-mcp — Read-only MCP server for project dashboard data.
 *
 * Exposes a small, focused toolset:
 *   - project_status         Overall ok/warn/error summary
 *   - health_snapshot        Latest kimi-doctor health snapshot
 *   - effect_gates           Latest effect-gates report
 *   - doctor_runs            Recent doctor run records
 *   - debug_logs             Tail of discovered debug/error logs
 *
 * Env:
 *   KIMI_PROJECT_ROOT        Project root (defaults to git top-level or cwd)
 */

import { isDirectRun } from "../lib/bun-utils.ts";
import { writeStdoutNdjsonLineSync } from "../lib/ndjson.ts";
import { resolveProjectRoot } from "../lib/utils.ts";
import { readHealthSnapshots } from "../lib/predictive-doctor.ts";
import { readEffectGatesSnapshots } from "../lib/effect-gates.ts";
import { getDoctorRunsByProject } from "../lib/doctor-runs.ts";
import {
  discoverDashboardLogSinks,
  readErrorLogTail,
  type ErrorLogSinkStatus,
} from "../lib/error-log-discovery.ts";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
  };
}

const TOOLS: ToolDefinition[] = [
  {
    name: "project_status",
    description: "Overall project health status from dashboard data files",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "health_snapshot",
    description: "Latest kimi-doctor health snapshot",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "effect_gates",
    description: "Latest effect-gates discipline report",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "doctor_runs",
    description: "Recent doctor run records",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Max records (default 10)" } },
    },
  },
  {
    name: "debug_logs",
    description: "Tail of discovered debug/error logs",
    inputSchema: {
      type: "object",
      properties: {
        sink: { type: "string", description: "Sink id (optional, defaults to all p1 sinks)" },
        tail: { type: "number", description: "Lines per sink (default 20)" },
      },
    },
  },
];

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  const envRoot = Bun.env.KIMI_PROJECT_ROOT;
  const projectRoot = envRoot || (await resolveProjectRoot(Bun.cwd));

  if (name === "project_status") {
    const [health, gates] = await Promise.all([
      readHealthSnapshots(projectRoot, { limit: 1 }),
      readEffectGatesSnapshots(projectRoot, 1),
    ]);
    const latest = health[0];
    const gate = gates[0];
    return {
      projectRoot,
      ok: latest ? latest.score >= 0.8 : null,
      score: latest?.score ?? null,
      healthChecks: latest?.checks.length ?? 0,
      healthErrors: latest?.checks.filter((c) => c.status === "error").length ?? 0,
      healthWarnings: latest?.checks.filter((c) => c.status === "warn").length ?? 0,
      effectGatesFailed: gate ? gate.summary?.errors > 0 : null,
      timestamp: latest?.timestamp ?? null,
    };
  }

  if (name === "health_snapshot") {
    const snapshots = await readHealthSnapshots(projectRoot, { limit: 1 });
    return snapshots[0] ?? { ok: false, error: "no health snapshots found" };
  }

  if (name === "effect_gates") {
    const snapshots = await readEffectGatesSnapshots(projectRoot, 1);
    return snapshots[0] ?? { ok: false, error: "no effect-gates snapshots found" };
  }

  if (name === "doctor_runs") {
    const projectName = projectRoot.split("/").pop() ?? "unknown";
    const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : 10;
    const runs = getDoctorRunsByProject(projectName);
    return { project: projectName, count: runs.length, runs: runs.slice(0, limit) };
  }

  if (name === "debug_logs") {
    const tail = typeof args.tail === "number" && args.tail > 0 ? args.tail : 20;
    const sinks = discoverDashboardLogSinks(projectRoot);
    const targetSink = typeof args.sink === "string" ? args.sink : undefined;
    const selected = targetSink
      ? sinks.filter((s) => s.id === targetSink)
      : sinks.filter((s) => !s.present).slice(0, 3);
    const logs = await Promise.all(
      selected.map(async (sink: ErrorLogSinkStatus) => ({
        id: sink.id,
        path: sink.path,
        lines: await readErrorLogTail(sink.path, tail),
      }))
    );
    return { projectRoot, sinks: selected.map((s) => s.id), logs };
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handleRequest(request: JsonRpcRequest): Promise<unknown> {
  if (request.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "kimi-dashboard-mcp", version: "0.1.0" },
    };
  }
  if (request.method === "notifications/initialized") {
    return null;
  }
  if (request.method === "tools/list") {
    return { tools: TOOLS };
  }
  if (request.method === "tools/call") {
    const params = (request.params ?? {}) as Record<string, unknown>;
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const result = await handleToolCall(name, args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
  throw new Error(`Method not found: ${request.method}`);
}

async function main(): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const request = JSON.parse(line) as JsonRpcRequest;
        const result = await handleRequest(request);
        if (request.id !== undefined) {
          writeStdoutNdjsonLineSync({ jsonrpc: "2.0", id: request.id, result });
        }
      } catch (e) {
        writeStdoutNdjsonLineSync({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
        });
      }
    }
  }
}

if (isDirectRun(import.meta.path)) {
  void main();
}
