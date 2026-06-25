/**
 * MCP configuration — idempotent unified-shell provisioning for Kimi Code.
 * @see https://moonshotai.github.io/kimi-code/en/customization/mcp.html
 */

import { pathExists } from "./bun-io.ts";
import { join, resolve } from "path";
import { ensureDir } from "./utils.ts";
import { homeDir, mcpPath, toolsDir } from "./paths.ts";
import {
  BUN_DOCS_MCP_URL,
  BUN_DOCS_SERVER,
  type McpServerDefinition,
  loadMcpRegistry,
  serverEnvAvailable,
} from "./mcp-registry.ts";
import {
  buildBuiltinMcpCatalog,
  mcpCatalogSummary,
  mcpEndpointForServer,
  type McpCatalogReport,
  type McpProbeSnapshot,
  validateDiscoveredTools,
} from "./mcp-endpoints-metadata.ts";
import { callMcpToolHttp, probeMcpServerCached, type McpToolCallResult } from "./mcp-probe.ts";
import {
  clearPersistentMcpCacheForUrl,
  createHttpMcpClientFromServer,
  type HttpMcpClient,
} from "./mcp/sse.ts";
import { buildMcpVersionPolicyReport } from "./mcp-version-policy.ts";

export const UNIFIED_SHELL_SERVER = "unified-shell";
export const UNIFIED_SHELL_TOOL = "mcp__unified-shell__execute";
export const CLOUDFLARE_API_SERVER = "cloudflare-api";
export const CLOUDFLARE_API_TOOL_SEARCH = "mcp__cloudflare__search";
export const CLOUDFLARE_API_TOOL_EXECUTE = "mcp__cloudflare__execute";
export const CLOUDFLARE_MCP_URL = "https://mcp.cloudflare.com/mcp";

const KIMI_CODE_DIR = ".kimi-code";
const BUN_BINARY = "bun";
const UNIFIED_SHELL_BRIDGE = "unified-shell-bridge.ts";

/** MCP fallback defaults sourced from bunfig.toml `[define]`. */
export const MCP_DEFAULTS =
  typeof KIMI_MCP_DEFAULTS === "object" && KIMI_MCP_DEFAULTS !== null
    ? KIMI_MCP_DEFAULTS
    : {
        callTimeoutMs: 60000,
        queryTimeoutMs: 30000,
        cardTimeoutMs: 15000,
        maxTop: 0,
      };

/** mcp.json server row — Record key is canonical name when `name` is omitted. */
export interface McpServerEntry extends Omit<McpServerDefinition, "name"> {
  name?: string;
}

export interface McpProfile {
  enabledServers?: string[];
  disabledServers?: string[];
  enabledTools?: string[];
  disabledTools?: string[];
  description?: string;
}

export interface McpJson {
  mcpServers: Record<string, McpServerEntry>;
  profiles?: Record<string, McpProfile>;
}

export interface McpCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
  server?: string;
  tool?: string;
  profile?: string;
}

export interface McpValidationReport {
  checks: McpCheck[];
  userPath: string;
  projectPath: string | null;
  activeProfile?: string;
  discoveredTools: Record<string, string[]>;
  blockedTools: Record<string, string[]>;
  metadata?: ReturnType<typeof mcpCatalogSummary>;
  catalog?: ReturnType<typeof buildBuiltinMcpCatalog>;
}

export interface ReadMcpJsonResult {
  data: McpJson | null;
  error?: string;
}

export function userMcpPath(home?: string): string {
  return mcpPath(home);
}

export function projectMcpPath(projectRoot: string): string {
  return join(resolve(projectRoot), KIMI_CODE_DIR, "mcp.json");
}

export async function readMcpJson(path: string): Promise<ReadMcpJsonResult> {
  if (!pathExists(path)) return { data: null };
  try {
    const raw = await Bun.file(path).json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { data: null };
    const servers = Reflect.get(raw, "mcpServers");
    return {
      data: {
        mcpServers:
          servers && typeof servers === "object" && !Array.isArray(servers) ? servers : {},
      },
    };
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? e.message : Bun.inspect(e),
    };
  }
}

export async function writeMcpJson(path: string, data: McpJson): Promise<void> {
  ensureDir(join(path, ".."));
  await Bun.write(path, JSON.stringify(data, null, 2) + "\n");
}

