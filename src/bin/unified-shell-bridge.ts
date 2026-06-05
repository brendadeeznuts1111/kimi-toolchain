#!/usr/bin/env bun
/**
 * Unified Shell Bridge — Bun-native MCP shell execution
 * Derives version from src/lib/version.ts (package.json).
 */

import { $ } from "bun";
import { MCP_BRIDGE_VERSION } from "../lib/version.ts";

interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function executeCommand(
  command: string,
  context: { workingDir?: string } = {}
): Promise<ShellResult> {
  const result = await $`${{ raw: command }}`.cwd(context.workingDir || process.cwd()).nothrow();
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
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
        send({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: result.stdout || result.stderr || "(no output)" }],
            isError: result.exitCode !== 0,
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

// ─── Main entry point ───────────────────────────────────────────────────────

if (import.meta.main) {
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGHUP", () => process.exit(0));

  const decoder = new TextDecoder();
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
