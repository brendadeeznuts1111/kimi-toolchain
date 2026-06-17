#!/usr/bin/env bun
import { pathExists, pathStat } from "../lib/bun-io.ts";
/**
 * Unified Shell Bridge — Bun-native MCP shell execution
 * Derives version from src/lib/version.ts (package.json).
 */

import { MCP_BRIDGE_VERSION } from "../lib/version.ts";
import { defaultToolTimeoutMs, invokeCommand } from "../lib/tool-runner.ts";

const DEFAULT_SHELL_MAX_OUTPUT_BYTES = 262_144;
const MAX_SHELL_TIMEOUT_MS = 120_000;
const MAX_SHELL_OUTPUT_BYTES = 1_048_576;

interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timeoutMs: number;
  maxOutputBytes: number;
  timedOut?: boolean;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  error?: string;
}

interface ExecuteContext {
  workingDir?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

function boundedPositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 1), max);
}

export async function executeCommand(
  command: string,
  context: ExecuteContext = {}
): Promise<ShellResult> {
  const cwd = context.workingDir || Bun.cwd;
  const timeoutMs = boundedPositiveInt(
    context.timeoutMs,
    defaultToolTimeoutMs(),
    MAX_SHELL_TIMEOUT_MS
  );
  const maxOutputBytes = boundedPositiveInt(
    context.maxOutputBytes,
    DEFAULT_SHELL_MAX_OUTPUT_BYTES,
    MAX_SHELL_OUTPUT_BYTES
  );

  if (context.workingDir && !pathExists(context.workingDir)) {
    return {
      stdout: "",
      stderr: "",
      exitCode: 1,
      timeoutMs,
      maxOutputBytes,
      error: `Working directory does not exist: ${context.workingDir}`,
    };
  }
  if (context.workingDir && !pathStat(context.workingDir).isDirectory()) {
    return {
      stdout: "",
      stderr: "",
      exitCode: 1,
      timeoutMs,
      maxOutputBytes,
      error: `Working directory is not a directory: ${context.workingDir}`,
    };
  }

  const result = await invokeCommand(["sh", "-c", command], {
    cwd,
    timeoutMs,
    maxOutputBytes,
    timeoutError: (ms) => `Command timed out after ${ms}ms`,
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timeoutMs: result.timeoutMs,
    maxOutputBytes: result.maxOutputBytes,
    ...(result.timedOut ? { timedOut: true } : {}),
    ...(result.stdoutTruncated ? { stdoutTruncated: true } : {}),
    ...(result.stderrTruncated ? { stderrTruncated: true } : {}),
    error: result.error,
  };
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
        timeoutMs: { type: "number" },
        maxOutputBytes: { type: "number" },
      },
      required: ["command"],
    },
  },
];

function send(msg: unknown) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function invalidParams(id: unknown, message: string) {
  send({ jsonrpc: "2.0", id, error: { code: -32602, message } });
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
        invalidParams(id, "Missing or invalid 'command' argument");
        return;
      }
      const workingDir = args.workingDir;
      if (workingDir !== undefined && typeof workingDir !== "string") {
        invalidParams(id, "Invalid 'workingDir' argument; expected string");
        return;
      }
      const timeoutMs = args.timeoutMs;
      if (timeoutMs !== undefined && typeof timeoutMs !== "number") {
        invalidParams(id, "Invalid 'timeoutMs' argument; expected number");
        return;
      }
      const maxOutputBytes = args.maxOutputBytes;
      if (maxOutputBytes !== undefined && typeof maxOutputBytes !== "number") {
        invalidParams(id, "Invalid 'maxOutputBytes' argument; expected number");
        return;
      }

      try {
        const result = await executeCommand(command, {
          workingDir,
          timeoutMs,
          maxOutputBytes,
        });
        const content: Array<{ type: "text"; text: string }> = [];
        if (result.error) {
          content.push({ type: "text", text: result.error });
        }
        if (result.stdout) content.push({ type: "text", text: result.stdout });
        if (result.stderr) content.push({ type: "text", text: `stderr: ${result.stderr}` });
        if (result.stdoutTruncated) {
          content.push({
            type: "text",
            text: `[stdout truncated at: ${result.maxOutputBytes} bytes]`,
          });
        }
        if (result.stderrTruncated) {
          content.push({
            type: "text",
            text: `[stderr truncated at: ${result.maxOutputBytes} bytes]`,
          });
        }
        if (content.length === 0) content.push({ type: "text", text: "(no output)" });
        if (result.timedOut) {
          content.push({ type: "text", text: `[timed out after: ${result.timeoutMs}ms]` });
        }
        content.push({ type: "text", text: `[exit code: ${result.exitCode}]` });
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
