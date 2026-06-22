/**
 * MCP server registry — load built-in and user-defined server definitions.
 *
 * User servers: ~/.kimi-code/mcp-servers/*.toml
 * Built-in servers: embedded defaults for unified-shell and cloudflare-api.
 */

import { listDir, pathExists } from "./bun-io.ts";
import { join } from "path";
import { homeDir, mcpServersDir } from "./paths.ts";
import { ensureDir } from "./utils.ts";

export interface McpServerDefinition {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
  default?: boolean;
  description?: string;
  startupTimeoutMs?: number;
  toolTimeoutMs?: number;
  enabledTools?: string[];
  disabledTools?: string[];
  headers?: Record<string, string>;
  bearerTokenEnvVar?: string;
  /** Env vars that must be present for the server to be considered available. */
  requiredEnv?: string[];
  /** Servers/tools that should be active for this profile. */
  profiles?: string[];
}

export interface McpRegistry {
  servers: Record<string, McpServerDefinition>;
  builtinNames: string[];
  userNames: string[];
}

export const UNIFIED_SHELL_SERVER = "unified-shell";
export const CLOUDFLARE_API_SERVER = "cloudflare-api";
export const DASHBOARD_MCP_SERVER = "kimi-dashboard";
export const BUN_DOCS_SERVER = "bun-docs";
export const BUN_DOCS_MCP_URL = "https://bun.com/docs/mcp";
export const BUN_DOCS_MCP_TOOLS = ["search_bun", "query_docs_filesystem_bun"] as const;
export const UNIFIED_SHELL_BRIDGE = "unified-shell-bridge.ts";

function resolveBunPath(): string {
  return Bun.which("bun") || "bun";
}

function builtinUnifiedShell(home: string): McpServerDefinition {
  return {
    name: UNIFIED_SHELL_SERVER,
    command: resolveBunPath(),
    args: ["run", join(home, ".kimi-code", "tools", UNIFIED_SHELL_BRIDGE)],
    env: {
      TERMINAL_BINDING_ENABLED: "true",
      KIMI_SHELL_MODE: "unified",
    },
    description: "Unified Shell Bridge: Bun-native shell execution with signal handling",
    default: true,
    startupTimeoutMs: 30000,
    toolTimeoutMs: 120000,
    profiles: ["full", "safe"],
    disabledTools: [],
  };
}

function builtinCloudflareApi(): McpServerDefinition {
  return {
    name: CLOUDFLARE_API_SERVER,
    url: "https://mcp.cloudflare.com/mcp",
    description: "Cloudflare API: search and execute against the full Cloudflare API via Code Mode",
    default: true,
    startupTimeoutMs: 30000,
    toolTimeoutMs: 60000,
    profiles: ["full"],
    requiredEnv: ["CLOUDFLARE_API_TOKEN"],
  };
}

function builtinBunDocs(): McpServerDefinition {
  return {
    name: BUN_DOCS_SERVER,
    url: BUN_DOCS_MCP_URL,
    description: "Bun docs MCP: search_bun + query_docs_filesystem_bun",
    default: true,
    startupTimeoutMs: 30000,
    toolTimeoutMs: 60000,
    profiles: ["full", "safe"],
    enabledTools: [...BUN_DOCS_MCP_TOOLS],
  };
}

function builtinDashboardMcp(home: string): McpServerDefinition {
  return {
    name: DASHBOARD_MCP_SERVER,
    command: resolveBunPath(),
    args: ["run", join(home, ".kimi-code", "tools", "kimi-dashboard-mcp.ts")],
    description: "Read-only dashboard data: health, effect-gates, doctor runs, debug logs",
    default: false,
    startupTimeoutMs: 30000,
    toolTimeoutMs: 30000,
    profiles: ["full"],
  };
}

function parseServerToml(name: string, text: string): McpServerDefinition | null {
  try {
    const parsed = Bun.TOML.parse(text) as Record<string, unknown>;
    return normalizeDefinition(name, parsed);
  } catch {
    return null;
  }
}

function normalizeDefinition(name: string, raw: Record<string, unknown>): McpServerDefinition {
  return {
    name,
    command: stringOrUndefined(raw.command),
    args: stringArrayOrUndefined(raw.args),
    url: stringOrUndefined(raw.url),
    env: recordOrUndefined(raw.env),
    cwd: stringOrUndefined(raw.cwd),
    enabled: booleanOrUndefined(raw.enabled),
    default: booleanOrUndefined(raw.default),
    description: stringOrUndefined(raw.description),
    startupTimeoutMs: numberOrUndefined(raw.startupTimeoutMs),
    toolTimeoutMs: numberOrUndefined(raw.toolTimeoutMs),
    enabledTools: stringArrayOrUndefined(raw.enabledTools),
    disabledTools: stringArrayOrUndefined(raw.disabledTools),
    headers: recordOrUndefined(raw.headers),
    bearerTokenEnvVar: stringOrUndefined(raw.bearerTokenEnvVar),
    requiredEnv: stringArrayOrUndefined(raw.requiredEnv),
    profiles: stringArrayOrUndefined(raw.profiles),
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArrayOrUndefined(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? strings : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function recordOrUndefined(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (typeof val === "string") out[key] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function mcpServersDirPath(home: string = homeDir()): string {
  return mcpServersDir(home);
}

export async function loadMcpRegistry(home: string = homeDir()): Promise<McpRegistry> {
  const servers: Record<string, McpServerDefinition> = {};
  const builtinNames: string[] = [];
  const userNames: string[] = [];

  const unified = builtinUnifiedShell(home);
  servers[unified.name] = unified;
  builtinNames.push(unified.name);

  const cf = builtinCloudflareApi();
  servers[cf.name] = cf;
  builtinNames.push(cf.name);

  const bunDocs = builtinBunDocs();
  servers[bunDocs.name] = bunDocs;
  builtinNames.push(bunDocs.name);

  const dash = builtinDashboardMcp(home);
  servers[dash.name] = dash;
  builtinNames.push(dash.name);

  const dir = mcpServersDirPath(home);
  ensureDir(dir);
  if (pathExists(dir)) {
    for (const file of listDir(dir).filter((f) => f.endsWith(".toml"))) {
      const name = file.replace(/\.toml$/, "");
      const text = await Bun.file(join(dir, file)).text();
      const def = parseServerToml(name, text);
      if (def) {
        servers[name] = def;
        userNames.push(name);
      }
    }
  }

  return { servers, builtinNames, userNames };
}

export function getDefaultServerNames(registry: McpRegistry): string[] {
  return Object.values(registry.servers)
    .filter((server) => server.default !== false)
    .map((server) => server.name);
}

export function serverRequiresEnv(server: McpServerDefinition): boolean {
  return (server.requiredEnv ?? []).length > 0;
}

export function serverEnvAvailable(server: McpServerDefinition): boolean {
  return (server.requiredEnv ?? []).every((name) => !!Bun.env[name]);
}

export function mergeRegistryIntoConfig(
  registry: McpRegistry,
  existing: Record<string, McpServerDefinition> = {}
): Record<string, McpServerDefinition> {
  const merged: Record<string, McpServerDefinition> = { ...existing };
  for (const [name, def] of Object.entries(registry.servers)) {
    if (!merged[name]) {
      merged[name] = def;
    }
  }
  return merged;
}
