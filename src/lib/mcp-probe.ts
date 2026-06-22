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
  /** Whether this result was served from cache. */
  cached?: boolean;
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
const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  result: McpProbeResult;
  expiresAt: number;
}

const probeCache = new Map<string, CacheEntry>();

/** Clear the probe cache (useful for testing or forced refresh). */
export function clearProbeCache(): void {
  probeCache.clear();
}

/** Get cache key for a server definition. */
function probeCacheKey(server: McpServerDefinition): string {
  return server.url ?? `${server.command}:${(server.args ?? []).join(" ")}`;
}

/** Check if a cache entry is still valid. */
function cacheEntryValid(entry: CacheEntry): boolean {
  return Date.now() < entry.expiresAt;
}

/**
 * Probe an MCP server with TTL-cached results.
 * Avoids hammering remote HTTP MCP endpoints on every doctor/dashboard refresh.
 */
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

export interface McpProbeWithDescriptionsResult extends McpProbeResult {
  toolDescriptions?: ToolDescription[];
}

/**
 * Probe an MCP server and return both tool names and descriptions.
 * Useful for dashboard knowledge cards and doctor output.
 */
export async function probeMcpServerWithDescriptions(
  server: McpServerDefinition,
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS
): Promise<McpProbeWithDescriptionsResult> {
  const started = Date.now();
  try {
    if (server.url) {
      const result = await probeHttpServerWithDescriptions(server, timeoutMs);
      return { ...result, latencyMs: Date.now() - started };
    }
    // stdio servers: fall back to plain probe (descriptions not needed for stdio)
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

/** Parse SSE `data:` payloads from remote MCP servers (e.g. bun.com/docs/mcp). */
export function parseSseMessages(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const messages: string[] = [];
  let buffer = "";
  for (const line of lines) {
    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      buffer += payload;
    } else if (line.trim() === "" && buffer.length > 0) {
      messages.push(buffer);
      buffer = "";
    }
  }
  if (buffer.length > 0) messages.push(buffer);
  return messages;
}

async function probeHttpServer(
  server: McpServerDefinition,
  timeoutMs: number
): Promise<Omit<McpProbeResult, "latencyMs">> {
  const url = server.url!;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
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
    const contentType = response.headers.get("content-type") ?? "";
    const isSse = contentType.includes("text/event-stream") || text.includes("event:");
    const payloads = isSse ? parseSseMessages(text) : [text];
    if (payloads.length === 0) {
      return { ok: false, error: `empty response (content-type: ${contentType || "unknown"})` };
    }
    const parsed = payloads
      .map((payload) => safeJsonParse<JsonRpcMessage>(payload))
      .find((message) => message && (message.result || message.error));
    if (parsed?.error) {
      return { ok: false, error: parsed.error.message };
    }
    if (!parsed) {
      return { ok: false, error: `no valid JSON-RPC response in ${payloads.length} payload(s)` };
    }
    const tools = extractToolNames(parsed.result);
    return { ok: true, tools };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      return { ok: false, error: `timeout after ${timeoutMs}ms` };
    }
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : Bun.inspect(cause),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeHttpServerWithDescriptions(
  server: McpServerDefinition,
  timeoutMs: number
): Promise<Omit<McpProbeWithDescriptionsResult, "latencyMs">> {
  const url = server.url!;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
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
    const contentType = response.headers.get("content-type") ?? "";
    const isSse = contentType.includes("text/event-stream") || text.includes("event:");
    const payloads = isSse ? parseSseMessages(text) : [text];
    if (payloads.length === 0) {
      return { ok: false, error: `empty response (content-type: ${contentType || "unknown"})` };
    }
    const parsed = payloads
      .map((payload) => safeJsonParse<JsonRpcMessage>(payload))
      .find((message) => message && (message.result || message.error));
    if (parsed?.error) {
      return { ok: false, error: parsed.error.message };
    }
    if (!parsed) {
      return { ok: false, error: `no valid JSON-RPC response in ${payloads.length} payload(s)` };
    }
    const tools = extractToolNames(parsed.result);
    const toolDescriptions = extractToolDescriptions(parsed.result);
    return { ok: true, tools, toolDescriptions };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      return { ok: false, error: `timeout after ${timeoutMs}ms` };
    }
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : Bun.inspect(cause),
    };
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

export interface ToolDescription {
  name: string;
  description?: string;
}

/** Extract tool names + descriptions from a tools/list result. */
export function extractToolDescriptions(result: unknown): ToolDescription[] {
  if (!result || typeof result !== "object") return [];
  const raw = result as Record<string, unknown>;
  const tools = raw.tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .filter((tool): tool is Record<string, unknown> => tool !== null && typeof tool === "object")
    .map((tool) => ({
      name: typeof tool.name === "string" ? tool.name : "",
      description: typeof tool.description === "string" ? tool.description : undefined,
    }))
    .filter((tool) => tool.name.length > 0);
}

export interface McpToolCallResult {
  ok: boolean;
  content?: unknown;
  error?: string;
  latencyMs: number;
}

/**
 * Call a specific tool on an HTTP MCP server via JSON-RPC `tools/call`.
 * Handles both plain JSON and SSE-framed responses.
 */
export async function callMcpToolHttp(
  server: McpServerDefinition,
  toolName: string,
  args: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS
): Promise<McpToolCallResult> {
  const started = Date.now();
  const url = server.url;
  if (!url) {
    return { ok: false, error: "server has no url", latencyMs: 0 };
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...server.headers,
  };
  if (server.bearerTokenEnvVar && Bun.env[server.bearerTokenEnvVar]) {
    headers["Authorization"] = `Bearer ${Bun.env[server.bearerTokenEnvVar]}`;
  }
  const body: JsonRpcMessage = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: toolName, arguments: args },
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
      return { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 120)}`, latencyMs: Date.now() - started };
    }
    const contentType = response.headers.get("content-type") ?? "";
    const isSse = contentType.includes("text/event-stream") || text.includes("event:");
    const payloads = isSse ? parseSseMessages(text) : [text];
    const parsed = payloads
      .map((payload) => safeJsonParse<JsonRpcMessage>(payload))
      .find((message) => message && (message.result || message.error));
    if (parsed?.error) {
      return { ok: false, error: parsed.error.message, latencyMs: Date.now() - started };
    }
    if (!parsed) {
      return { ok: false, error: `no valid JSON-RPC response in ${payloads.length} payload(s)`, latencyMs: Date.now() - started };
    }
    return { ok: true, content: parsed.result, latencyMs: Date.now() - started };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      return { ok: false, error: `timeout after ${timeoutMs}ms`, latencyMs: Date.now() - started };
    }
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : Bun.inspect(cause),
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

function safeJsonParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