export function resolveBunPath(): string {
  return Bun.which(BUN_BINARY) || BUN_BINARY;
}

export function bridgeScriptPath(home: string = homeDir()): string {
  return join(toolsDir(home), UNIFIED_SHELL_BRIDGE);
}

/** Canonical stdio entry for unified-shell MCP server. */
export function buildUnifiedShellEntry(home: string = homeDir()): McpServerEntry {
  return {
    name: UNIFIED_SHELL_SERVER,
    command: resolveBunPath(),
    args: ["run", bridgeScriptPath(home)],
    env: {
      TERMINAL_BINDING_ENABLED: "true",
      KIMI_SHELL_MODE: "unified",
    },
    description: "Unified Shell Bridge: Bun-native shell execution with signal handling",
  };
}

/** Canonical remote entry for Cloudflare API MCP server (Code Mode). */
export function buildCloudflareApiEntry(): McpServerEntry {
  return {
    name: CLOUDFLARE_API_SERVER,
    url: CLOUDFLARE_MCP_URL,
    description: "Cloudflare API: search and execute against the full Cloudflare API via Code Mode",
  };
}

/** Canonical remote entry for Bun documentation MCP (SSE JSON-RPC). */
export function buildBunDocsEntry(): McpServerEntry {
  return {
    name: BUN_DOCS_SERVER,
    url: BUN_DOCS_MCP_URL,
    description: "Bun docs MCP: search_bun + query_docs_filesystem_bun",
  };
}

function unifiedShellNeedsRefresh(
  existing: McpServerEntry | undefined,
  expected: McpServerEntry
): boolean {
  if (!existing) return true;
  const expectedArgs = expected.args?.join(" ") ?? "";
  const existingArgs = existing.args?.join(" ") ?? "";
  if (!existingArgs.includes(UNIFIED_SHELL_BRIDGE)) return true;
  if (existing.command !== expected.command) return true;
  const scriptPath = expected.args?.[1] ?? "";
  if (!existingArgs.includes(scriptPath) && existingArgs !== expectedArgs) return true;
  return false;
}

function cloudflareApiNeedsRefresh(
  existing: McpServerEntry | undefined,
  expected: McpServerEntry
): boolean {
  if (!existing) return true;
  if (existing.url !== expected.url) return true;
  return false;
}

function bunDocsNeedsRefresh(
  existing: McpServerEntry | undefined,
  expected: McpServerEntry
): boolean {
  if (!existing) return true;
  if (existing.url !== expected.url) return true;
  return false;
}

function remoteRegistryEntryNeedsRefresh(
  existing: McpServerEntry | undefined,
  def: McpServerDefinition
): boolean {
  if (!existing) return true;
  if (def.url && existing.url !== def.url) return true;
  return false;
}

/** Merge toolchain MCP servers into mcpServers without removing other servers. */
export function mergeToolchainMcpServers(
  existing: McpJson | null,
  home: string = homeDir()
): { config: McpJson; changed: boolean } {
  const config: McpJson = {
    mcpServers: existing?.mcpServers ? { ...existing.mcpServers } : {},
  };
  let changed = false;

  const unifiedShell = buildUnifiedShellEntry(home);
  if (unifiedShellNeedsRefresh(config.mcpServers[UNIFIED_SHELL_SERVER], unifiedShell)) {
    config.mcpServers[UNIFIED_SHELL_SERVER] = unifiedShell;
    changed = true;
  }

  const cloudflareApi = buildCloudflareApiEntry();
  if (cloudflareApiNeedsRefresh(config.mcpServers[CLOUDFLARE_API_SERVER], cloudflareApi)) {
    config.mcpServers[CLOUDFLARE_API_SERVER] = cloudflareApi;
    changed = true;
  }

  const bunDocs = buildBunDocsEntry();
  if (bunDocsNeedsRefresh(config.mcpServers[BUN_DOCS_SERVER], bunDocs)) {
    config.mcpServers[BUN_DOCS_SERVER] = bunDocs;
    changed = true;
  }

  return { config, changed };
}

