/**
 * Read-only Cloudflare integration inventory for the DX homepage/status surface.
 */

import {
  checkDxCloudflareConfig,
  type DxCloudflareContractReport,
} from "./dx-cloudflare-config.ts";
import { CREDENTIAL_SERVICE } from "./cloudflare-access.ts";
import {
  CLOUDFLARE_API_SERVER,
  CLOUDFLARE_MCP_URL,
  readMcpJson,
  UNIFIED_SHELL_SERVER,
  type McpCheck,
} from "./mcp-config.ts";

type Status = "ok" | "warn" | "error" | "info";
type SafetyClass = "read_only" | "plan_only" | "manual_apply" | "blocked";

export interface CloudflareCredentialStatus {
  source: "env" | "secrets" | "partial" | "missing";
  usable: boolean;
  accountIdEnvPresent: boolean;
  apiTokenEnvPresent: boolean;
  accountIdSecretPresent: boolean;
  apiTokenSecretPresent: boolean;
  service: string;
}

export interface CloudflareMcpStatus {
  userPath: string;
  projectPath: string;
  userConfigPresent: boolean;
  projectConfigPresent: boolean;
  serverNames: string[];
  projectServerNames: string[];
  cloudflareApiConfigured: boolean;
  unifiedShellConfigured: boolean;
  cloudflareApiUrl: string;
  checks: McpCheck[];
}

export interface CloudflareProjectFileStatus {
  wranglerConfig: string | null;
  accessPolicy: string | null;
}

export interface WranglerStatus {
  available: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export interface CloudflareStatusAction {
  title: string;
  safety: SafetyClass;
  command: string;
  reason: string;
}

export interface CloudflareIntegrationStatus {
  schemaVersion: 1;
  projectRoot: string;
  home: string;
  generatedAt: string;
  overall: Status;
  credentials: CloudflareCredentialStatus;
  mcp: CloudflareMcpStatus;
  projectFiles: CloudflareProjectFileStatus;
  wrangler: WranglerStatus;
  dxCloudflare: DxCloudflareContractReport;
  actions: CloudflareStatusAction[];
}

export interface CloudflareIntegrationStatusOptions {
  projectRoot?: string;
  home?: string;
  env?: Record<string, string | undefined>;
  secrets?: {
    get: (opts: { service: string; name: string }) => Promise<string | null>;
  };
  detectWrangler?: () => Promise<WranglerStatus>;
  now?: () => Date;
}

async function fileExists(path: string): Promise<boolean> {
  return await Bun.file(path).exists();
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    if (await fileExists(path)) return path;
  }
  return null;
}

async function secretExists(
  secrets: NonNullable<CloudflareIntegrationStatusOptions["secrets"]>,
  name: string
): Promise<boolean> {
  try {
    const value = await secrets.get({ service: CREDENTIAL_SERVICE, name });
    return typeof value === "string" && value.trim() !== "";
  } catch {
    return false;
  }
}

async function inspectCredentials(
  env: Record<string, string | undefined>,
  secrets: NonNullable<CloudflareIntegrationStatusOptions["secrets"]>
): Promise<CloudflareCredentialStatus> {
  const accountIdEnvPresent = !!env.CLOUDFLARE_ACCOUNT_ID;
  const apiTokenEnvPresent = !!env.CLOUDFLARE_API_TOKEN;
  const [accountIdSecretPresent, apiTokenSecretPresent] = await Promise.all([
    secretExists(secrets, "cloudflare-account-id"),
    secretExists(secrets, "cloudflare-api-token"),
  ]);
  const envUsable = accountIdEnvPresent && apiTokenEnvPresent;
  const secretsUsable = accountIdSecretPresent && apiTokenSecretPresent;
  const anyPresent =
    accountIdEnvPresent || apiTokenEnvPresent || accountIdSecretPresent || apiTokenSecretPresent;

  return {
    source: envUsable ? "env" : secretsUsable ? "secrets" : anyPresent ? "partial" : "missing",
    usable: envUsable || secretsUsable,
    accountIdEnvPresent,
    apiTokenEnvPresent,
    accountIdSecretPresent,
    apiTokenSecretPresent,
    service: CREDENTIAL_SERVICE,
  };
}

