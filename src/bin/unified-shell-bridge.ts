#!/usr/bin/env bun
/**
 * Unified Shell Bridge — Bun-native MCP shell execution
 * Derives version from src/lib/version.ts (package.json).
 */

import { existsSync } from "fs";
import { MCP_BRIDGE_VERSION } from "../lib/version.ts";
import { childTraceEnv, ensureProcessTrace, TRACE_ID_ENV } from "../lib/effect/trace-context.ts";
import { buildTraceEvent, recordTraceEvent } from "../lib/trace-ledger.ts";

interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

export async function executeCommand(
  command: string,
  context: { workingDir?: string } = {}
): Promise<ShellResult> {
  const cwd = context.workingDir || Bun.cwd;
  if (context.workingDir && !existsSync(context.workingDir)) {
    return {
      stdout: "",
      stderr: "",
      exitCode: 1,
      error: `Working directory does not exist: ${context.workingDir}`,
    };
  }

  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const parentTraceId = Bun.env[TRACE_ID_ENV] || ensureProcessTrace().traceId;
  const traceOverlay = childTraceEnv(parentTraceId);
  const proc = Bun.spawn(["sh", "-c", command], {
    cwd,
    env: { ...Bun.env, ...traceOverlay },
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  const stdout = await Bun.readableStreamToText(proc.stdout);
  const stderr = await Bun.readableStreamToText(proc.stderr);
  try {
    await recordTraceEvent(
      buildTraceEvent({
        traceId: parentTraceId,
        childTraceIds: [traceOverlay.KIMI_TRACE_ID],
        eventType: "mcp",
        tool: "unified-shell",
        command: ["sh", "-c", command],
        cwd,
        status: exitCode === 0 ? "ok" : "error",
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        ...(exitCode === 0 ? {} : { error: stderr.trim() || `exit ${exitCode}` }),
      })
    );
  } catch {
    // MCP command tracing must not affect shell execution.
  }
  return { stdout, stderr, exitCode };
}

// ─── MCP stdio server ───────────────────────────────────────────────────────

const SERVER_NAME = "unified-shell";
const SERVER_VERSION = MCP_BRIDGE_VERSION;

const TOOLS = [
  {
    name: "execute",
    description: "Execute shell commands via Bun.$",
    inputSchema: {
      type: "object" as const,
      properties: {
        command: { type: "string" },
        workingDir: { type: "string" },
      },
      required: ["command"],
    },
  },
];

function send(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handleRequest(req: any) {
  const { id, method, params } = req;

  switch (method) {
    case "initialize": {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      });
      break;
    }

    case "initialized":
      // notification — no response
      break;

    case "tools/list": {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      break;
    }

    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};

      if (name !== "execute") {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Tool not found: ${name}` } });
        return;
      }

      const command = args.command;
      if (typeof command !== "string" || !command) {
        send({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "Missing or invalid 'command' argument" },
        });
        return;
      }

      try {
        const result = await executeCommand(command, { workingDir: args.workingDir });
        const content: Array<{ type: "text"; text: string }> = [];
        if (result.error) {
          content.push({ type: "text", text: result.error });
        } else {
          if (result.stdout) content.push({ type: "text", text: result.stdout });
          if (result.stderr) content.push({ type: "text", text: `stderr: ${result.stderr}` });
          if (content.length === 0) content.push({ type: "text", text: "(no output)" });
          content.push({ type: "text", text: `[exit code: ${result.exitCode}]` });
        }
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content,
            isError: result.exitCode !== 0 || !!result.error,
          },
        });
      } catch (err: any) {
        send({ jsonrpc: "2.0", id, error: { code: -32603, message: err.message || String(err) } });
      }
      break;
    }

    default:
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

const decoder = new TextDecoder();

// ─── Main entry point ───────────────────────────────────────────────────────

if (import.meta.main) {
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGHUP", () => process.exit(0));

  let buffer = "";

  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const req = JSON.parse(trimmed);
        await handleRequest(req);
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      }
    }
  }
}