/** Registry-aware merge that also includes user-defined ~/.kimi-code/mcp-servers/*.toml. */
export async function mergeRegistryMcpServers(
  existing: McpJson | null,
  home: string = homeDir()
): Promise<{ config: McpJson; changed: boolean }> {
  const config: McpJson = {
    mcpServers: existing?.mcpServers ? { ...existing.mcpServers } : {},
    profiles: existing?.profiles ? { ...existing.profiles } : {},
  };
  let changed = false;

  const registry = await loadMcpRegistry(home);
  for (const [name, def] of Object.entries(registry.servers)) {
    if (def.default === false) continue;
    const existing = config.mcpServers[name];
    if (!existing) {
      config.mcpServers[name] = def;
      changed = true;
      continue;
    }
    if (def.url && remoteRegistryEntryNeedsRefresh(existing, def)) {
      config.mcpServers[name] = { ...existing, ...def };
      changed = true;
    }
  }

  return { config, changed };
}

/** @deprecated Use mergeToolchainMcpServers instead. */
export function mergeUnifiedShellServer(
  existing: McpJson | null,
  home: string = homeDir()
): { config: McpJson; changed: boolean } {
  return mergeToolchainMcpServers(existing, home);
}

export async function provisionUserMcp(home: string = homeDir()): Promise<{
  path: string;
  changed: boolean;
}> {
  const path = userMcpPath();
  const { data: existing } = await readMcpJson(path);
  const { config, changed } = await mergeRegistryMcpServers(existing, home);
  if (changed || !pathExists(path)) {
    await writeMcpJson(path, config);
    return { path, changed: true };
  }
  return { path, changed: false };
}

