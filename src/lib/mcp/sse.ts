/**
 * mcp/sse.ts — Reusable HTTP MCP client for JSON-RPC over SSE.
 *
 * Remote MCP servers (e.g. bun.com/docs/mcp) respond with `text/event-stream`
 * frames where each `data:` line carries a JSON-RPC 2.0 payload. This module
 * centralizes SSE parsing, request/response correlation, retries, and TTL caches.
 *
 * @see src/lib/mcp-probe.ts — stdio probing + thin HTTP wrappers
 * @see src/lib/bun-docs-mcp.ts — Bun docs convenience layer
 */

import { Database } from "bun:sqlite";
import { sha256String } from "../utils.ts";
import { homeDir } from "../paths.ts";
import { loadMcpRegistry } from "../mcp-registry.ts";
import { makeDir } from "../bun-io.ts";

export interface JsonRpcError {
  code: number;
  message: string;
}

export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcError;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface HttpMcpClientOptions {
  url: string;
  headers?: Record<string, string>;
  bearerTokenEnvVar?: string;
  /** Default request timeout (ms). */
  timeoutMs?: number;
  /** tools/list cache TTL — default 1 hour. */
  toolListCacheTtlMs?: number;
  /** tools/call cache TTL — default 10 minutes. */
  toolCallCacheTtlMs?: number;
  /** Retry count after the first attempt — default 2 (3 total tries). */
  maxRetries?: number;
  /** Exponential backoff base (ms) — delays 2s, 4s, 8s… */
  retryBaseMs?: number;
  /** Optional SQLite path for persistent cross-invocation cache. Default: ~/.kimi-code/var/mcp-cache.db */
  cacheDbPath?: string;
}

export interface HttpMcpRequestResult {
  message: JsonRpcMessage;
  latencyMs: number;
  cached?: boolean;
  attempts: number;
}

export interface HttpMcpClient {
  request: (
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number }
  ) => Promise<HttpMcpRequestResult>;
  listTools: (options?: { timeoutMs?: number; refresh?: boolean }) => Promise<{
    tools: McpTool[];
    latencyMs: number;
    cached?: boolean;
  }>;
  callTool: (
    name: string,
    args?: Record<string, unknown>,
    options?: { timeoutMs?: number; refresh?: boolean }
  ) => Promise<{
    result: unknown;
    latencyMs: number;
    cached?: boolean;
    attempts: number;
  }>;
  clearCache: () => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TOOL_LIST_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_TOOL_CALL_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 2000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_CACHE_DB_PATH = `${homeDir()}/.cache/kimi-toolchain/mcp-cache.db`;

function resolveCacheDbPath(raw: string | true | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (raw === true) return DEFAULT_CACHE_DB_PATH;
  return raw;
}

let requestId = 1;

function nextRequestId(): number {
  return requestId++;
}

function safeJsonParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Parse SSE `data:` payloads from a complete HTTP response body. */
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

function isSseResponse(contentType: string, body: string): boolean {
  return contentType.includes("text/event-stream") || body.includes("event:");
}

/** Decode JSON-RPC messages from a plain JSON or SSE HTTP body. */
export function decodeJsonRpcMessages(body: string, contentType = ""): JsonRpcMessage[] {
  const payloads = isSseResponse(contentType, body) ? parseSseMessages(body) : [body];
  return payloads
    .map((payload) => safeJsonParse<JsonRpcMessage>(payload))
    .filter((message): message is JsonRpcMessage => message !== undefined);
}

/** Pick the terminal JSON-RPC message, preferring a matching request id. */
export function selectTerminalJsonRpcMessage(
  messages: JsonRpcMessage[],
  matchId?: number | string
): JsonRpcMessage | undefined {
  const terminal = messages.filter(
    (message) => message.result !== undefined || message.error !== undefined
  );
  if (terminal.length === 0) return undefined;
  if (matchId !== undefined) {
    const matched = terminal.find((message) => message.id === matchId);
    if (matched) return matched;
  }
  return terminal[terminal.length - 1];
}

export function extractMcpTools(result: unknown): McpTool[] {
  if (!result || typeof result !== "object") return [];
  const raw = result as Record<string, unknown>;
  const tools = raw.tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .filter((tool): tool is Record<string, unknown> => tool !== null && typeof tool === "object")
    .map((tool) => ({
      name: typeof tool.name === "string" ? tool.name : "",
      description: typeof tool.description === "string" ? tool.description : undefined,
      inputSchema: tool.inputSchema,
    }))
    .filter((tool) => tool.name.length > 0);
}

