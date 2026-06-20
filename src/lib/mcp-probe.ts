/**
 * MCP server probing — lightweight runtime health checks.
 *
 * Spawns stdio servers or POSTs to URL servers with a JSON-RPC tools/list
 * request. Returns discovered tools or an error reason.
 */

import type { McpServerDefinition } from "./mcp-registry.ts";

export interface McpProbeResult {
  ok: boolean;
  tools?: string[];
  error?: string;
  latencyMs: number;
}

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

const DEFAULT_PROBE_TIMEOUT_MS = 10000;

export async function probeMcpServer(
  server: McpServerDefinition,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS
): Promise<McpProbeResult> {
  const started = Date.now();
  try {
    if (server.url) {
      const result = await probeHttpServer(server, timeoutMs);
      return { ...result, latencyMs: Date.now() - started };
    }
    if (server.command) {
      const result = await probeStdioServer(server, timeoutMs);
      return { ...result, latencyMs: Date.now() - started };
    }
    return {
      ok: false,
      error: "server has neither command nor url",
      latencyMs: Date.now() - started,
    };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : Bun.inspect(cause),
      latencyMs: Date.now() - started,
    };
  }
}

async function probeHttpServer(
  server: McpServerDefinition,
  timeoutMs: number
): Promise<Omit<McpProbeResult, "latencyMs">> {
  const url = server.url!;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...server.headers,
  };
  if (server.bearerTokenEnvVar && Bun.env[server.bearerTokenEnvVar]) {
    headers["Authorization"] = `Bearer ${Bun.env[server.bearerTokenEnvVar]}`;
  }

  const body: JsonRpcMessage = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 120)}` };
    }
    const parsed = safeJsonParse<JsonRpcMessage>(text);
    const tools = extractToolNames(parsed?.result);
    return { ok: true, tools };
  } finally {
    clearTimeout(timer);
  }
}

async function probeStdioServer(
  server: McpServerDefinition,
  timeoutMs: number
): Promise<Omit<McpProbeResult, "latencyMs">> {
  const proc = Bun.spawn([server.command!, ...(server.args ?? [])], {
    env: { ...Bun.env, ...server.env },
    cwd: server.cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
  });

  const timeout = setTimeout(() => proc.kill("SIGTERM"), timeoutMs);

  try {
    const writeLine = (message: JsonRpcMessage): void => {
      proc.stdin.write(`${JSON.stringify(message)}\n`);
    };
    writeLine({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "kimi-toolchain-mcp-probe", version: "0.1.0" },
      },
    });

    const reader = proc.stdout.getReader() as ReadableStreamDefaultReader<
      Uint8Array<ArrayBufferLike>
    >;
    const initResponse = await readLine(reader, timeoutMs);
    if (!initResponse) {
      return { ok: false, error: "no initialize response" };
    }

    writeLine({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    writeLine({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });

    const listResponse = await readLine(reader, timeoutMs);
    if (!listResponse) {
      return { ok: false, error: "no tools/list response" };
    }

    const parsed = safeJsonParse<JsonRpcMessage>(listResponse);
    const tools = extractToolNames(parsed?.result);
    return { ok: true, tools };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : Bun.inspect(cause),
    };
  } finally {
    clearTimeout(timeout);
    try {
      proc.kill("SIGTERM");
      await proc.exited;
    } catch {
      // ignore cleanup errors
    }
  }
}

async function readLine(
  reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>,
  timeoutMs: number
): Promise<string | null> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) return line;
    }
  }
  return null;
}

function extractToolNames(result: unknown): string[] {
  if (!result || typeof result !== "object") return [];
  const raw = result as Record<string, unknown>;
  const tools = raw.tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) =>
      tool && typeof tool === "object" ? (tool as Record<string, unknown>).name : undefined
    )
    .filter((name): name is string => typeof name === "string");
}

function safeJsonParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