export async function validateMcpConfig(
  home: string = homeDir(),
  projectRoot?: string,
  options: { probe?: boolean; profile?: string; catalog?: boolean } = {}
): Promise<McpValidationReport> {
  const checks: McpCheck[] = [];
  const discoveredTools: Record<string, string[]> = {};
  const blockedTools: Record<string, string[]> = {};
  const userPath = userMcpPath();
  const projectPath = projectRoot ? projectMcpPath(projectRoot) : null;
  const bridgePath = bridgeScriptPath(home);
  const activeProfile = options.profile;

  const registry = await loadMcpRegistry(home);

  const { data: userMcp, error: userReadError } = await readMcpJson(userPath);
  if (pathExists(userPath)) {
    checks.push({
      name: "mcp-user",
      status: userReadError ? "warn" : "ok",
      message: userReadError ? `${userPath} — invalid JSON: ${userReadError}` : userPath,
      fixable: false,
    });
  } else {
    checks.push({
      name: "mcp-user",
      status: "error",
      message: "missing — run bun run sync or kimi-doctor --fix",
      fixable: true,
    });
  }

  // Validate each configured server.
  const configuredServers = userMcp?.mcpServers ?? {};
  for (const [name, entry] of Object.entries(configuredServers)) {
    const checkName =
      name === UNIFIED_SHELL_SERVER
        ? "unified-shell"
        : name === CLOUDFLARE_API_SERVER
          ? "cloudflare-api-mcp"
          : name === BUN_DOCS_SERVER
            ? "bun-docs-mcp"
            : `mcp-server-${name}`;

    if (entry.enabled === false) {
      checks.push({
        name: checkName,
        server: name,
        status: "ok",
        message: "disabled",
        fixable: false,
      });
      continue;
    }

    const registered = registry.servers[name];
    if (!registered && !entry.command && !entry.url) {
      checks.push({
        name: checkName,
        server: name,
        status: "warn",
        message: "custom server not in registry and missing command/url",
        fixable: false,
      });
      continue;
    }

    const requiredEnv = registered?.requiredEnv ?? [];
    const missingEnv = requiredEnv.filter((envName) => !Bun.env[envName]);
    if (missingEnv.length > 0) {
      checks.push({
        name: checkName,
        server: name,
        status: "warn",
        message: `missing env: ${missingEnv.join(", ")}`,
        fixable: false,
      });
      continue;
    }

    if (options.probe && (entry.command || entry.url)) {
      const merged: McpServerDefinition = { ...(registered ?? { name }), ...entry };
      const probe = await probeMcpServerCached(
        merged,
        entry.startupTimeoutMs ?? registered?.startupTimeoutMs
      );
      if (probe.ok) {
        discoveredTools[name] = probe.tools ?? [];
        const meta = mcpEndpointForServer(name, home);
        const drift = meta ? validateDiscoveredTools(meta, probe.tools ?? []) : null;
        checks.push({
          name: checkName,
          server: name,
          status: "ok",
          message:
            drift && drift.missing.length > 0
              ? `probed (${probe.tools?.length ?? 0} tool(s); missing catalog: ${drift.missing.join(", ")})`
              : `probed (${probe.tools?.length ?? 0} tool(s))`,
          fixable: false,
        });
      } else {
        checks.push({
          name: checkName,
          server: name,
          status: "warn",
          message: `probe failed: ${probe.error}`,
          fixable: false,
        });
      }
    } else {
      checks.push({
        name: checkName,
        server: name,
        status: "ok",
        message: registered
          ? `registered${registered.description ? ` — ${registered.description}` : ""}`
          : "registered (custom)",
        fixable: false,
      });
    }

    // Tool-level governance.
    const knownTools = discoveredTools[name] ?? [];
    const enabledTools = entry.enabledTools ?? registered?.enabledTools;
    const disabledTools = entry.disabledTools ?? registered?.disabledTools ?? [];
    if (enabledTools && knownTools.length > 0) {
      const unexpected = knownTools.filter((tool) => !enabledTools.includes(tool));
      if (unexpected.length > 0) {
        blockedTools[name] = [...(blockedTools[name] ?? []), ...unexpected];
        checks.push({
          name: `${checkName}-tool-governance`,
          server: name,
          status: "warn",
          message: `${unexpected.length} tool(s) not in enabledTools allowlist`,
          fixable: false,
        });
      }
    }
    if (disabledTools.length > 0 && knownTools.length > 0) {
      const blocked = knownTools.filter((tool) => disabledTools.includes(tool));
      if (blocked.length > 0) {
        blockedTools[name] = [...(blockedTools[name] ?? []), ...blocked];
        checks.push({
          name: `${checkName}-tool-governance`,
          server: name,
          status: "warn",
          message: `${blocked.length} tool(s) in disabledTools blocklist`,
          fixable: false,
        });
      }
    }
  }

  // Profile checks.
  if (activeProfile && userMcp?.profiles?.[activeProfile]) {
    const profile = userMcp.profiles[activeProfile];
    checks.push({
      name: "mcp-profile",
      profile: activeProfile,
      status: "ok",
      message: profile.description ?? `profile ${activeProfile}`,
      fixable: false,
    });
    for (const server of profile.disabledServers ?? []) {
      if (configuredServers[server]?.enabled !== false) {
        checks.push({
          name: `mcp-profile-${activeProfile}-server`,
          server,
          profile: activeProfile,
          status: "warn",
          message: `server ${server} should be disabled in profile ${activeProfile}`,
          fixable: true,
        });
      }
    }
  }

  if (pathExists(bridgePath)) {
    checks.push({
      name: "bridge-script",
      status: "ok",
      message: bridgePath,
      fixable: false,
    });
  } else {
    checks.push({
      name: "bridge-script",
      status: "error",
      message: `missing at ${bridgePath} — run bun run sync`,
      fixable: true,
    });
  }

  const bunPath = resolveBunPath();
  if (bunPath && (bunPath !== BUN_BINARY || Bun.which(BUN_BINARY))) {
    checks.push({
      name: "bun-runtime",
      status: "ok",
      message: bunPath,
      fixable: false,
    });
  } else {
    checks.push({
      name: "bun-runtime",
      status: "error",
      message: "bun not found on PATH",
      fixable: false,
    });
  }

  if (projectPath && pathExists(projectPath)) {
    const { data: projectMcp, error: projectReadError } = await readMcpJson(projectPath);
    if (!projectMcp) {
      checks.push({
        name: "mcp-project",
        status: "warn",
        message: projectReadError
          ? `${projectPath} — invalid JSON: ${projectReadError}`
          : `${projectPath} — invalid JSON`,
        fixable: false,
      });
    } else {
      const serverNames = Object.keys(projectMcp.mcpServers);
      const summary =
        serverNames.length === 0
          ? "empty stub (inherits user-level servers)"
          : `${serverNames.length} server(s): ${serverNames.join(", ")}`;
      checks.push({
        name: "mcp-project",
        status: "ok",
        message: `${projectPath} — ${summary}`,
        fixable: false,
      });

      const override = projectMcp.mcpServers[UNIFIED_SHELL_SERVER];
      if (override) {
        if (override.enabled === false) {
          checks.push({
            name: "mcp-project-override",
            status: "warn",
            message: "unified-shell disabled at project level",
            fixable: false,
          });
        } else if (!override.command && !override.url) {
          checks.push({
            name: "mcp-project-override",
            status: "error",
            message: "unified-shell override missing command or url",
            fixable: false,
          });
        } else {
          const args = override.args?.join(" ") ?? "";
          const usesBridge = args.includes(UNIFIED_SHELL_BRIDGE);
          checks.push({
            name: "mcp-project-override",
            status: usesBridge || !!override.url ? "ok" : "warn",
            message: usesBridge
              ? "unified-shell project override uses toolchain bridge"
              : "custom unified-shell override (not toolchain bridge)",
            fixable: false,
          });
        }
      }
    }
  }

  const report: McpValidationReport = {
    checks,
    userPath,
    projectPath,
    activeProfile,
    discoveredTools,
    blockedTools,
  };
  if (options.catalog !== false) {
    report.metadata = mcpCatalogSummary(home);
    report.catalog = buildBuiltinMcpCatalog(home);
  }
  return report;
}

