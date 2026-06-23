/**
 * MCP server probing — lightweight runtime health checks.
 *
 * Spawns stdio servers or POSTs to URL servers with a JSON-RPC tools/list
 * request. HTTP/SSE transport is delegated to mcp/sse.ts.
 */

import type { McpServerDefinition } from "./mcp-registry.ts";
import { createHttpMcpClientFromServer, extractMcpTools, type JsonRpcMessage } from "./mcp/sse.ts";

export { parseSseMessages } from "./mcp/sse.ts";

export interface McpProbeResult {
  ok: boolean;
  tools?: string[];
  error?: string;
  latencyMs: number;
  cached?: boolean;
}

const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  result: McpProbeResult;
  expiresAt: number;
}

const probeCache = new Map<string, CacheEntry>();

/** Clear the probe cache (useful for testing or forced refresh). */
export function clearProbeCache(): void {
  probeCache.clear();
}

function probeCacheKey(server: McpServerDefinition): string {
  return server.url ?? `${server.command}:${(server.args ?? []).join(" ")}`;
}

function cacheEntryValid(entry: CacheEntry): boolean {
  return Date.now() < entry.expiresAt;
}

export async function probeMcpServerCached(
  server: McpServerDefinition,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
  cacheTtlMs: number = DEFAULT_CACHE_TTL_MS
): Promise<McpProbeResult> {
  const key = probeCacheKey(server);
  const cached = probeCache.get(key);
  if (cached && cacheEntryValid(cached)) {
    return { ...cached.result, cached: true };
  }
  const result = await probeMcpServer(server, timeoutMs);
  if (result.ok) {
    probeCache.set(key, {
      result,
      expiresAt: Date.now() + cacheTtlMs,
    });
  }
  return result;
}

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

export interface ToolDescription {
  name: string;
  description?: string;
}

export interface McpProbeWithDescriptionsResult extends McpProbeResult {
  toolDescriptions?: ToolDescription[];
}

export async function probeMcpServerWithDescriptions(
  server: McpServerDefinition,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS
): Promise<McpProbeWithDescriptionsResult> {
  const started = Date.now();
  try {
    if (server.url) {
      const client = createHttpMcpClientFromServer({ ...server, toolTimeoutMs: timeoutMs });
      const { tools, latencyMs, cached } = await client.listTools({ timeoutMs });
      return {
        ok: true,
        tools: tools.map((tool) => tool.name),
        toolDescriptions: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
        })),
        latencyMs: latencyMs || Date.now() - started,
        cached,
      };
    }
    const result = await probeStdioServer(server, timeoutMs);
    return { ...result, latencyMs: Date.now() - started };
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
  try {
    const client = createHttpMcpClientFromServer({ ...server, toolTimeoutMs: timeoutMs });
    const { tools, cached } = await client.listTools({ timeoutMs });
    return { ok: true, tools: tools.map((tool) => tool.name), cached };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : Bun.inspect(cause),
    };
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
    const initResponse = await readJsonRpcLine(reader, timeoutMs, 0);
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

    const listResponse = await readJsonRpcLine(reader, timeoutMs, 1);
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

async function readJsonRpcLine(
  reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>,
  timeoutMs: number,
  matchId?: number | string
): Promise<string | null> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        const parsed = safeJsonParse<JsonRpcMessage>(line);
        if (parsed && (parsed.result !== undefined || parsed.error)) {
          if (matchId === undefined || parsed.id === matchId) return line;
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  }
  return null;
}

function extractToolNames(result: unknown): string[] {
  return extractMcpTools(result).map((tool) => tool.name);
}

export interface McpToolCallResult {
  ok: boolean;
  content?: unknown;
  error?: string;
  latencyMs: number;
  cached?: boolean;
  attempts?: number;
}

/** Call a specific tool on an HTTP MCP server via JSON-RPC `tools/call`. */
export async function callMcpToolHttp(
  server: McpServerDefinition,
  toolName: string,
  args: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
  options: { refresh?: boolean } = {}
): Promise<McpToolCallResult> {
  const started = Date.now();
  if (!server.url) {
    return { ok: false, error: "server has no url", latencyMs: 0 };
  }
  try {
    const client = createHttpMcpClientFromServer(
      { ...server, toolTimeoutMs: timeoutMs },
      { cacheDbPath: true }
    );
    const { result, latencyMs, cached, attempts } = await client.callTool(toolName, args, {
      timeoutMs,
      refresh: options.refresh,
    });
    return {
      ok: true,
      content: result,
      latencyMs: latencyMs || Date.now() - started,
      cached,
      attempts,
    };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : Bun.inspect(cause),
      latencyMs: Date.now() - started,
    };
  }
}

function safeJsonParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Extract tool names + descriptions from a tools/list result. */
export function extractToolDescriptions(result: unknown): ToolDescription[] {
  return extractMcpTools(result).map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}

export {
  decodeJsonRpcMessages,
  selectTerminalJsonRpcMessage,
  createHttpMcpClient,
  createHttpMcpClientFromServer,
} from "./mcp/sse.ts";