export function formatMcpStreamError(cause: string): string {
  return [`Error: ${cause}`, "Try again in a few seconds or check your network connection."].join(
    "\n"
  );
}

function buildHeaders(options: HttpMcpClientOptions): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...options.headers,
  };
  if (options.bearerTokenEnvVar && Bun.env[options.bearerTokenEnvVar]) {
    headers.Authorization = `Bearer ${Bun.env[options.bearerTokenEnvVar]}`;
  }
  return headers;
}

function cacheValid<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return entry !== undefined && Date.now() < entry.expiresAt;
}

function toolCallCacheKey(toolName: string, args: Record<string, unknown>): string {
  return sha256String(`${toolName}:${JSON.stringify(args)}`);
}

// ── SQLite-backed persistent cache ──────────────────────────────────────

interface PersistentCacheStore {
  get(serverUrl: string, cacheKey: string): unknown;
  set(serverUrl: string, cacheKey: string, value: unknown, ttlMs: number): void;
  clearServer(serverUrl: string): void;
  close(): void;
}

function openCacheDb(dbPath: string): Database {
  // Ensure parent directory exists (idempotent).
  const parent = dbPath.substring(0, dbPath.lastIndexOf("/"));
  makeDir(parent, { recursive: true });

  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode=WAL");
  db.run(
    `CREATE TABLE IF NOT EXISTS mcp_cache (
      server_url TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (server_url, cache_key)
    )`
  );
  db.run("CREATE INDEX IF NOT EXISTS idx_mcp_cache_expires ON mcp_cache(expires_at)");
  return db;
}

function createPersistentCache(dbPath: string): PersistentCacheStore {
  const db = openCacheDb(dbPath);
  let pruneJob: Bun.CronJob | undefined;

  function pruneExpired() {
    try {
      db.run("DELETE FROM mcp_cache WHERE expires_at < ?", [Date.now()]);
    } catch {
      // ignore — db may be closed during shutdown
    }
  }

  // Prune every 10 minutes (unref so it doesn't keep the process alive).
  pruneJob = Bun.cron("*/10 * * * *", pruneExpired);
  pruneJob.unref();

  return {
    get(serverUrl: string, cacheKey: string): unknown {
      try {
        const row = db
          .query("SELECT value, expires_at FROM mcp_cache WHERE server_url = ? AND cache_key = ?")
          .get(serverUrl, cacheKey) as { value: string; expires_at: number } | null;
        if (!row || Date.now() >= row.expires_at) return undefined;
        return JSON.parse(row.value);
      } catch {
        return undefined;
      }
    },

    set(serverUrl: string, cacheKey: string, value: unknown, ttlMs: number) {
      try {
        db.run(
          "INSERT OR REPLACE INTO mcp_cache (server_url, cache_key, value, expires_at) VALUES (?, ?, ?, ?)",
          [serverUrl, cacheKey, JSON.stringify(value), Date.now() + ttlMs]
        );
      } catch {
        // ignore write failures — in-memory cache still works
      }
    },

    clearServer(serverUrl: string) {
      try {
        db.run("DELETE FROM mcp_cache WHERE server_url = ?", [serverUrl]);
      } catch {
        // ignore
      }
    },

    close() {
      if (pruneJob) {
        pruneJob.stop();
        pruneJob = undefined;
      }
      try {
        db.close();
      } catch {
        // ignore
      }
    },
  };
}

/** Module-level shared persistent caches, keyed by dbPath. Created lazily on first use. */
const sharedPersistentCaches = new Map<string, PersistentCacheStore>();

function getOrCreatePersistentCache(dbPath: string): PersistentCacheStore {
  let cache = sharedPersistentCaches.get(dbPath);
  if (!cache) {
    cache = createPersistentCache(dbPath);
    sharedPersistentCaches.set(dbPath, cache);
  }
  return cache;
}

/** Clear SQLite persistent cache entries for a server URL (default DB path). */
export function clearPersistentMcpCacheForUrl(
  url: string,
  cacheDbPath: string | true = true
): void {
  const dbPath = resolveCacheDbPath(cacheDbPath);
  if (!dbPath) return;
  getOrCreatePersistentCache(dbPath).clearServer(url);
}