export async function buildMcpCatalogReport(
  home: string = homeDir(),
  options: { probe?: boolean; projectRoot?: string } = {}
): Promise<McpCatalogReport> {
  const catalog = buildBuiltinMcpCatalog(home);
  const { data: userMcp } = await readMcpJson(userMcpPath());
  const configured = userMcp?.mcpServers ?? {};
  const registry = await loadMcpRegistry(home);
  const probes: McpProbeSnapshot[] = [];

  for (const meta of catalog) {
    const entry = configured[meta.serverName];
    const def = registry.servers[meta.serverName];
    const configuredFlag = !!entry;
    const enabled = entry ? entry.enabled !== false : meta.default;
    const envAvailable = def ? serverEnvAvailable(def) : true;

    if (!options.probe || !entry || !enabled || !envAvailable) {
      probes.push({
        serverName: meta.serverName,
        ok: false,
        ms: 0,
        tools: [],
        error: !configuredFlag
          ? "not configured"
          : !enabled
            ? "disabled"
            : !envAvailable
              ? `missing env: ${(def?.requiredEnv ?? []).join(", ")}`
              : "probe skipped",
        configured: configuredFlag,
        enabled,
        envAvailable,
      });
      continue;
    }

    const merged: McpServerDefinition = { ...(def ?? { name: meta.serverName }), ...entry };
    const started = Date.now();
    const result = await probeMcpServerCached(
      merged,
      entry.startupTimeoutMs ?? def?.startupTimeoutMs
    );
    const ms = Date.now() - started;
    probes.push({
      serverName: meta.serverName,
      ok: result.ok,
      ms,
      tools: result.tools ?? [],
      error: result.ok ? undefined : result.error,
      configured: true,
      enabled: true,
      envAvailable: true,
      cached: result.cached,
    });

    if (result.ok && result.tools) {
      const drift = validateDiscoveredTools(meta, result.tools);
      if (drift.missing.length > 0) {
        probes[probes.length - 1]!.error = `missing tools: ${drift.missing.join(", ")}`;
      }
    }
  }

  const report: McpCatalogReport = {
    metadata: mcpCatalogSummary(home),
    catalog,
    probes,
  };
  if (options.projectRoot) {
    report.versionPolicy = await buildMcpVersionPolicyReport(options.projectRoot);
  }
  return report;
}

export async function fixMcpConfig(
  home: string = homeDir(),
  projectRoot?: string
): Promise<{ userChanged: boolean; projectCreated: boolean }> {
  const { changed: userChanged } = await provisionUserMcp(home);

  let projectCreated = false;
  if (projectRoot) {
    const projPath = projectMcpPath(projectRoot);
    if (!pathExists(projPath)) {
      ensureDir(join(projPath, ".."));
      const stub: McpJson = {
        mcpServers: {},
      };
      await writeMcpJson(projPath, stub);
      projectCreated = true;
    }
  }

  return { userChanged, projectCreated };
}

