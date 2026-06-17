/**
 * doctor-mcp-server.ts — MCP stdio server that exposes kimi-doctor to other agents.
 *
 * Started by `kimi-doctor --mcp-server`. Tools reuse the same JSON envelope that
 * the CLI emits, so any MCP client gets a stable, versioned contract.
 */

import { Effect, Exit } from "effect";
import { resolve } from "path";
import { buildDoctorProbeManifest } from "./doctor-probe.ts";
import { ToolTimeout, ExitNonZero, ToolNotFound } from "./effect/errors.ts";
import { invokeCommandEffect } from "./effect/tool-runner-effect.ts";
import { inspectAgent } from "./inspect.ts";
import type { ToolInvocation } from "./tool-runner.ts";

const SERVER_NAME = "kimi-doctor";
let SERVER_VERSION = "0.0.0";
try {
  SERVER_VERSION = (await buildDoctorProbeManifest()).version;
} catch {
  // Probe manifest is best-effort; fall back to a static version.
}

const SCRIPT_PATH = resolve(import.meta.dir, "..", "bin", "kimi-doctor.ts");

const TOOLS = [
  {
    name: "kimi_doctor_probe",
    description: "Return the kimi-doctor capability manifest",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "kimi_doctor_run",
    description: "Run a kimi-doctor mode and return structured checks",
    inputSchema: {
      type: "object" as const,
      properties: {
        mode: { type: "string", description: "Mode flag without leading --, e.g. agent-ready" },
        projectRoot: { type: "string" },
        quick: { type: "boolean" },
      },
      required: ["mode"],
    },
  },
  {
    name: "kimi_doctor_fix",
    description: "Run kimi-doctor --fix for a specific mode",
    inputSchema: {
      type: "object" as const,
      properties: {
        mode: { type: "string", description: "Mode flag without leading --, e.g. workspace" },
        projectRoot: { type: "string" },
      },
      required: ["mode"],
    },
  },
  {
    name: "kimi_doctor_run_all",
    description: "Run every adapter, plugin, and effect-gates check",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string" },
      },
    },
  },
];

function send(msg: unknown) {
  process.stdout.write(`${inspectAgent(msg)}\n`);
}

function invalidParams(id: unknown, message: string) {
  send({ jsonrpc: "2.0", id, error: { code: -32602, message } });
}

function internalError(id: unknown, message: string) {
  send({
    jsonrpc: "2.0",
    id,
    error: { code: -32603, message: `doctor_mcp_internal: ${message}` },
  });
}

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) yield line;
      }
    }
    if (buffer.trim()) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

function runnerFailureToInvocation(
  mode: string,
  extraArgs: string[],
  error: ToolTimeout | ExitNonZero | ToolNotFound
): ToolInvocation {
  const message =
    error._tag === "ToolTimeout"
      ? `kimi-doctor timed out after ${error.timeoutMs}ms`
      : error._tag === "ToolNotFound"
        ? `kimi-doctor command not found: ${error.tool}`
        : error.stderr || `kimi-doctor exited ${error.exitCode}`;
  return {
    tool: "kimi-doctor",
    args: [mode, ...extraArgs],
    cwd: process.cwd(),
    timeoutMs: error._tag === "ToolTimeout" ? error.timeoutMs : 0,
    exitCode: error._tag === "ExitNonZero" ? error.exitCode : -1,
    stdout: "",
    stderr: "",
    maxOutputBytes: 0,
    durationMs: 0,
    isError: true,
    error: message,
    timedOut: error._tag === "ToolTimeout",
  };
}

async function runDoctor(mode: string, extraArgs: string[]): Promise<ToolInvocation> {
  const args = ["run", SCRIPT_PATH, `--${mode}`, "--json", ...extraArgs];
  const exit = await Effect.runPromiseExit(
    invokeCommandEffect(["bun", ...args], { cwd: process.cwd(), tool: "kimi-doctor" })
  );
  if (Exit.isSuccess(exit)) return exit.value;
  if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
    const error = exit.cause.error;
    if (
      error._tag === "ToolTimeout" ||
      error._tag === "ExitNonZero" ||
      error._tag === "ToolNotFound"
    ) {
      return runnerFailureToInvocation(mode, extraArgs, error);
    }
  }
  return {
    tool: "kimi-doctor",
    args: [mode, ...extraArgs],
    cwd: process.cwd(),
    timeoutMs: 0,
    exitCode: -1,
    stdout: "",
    stderr: "",
    maxOutputBytes: 0,
    durationMs: 0,
    isError: true,
    error: "kimi-doctor invocation failed",
  };
}

function toolResultText(result: ToolInvocation): string {
  const parts: string[] = [];
  if (result.error) parts.push(`error: ${result.error}`);
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(`stderr: ${result.stderr}`);
  return parts.join("\n").slice(0, 100_000);
}

async function handleRequest(req: unknown) {
  const { id, method, params } = req as {
    id?: unknown;
    method?: string;
    params?: Record<string, unknown>;
  };

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
      break;
    case "tools/list": {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      break;
    }
    case "tools/call": {
      const name = params?.name;
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      if (name === "kimi_doctor_probe") {
        try {
          const manifest = await buildDoctorProbeManifest(
            typeof args.projectRoot === "string" && args.projectRoot
              ? args.projectRoot
              : process.cwd()
          );
          send({
            jsonrpc: "2.0",
            id,
            result: { content: [{ type: "text", text: JSON.stringify(manifest) }] },
          });
        } catch (e) {
          internalError(id, e instanceof Error ? e.message : String(e));
        }
        return;
      }
      if (
        name === "kimi_doctor_run" ||
        name === "kimi_doctor_fix" ||
        name === "kimi_doctor_run_all"
      ) {
        const extra: string[] = [];
        if (typeof args.projectRoot === "string" && args.projectRoot) {
          extra.push("--project-root", args.projectRoot);
        }
        if (args.quick === true) extra.push("--quick");
        if (name === "kimi_doctor_fix") extra.push("--fix");

        let mode: string;
        if (name === "kimi_doctor_run_all") {
          mode = "all";
        } else {
          if (typeof args.mode !== "string" || !args.mode) {
            invalidParams(id, "Missing or invalid 'mode' argument");
            return;
          }
          mode = args.mode as string;
        }

        let result: ToolInvocation;
        try {
          result = await runDoctor(mode, extra);
        } catch (e) {
          result = {
            tool: "kimi-doctor",
            args: [mode, ...extra],
            cwd: process.cwd(),
            timeoutMs: 0,
            exitCode: -1,
            stdout: "",
            stderr: "",
            maxOutputBytes: 0,
            durationMs: 0,
            isError: true,
            error: e instanceof Error ? e.message : String(e),
          };
        }
        send({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: toolResultText(result) }] },
        });
        return;
      }
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Tool not found: ${name}` } });
      break;
    }
    default: {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  }
}

export async function startDoctorMcpServer(): Promise<void> {
  for await (const line of readLines(Bun.stdin.stream())) {
    try {
      const req = JSON.parse(line);
      await handleRequest(req);
    } catch {
      // Ignore malformed lines to stay resilient.
    }
  }
}