async function sleepBackoff(baseMs: number, attempt: number): Promise<void> {
  await Bun.sleep(baseMs * 2 ** attempt);
}

/**
 * Create a reusable HTTP MCP client for SSE-framed JSON-RPC servers.
 */
export function createHttpMcpClient(options: HttpMcpClientOptions): HttpMcpClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const toolListCacheTtlMs = options.toolListCacheTtlMs ?? DEFAULT_TOOL_LIST_CACHE_TTL_MS;
  const toolCallCacheTtlMs = options.toolCallCacheTtlMs ?? DEFAULT_TOOL_CALL_CACHE_TTL_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const headers = buildHeaders(options);

  // ── Persistent cache (SQLite) — shared across invocations ──
  const resolvedCacheDbPath = resolveCacheDbPath(options.cacheDbPath);
  const persistentCache: PersistentCacheStore | null = resolvedCacheDbPath
    ? getOrCreatePersistentCache(resolvedCacheDbPath)
    : null;

  // ── In-memory cache (L1) ──
  let toolListCache: CacheEntry<McpTool[]> | undefined;
  const toolCallCache = new Map<string, CacheEntry<unknown>>();

  /** Check persistent cache then in-memory cache. */
  function getCached<T>(cacheKey: string): T | undefined {
    // L2: SQLite (cross-invocation)
    if (persistentCache) {
      const value = persistentCache.get(options.url, cacheKey);
      if (value !== undefined) {
        // Promote to in-memory for the rest of this process
        return value as T;
      }
    }
    return undefined;
  }

  /** Write through to both in-memory and persistent cache. */
  function setCached<T>(cacheKey: string, value: T, ttlMs: number): void {
    if (persistentCache) {
      persistentCache.set(options.url, cacheKey, value, ttlMs);
    }
  }

  async function postJsonRpc(
    method: string,
    params: unknown,
    requestTimeoutMs: number
  ): Promise<{ body: string; contentType: string; id: number }> {
    const id = nextRequestId();
    const body: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(options.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
      return {
        body: text,
        contentType: response.headers.get("content-type") ?? "",
        id,
      };
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") {
        throw new Error(`timeout after ${requestTimeoutMs}ms`);
      }
      throw cause;
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(
    method: string,
    params: unknown = {},
    requestOptions?: { timeoutMs?: number }
  ): Promise<HttpMcpRequestResult> {
    const requestTimeoutMs = requestOptions?.timeoutMs ?? timeoutMs;
    let lastError = "MCP request failed";
    let attempts = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      attempts = attempt + 1;
      const started = Date.now();
      try {
        const { body, contentType, id } = await postJsonRpc(method, params, requestTimeoutMs);
        const messages = decodeJsonRpcMessages(body, contentType);
        if (messages.length === 0) {
          throw new Error(
            formatMcpStreamError(
              `MCP server returned incomplete SSE stream (content-type: ${contentType || "unknown"})`
            )
          );
        }
        const terminal = selectTerminalJsonRpcMessage(messages, id);
        if (!terminal) {
          throw new Error(
            formatMcpStreamError(`no terminal JSON-RPC result in ${messages.length} SSE payload(s)`)
          );
        }
        if (terminal.error) {
          throw new Error(terminal.error.message);
        }
        return {
          message: terminal,
          latencyMs: Date.now() - started,
          attempts,
        };
      } catch (cause) {
        lastError = cause instanceof Error ? cause.message : Bun.inspect(cause);
        if (attempt < maxRetries) {
          await sleepBackoff(retryBaseMs, attempt);
        }
      }
    }

    throw new Error(lastError);
  }

  return {
    request,

    async listTools(listOptions) {
      if (!listOptions?.refresh) {
        // L1: in-memory
        if (cacheValid(toolListCache)) {
          return { tools: toolListCache.value, latencyMs: 0, cached: true };
        }
        // L2: persistent (SQLite)
        const persisted = getCached<McpTool[]>("tools/list");
        if (persisted) {
          toolListCache = {
            value: persisted,
            expiresAt: Date.now() + toolListCacheTtlMs,
          };
          return { tools: persisted, latencyMs: 0, cached: true };
        }
      }
      const { message, latencyMs } = await request(
        "tools/list",
        {},
        { timeoutMs: listOptions?.timeoutMs }
      );
      const tools = extractMcpTools(message.result);
      toolListCache = {
        value: tools,
        expiresAt: Date.now() + toolListCacheTtlMs,
      };
      setCached("tools/list", tools, toolListCacheTtlMs);
      return { tools, latencyMs, cached: false };
    },

    async callTool(name, args = {}, callOptions) {
      const cacheKey = toolCallCacheKey(name, args);
      if (!callOptions?.refresh) {
        // L1: in-memory
        const cached = toolCallCache.get(cacheKey);
        if (cacheValid(cached)) {
          return { result: cached.value, latencyMs: 0, cached: true, attempts: 0 };
        }
        // L2: persistent (SQLite)
        const persisted = getCached<unknown>(cacheKey);
        if (persisted !== undefined) {
          toolCallCache.set(cacheKey, {
            value: persisted,
            expiresAt: Date.now() + toolCallCacheTtlMs,
          });
          return { result: persisted, latencyMs: 0, cached: true, attempts: 0 };
        }
      }

      const { message, latencyMs, attempts } = await request(
        "tools/call",
        { name, arguments: args },
        { timeoutMs: callOptions?.timeoutMs }
      );
      toolCallCache.set(cacheKey, {
        value: message.result,
        expiresAt: Date.now() + toolCallCacheTtlMs,
      });
      setCached(cacheKey, message.result, toolCallCacheTtlMs);
      return { result: message.result, latencyMs, cached: false, attempts };
    },

    clearCache() {
      toolListCache = undefined;
      toolCallCache.clear();
      if (persistentCache) {
        persistentCache.clearServer(options.url);
      }
    },
  };
}