/** Project-level mcp.json stub content for scaffolding. */
export function projectMcpStub(): string {
  return (
    JSON.stringify(
      {
        mcpServers: {},
        profiles: {
          safe: {
            description: "Disable shell execution; keep read-only tools",
            disabledServers: [UNIFIED_SHELL_SERVER],
          },
          full: {
            description: "Enable all registered servers",
            enabledServers: ["*"],
          },
        },
        _comment:
          "Project MCP servers override ${mcpPath()} entries with the same name. See UNIFIED.md.",
      },
      null,
      2
    ) + "\n"
  );
}

/** Apply a profile by mutating server enabled flags. Returns a new McpJson. */
export function applyMcpProfile(config: McpJson, profileName: string): McpJson {
  const profile = config.profiles?.[profileName];
  if (!profile) return config;

  const mcpServers: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(config.mcpServers)) {
    let enabled = entry.enabled !== false;
    if (profile.enabledServers?.includes("*")) enabled = true;
    if (profile.disabledServers?.includes(name)) enabled = false;
    if (profile.enabledServers && !profile.enabledServers.includes("*")) {
      enabled = profile.enabledServers.includes(name);
    }
    mcpServers[name] = { ...entry, enabled };
  }
  return { ...config, mcpServers };
}

/** Load an HTTP/SSE MCP client by merging registry + ~/.kimi-code/mcp.json. */
export async function loadHttpMcpClientForServer(
  serverName: string,
  home: string = homeDir()
): Promise<HttpMcpClient> {
  const registry = await loadMcpRegistry(home);
  const { data: userMcp } = await readMcpJson(userMcpPath(home));
  const registered = registry.servers[serverName];
  const configured = userMcp?.mcpServers?.[serverName];
  if (!registered && !configured?.url && !configured?.command) {
    throw new Error(`MCP server '${serverName}' not found in registry or ${userMcpPath(home)}`);
  }
  const merged: McpServerDefinition = {
    ...(registered ?? { name: serverName }),
    ...configured,
    name: serverName,
  };
  if (!merged.url) {
    throw new Error(`MCP server '${serverName}' is not an HTTP/SSE server (missing url)`);
  }
  return createHttpMcpClientFromServer(merged, { cacheDbPath: true });
}

export interface CallMcpToolOptions {
  timeoutMs?: number;
  refresh?: boolean;
}

/** Call a specific tool on a configured MCP server by name (HTTP/SSE only). */
export async function callMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  home: string = homeDir(),
  options: CallMcpToolOptions = {}
): Promise<McpToolCallResult> {
  const mcpJsonPath = userMcpPath(home);
  const registry = await loadMcpRegistry(home);
  const { data: userMcp } = await readMcpJson(mcpJsonPath);
  const registered = registry.servers[serverName];
  const configured = userMcp?.mcpServers?.[serverName];
  if (!registered && !configured?.command && !configured?.url) {
    return {
      ok: false,
      error: `MCP server '${serverName}' not found in registry or ${mcpJsonPath}`,
      latencyMs: 0,
    };
  }
  const merged: McpServerDefinition = { ...(registered ?? { name: serverName }), ...configured };
  if (merged.enabled === false) {
    return { ok: false, error: `MCP server '${serverName}' is disabled`, latencyMs: 0 };
  }
  const requiredEnv = merged.requiredEnv ?? registered?.requiredEnv ?? [];
  const missingEnv = requiredEnv.filter((name) => !Bun.env[name]);
  if (missingEnv.length > 0) {
    return {
      ok: false,
      error: `missing env: ${missingEnv.join(", ")}`,
      latencyMs: 0,
    };
  }
  if (!merged.url) {
    return {
      ok: false,
      error: `MCP server '${serverName}' is not an HTTP/SSE server (missing url)`,
      latencyMs: 0,
    };
  }
  if (options.refresh) {
    clearPersistentMcpCacheForUrl(merged.url);
  }
  const timeoutMs =
    options.timeoutMs ??
    merged.toolTimeoutMs ??
    registered?.toolTimeoutMs ??
    MCP_DEFAULTS.callTimeoutMs;
  return callMcpToolHttp(merged, toolName, args, timeoutMs, { refresh: options.refresh });
}