async function defaultDetectWrangler(): Promise<WranglerStatus> {
  const path = Bun.which("wrangler");
  if (!path) return { available: false };

  try {
    const proc = Bun.spawn([path, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exit = await proc.exited;
    const stdout = (await Bun.readableStreamToText(proc.stdout)).trim();
    const stderr = (await Bun.readableStreamToText(proc.stderr)).trim();
    if (exit !== 0) {
      return { available: true, path, error: stderr || `wrangler exited ${exit}` };
    }
    return { available: true, path, version: stdout || undefined };
  } catch (error) {
    return { available: true, path, error: error instanceof Error ? error.message : String(error) };
  }
}

function mcpCheck(name: string, status: Status, message: string, fixable: boolean): McpCheck {
  return {
    name,
    status: status === "info" ? "ok" : status,
    message,
    fixable,
  };
}

async function inspectMcp(home: string, projectRoot: string): Promise<CloudflareMcpStatus> {
  const userPath = `${home}/.kimi-code/mcp.json`;
  const projectPath = `${projectRoot}/.kimi-code/mcp.json`;
  const [userConfigPresent, projectConfigPresent] = await Promise.all([
    fileExists(userPath),
    fileExists(projectPath),
  ]);
  const [userMcp, projectMcp] = await Promise.all([
    readMcpJson(userPath),
    readMcpJson(projectPath),
  ]);
  const serverNames = Object.keys(userMcp.data?.mcpServers ?? {}).sort();
  const projectServerNames = Object.keys(projectMcp.data?.mcpServers ?? {}).sort();
  const cloudflareEntry = userMcp.data?.mcpServers[CLOUDFLARE_API_SERVER];
  const unifiedShellEntry = userMcp.data?.mcpServers[UNIFIED_SHELL_SERVER];
  const checks: McpCheck[] = [
    mcpCheck(
      "mcp-user",
      userConfigPresent ? (userMcp.error ? "warn" : "ok") : "error",
      userMcp.error ?? (userConfigPresent ? userPath : "missing user MCP config"),
      !userConfigPresent
    ),
    mcpCheck(
      "cloudflare-api-mcp",
      cloudflareEntry ? "ok" : "warn",
      cloudflareEntry?.url
        ? `registered at ${cloudflareEntry.url}`
        : "not configured in user MCP servers",
      !cloudflareEntry
    ),
    mcpCheck(
      "unified-shell",
      unifiedShellEntry ? "ok" : "warn",
      unifiedShellEntry ? "registered" : "not configured in user MCP servers",
      !unifiedShellEntry
    ),
    mcpCheck(
      "mcp-project",
      projectConfigPresent ? (projectMcp.error ? "warn" : "ok") : "info",
      projectMcp.error ??
        (projectConfigPresent
          ? projectServerNames.length === 0
            ? "empty project stub"
            : `${projectServerNames.length} project server(s)`
          : "no project MCP override"),
      false
    ),
  ];

  return {
    userPath,
    projectPath,
    userConfigPresent,
    projectConfigPresent,
    serverNames,
    projectServerNames,
    cloudflareApiConfigured: !!cloudflareEntry,
    unifiedShellConfigured: !!unifiedShellEntry,
    cloudflareApiUrl: cloudflareEntry?.url ?? CLOUDFLARE_MCP_URL,
    checks,
  };
}

function deriveOverall(status: CloudflareIntegrationStatus): Status {
  if (status.dxCloudflare.checks.some((check) => check.status === "error")) return "error";
  if (!status.credentials.usable) return "warn";
  if (!status.mcp.cloudflareApiConfigured || !status.wrangler.available) return "warn";
  if (!status.dxCloudflare.aligned) return "warn";
  return "ok";
}

function buildActions(status: Omit<CloudflareIntegrationStatus, "overall" | "actions">) {
  const actions: CloudflareStatusAction[] = [];
  if (!status.credentials.usable) {
    actions.push({
      title: "Configure Cloudflare Access API credentials",
      safety: "manual_apply",
      command: "kimi-cloudflare-access login",
      reason: "Access API credential status is missing or partial",
    });
  }
  if (!status.mcp.cloudflareApiConfigured || !status.mcp.unifiedShellConfigured) {
    actions.push({
      title: "Repair user MCP config",
      safety: "manual_apply",
      command: "kimi-doctor --fix",
      reason: "Cloudflare API MCP or unified-shell is not configured",
    });
  }
  if (!status.dxCloudflare.aligned) {
    actions.push({
      title: "Align DX Cloudflare defaults",
      safety: "manual_apply",
      command: "align dx.config.toml Cloudflare dashboard defaults",
      reason: "Project DX Cloudflare contract has drift",
    });
  }
  if (!status.projectFiles.wranglerConfig) {
    actions.push({
      title: "Plan hosted dashboard Worker or Pages config",
      safety: "plan_only",
      command: "create wrangler config proposal",
      reason: "No local Wrangler config declares the future homepage deployment target",
    });
  }
  if (!status.projectFiles.accessPolicy) {
    actions.push({
      title: "Plan Access policy as code",
      safety: "plan_only",
      command: "create .cloudflare-access.yml proposal",
      reason: "No repo-local Cloudflare Access policy file is present",
    });
  }
  return actions;
}

export async function buildCloudflareIntegrationStatus(
  options: CloudflareIntegrationStatusOptions = {}
): Promise<CloudflareIntegrationStatus> {
  const projectRoot = options.projectRoot ?? Bun.cwd;
  const home = options.home ?? Bun.env.HOME ?? "/tmp";
  const env = options.env ?? Bun.env;
  const secrets = options.secrets ?? Bun.secrets;
  const now = options.now ?? (() => new Date());
  const [credentials, mcp, dxCloudflare, wranglerConfig, accessPolicy, wrangler] =
    await Promise.all([
      inspectCredentials(env, secrets),
      inspectMcp(home, projectRoot),
      checkDxCloudflareConfig(projectRoot),
      firstExisting([
        `${projectRoot}/wrangler.toml`,
        `${projectRoot}/wrangler.json`,
        `${projectRoot}/wrangler.jsonc`,
      ]),
      firstExisting([
        `${projectRoot}/.cloudflare-access.yml`,
        `${projectRoot}/.cloudflare-access.yaml`,
        `${projectRoot}/.cloudflare-access.json`,
      ]),
      (options.detectWrangler ?? defaultDetectWrangler)(),
    ]);

  const base = {
    schemaVersion: 1 as const,
    projectRoot,
    home,
    generatedAt: now().toISOString(),
    credentials,
    mcp,
    projectFiles: {
      wranglerConfig,
      accessPolicy,
    },
    wrangler,
    dxCloudflare,
  };
  const actions = buildActions(base);
  const status = {
    ...base,
    overall: "info" as Status,
    actions,
  };
  return {
    ...status,
    overall: deriveOverall(status),
  };
}