/** Build an HTTP MCP client from an mcp-registry server definition. */
export function createHttpMcpClientFromServer(
  server: {
    url?: string;
    headers?: Record<string, string>;
    bearerTokenEnvVar?: string;
    toolTimeoutMs?: number;
    startupTimeoutMs?: number;
  },
  extra?: { cacheDbPath?: string | true }
): HttpMcpClient {
  if (!server.url) {
    throw new Error("server has no url");
  }
  return createHttpMcpClient({
    url: server.url,
    headers: server.headers,
    bearerTokenEnvVar: server.bearerTokenEnvVar,
    timeoutMs: server.toolTimeoutMs ?? server.startupTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    cacheDbPath: resolveCacheDbPath(extra?.cacheDbPath),
  });
}

/**
 * High-level MCP server configuration used by the class-based McpClient.
 */
export interface MCPServerConfig {
  name: string;
  url: string;
  headers?: Record<string, string>;
  /** Optional SQLite path for persistent cross-invocation cache. Use true for default path. */
  cacheDbPath?: string | true;
}

export class McpError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly requestId: number
  ) {
    super(`MCP Error ${code}: ${message} (req ${requestId})`);
  }
}

/**
 * Class-based wrapper around the functional HttpMcpClient.
 * Provides a simpler, spec-aligned MCP client API.
 */
export class McpClient {
  private readonly client: HttpMcpClient;

  constructor(private readonly config: MCPServerConfig) {
    this.client = createHttpMcpClient({
      url: config.url,
      headers: config.headers,
      cacheDbPath: resolveCacheDbPath(config.cacheDbPath),
    });
  }

  /** List available tools. */
  async listTools(): Promise<Array<{ name: string; description: string }>> {
    const { tools } = await this.client.listTools();
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
    }));
  }

  /** Call a tool by name with the given arguments. */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { result } = await this.client.callTool(name, args);
    return result;
  }

  /** Low-level JSON-RPC request. */
  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const { message } = await this.client.request(method, params ?? {});
    if (message.error) {
      throw new McpError(message.error.code, message.error.message, message.id as number);
    }
    return message.result;
  }

  /** Clear tool list and tool call caches. */
  invalidate(): void {
    this.client.clearCache();
  }
}

/**
 * Load an McpClient for a server registered in the MCP registry.
 * Resolves built-in servers first, then user-defined servers in ~/.kimi-code/mcp-servers/.
 */
export async function loadMcpClient(name: string): Promise<McpClient> {
  const home = homeDir();
  const registry = await loadMcpRegistry(home);
  const def = registry.servers[name];
  if (!def) {
    throw new Error(`MCP server '${name}' not found in registry`);
  }
  if (!def.url) {
    throw new Error(`MCP server '${name}' has no HTTP/SSE url`);
  }
  return new McpClient({
    name: def.name,
    url: def.url,
    headers: def.headers,
    cacheDbPath: true,
  });
}
