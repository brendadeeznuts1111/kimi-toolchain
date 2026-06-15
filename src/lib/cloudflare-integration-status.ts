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
import { loadIdentityMatrix } from "./identity-matrix.ts";
import { globalDxConfigPath } from "./paths.ts";

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

export interface CloudflareIdentityStatus {
  configured: boolean;
  profileCount: number;
  sources: string[];
}

export interface CloudflareStatusDiagnostic {
  source: "credentials" | "mcp" | "dx" | "policy" | "identity" | "wrangler";
  code: string;
  status: Status;
  message: string;
  fixable: boolean;
  safety: SafetyClass;
  command?: string;
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
  identity: CloudflareIdentityStatus;
  dxCloudflare: DxCloudflareContractReport;
  diagnostics: CloudflareStatusDiagnostic[];
  actions: CloudflareStatusAction[];
  summary: {
    errors: number;
    warnings: number;
    actions: number;
  };
}

export interface CloudflareIntegrationStatusOptions {
  projectRoot?: string;
  home?: string;
  env?: Record<string, string | undefined>;
  secrets?: {
    get: (opts: { service: string; name: string }) => Promise<string | null>;
  };
  detectWrangler?: () => Promise<WranglerStatus>;
  includeToolVersions?: boolean;
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

async function defaultDetectWrangler(includeVersion = false): Promise<WranglerStatus> {
  const path = Bun.which("wrangler");
  if (!path) return { available: false };
  if (!includeVersion) return { available: true, path };

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

async function inspectIdentity(
  home: string,
  projectRoot: string
): Promise<CloudflareIdentityStatus> {
  const matrix = await loadIdentityMatrix({
    configPaths: [globalDxConfigPath(home), `${projectRoot}/dx.config.toml`],
  });
  return {
    configured: matrix.profiles.length > 0,
    profileCount: matrix.profiles.length,
    sources: matrix.sources,
  };
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
      userConfigPresent ? (userMcp.error ? "warn" : "ok") : "warn",
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
  if (status.diagnostics.some((diagnostic) => diagnostic.status === "error")) return "error";
  if (status.diagnostics.some((diagnostic) => diagnostic.status === "warn")) return "warn";
  if (status.dxCloudflare.checks.some((check) => check.status === "error")) return "error";
  if (!status.credentials.usable) return "warn";
  if (!status.mcp.cloudflareApiConfigured || !status.wrangler.available) return "warn";
  if (!status.dxCloudflare.aligned) return "warn";
  return "ok";
}

function buildActions(
  status: Omit<CloudflareIntegrationStatus, "overall" | "actions" | "diagnostics" | "summary">
) {
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
  if (!status.identity.configured) {
    actions.push({
      title: "Configure DX identity profile",
      safety: "manual_apply",
      command: "kimi-identity bind --profile <name> --key <path>",
      reason: "No DX identity profiles are configured for this project",
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

function buildDiagnostics(
  status: Omit<CloudflareIntegrationStatus, "overall" | "actions" | "diagnostics" | "summary">
): CloudflareStatusDiagnostic[] {
  const diagnostics: CloudflareStatusDiagnostic[] = [];
  if (!status.credentials.usable) {
    diagnostics.push({
      source: "credentials",
      code: `cloudflare-credentials-${status.credentials.source}`,
      status: "warn",
      message: "Cloudflare Access API credentials are missing or partial",
      fixable: true,
      safety: "manual_apply",
      command: "kimi-cloudflare-access login",
    });
  }
  for (const check of status.mcp.checks) {
    if (check.status === "ok") continue;
    diagnostics.push({
      source: "mcp",
      code: `mcp-${check.name}`,
      status: check.status,
      message: check.message,
      fixable: check.fixable,
      safety: check.fixable ? "manual_apply" : "blocked",
      command: check.fixable ? "kimi-doctor --fix" : undefined,
    });
  }
  if (!status.wrangler.available || status.wrangler.error) {
    diagnostics.push({
      source: "wrangler",
      code: status.wrangler.available ? "wrangler-version-error" : "wrangler-missing",
      status: "warn",
      message: status.wrangler.error ?? "Wrangler is not available on PATH",
      fixable: !status.wrangler.available,
      safety: "manual_apply",
    });
  }
  if (!status.identity.configured) {
    diagnostics.push({
      source: "identity",
      code: "identity-matrix-missing",
      status: "warn",
      message: "No DX identity profiles are configured for this project",
      fixable: true,
      safety: "manual_apply",
      command: "kimi-identity bind --profile <name> --key <path>",
    });
  }
  for (const check of status.dxCloudflare.checks) {
    if (check.status === "ok") continue;
    diagnostics.push({
      source: "dx",
      code: `dx-cloudflare-${check.name}`,
      status: check.status,
      message: check.message,
      fixable: check.fixable,
      safety: check.fixable ? "manual_apply" : "blocked",
      command: check.fixable ? "align dx.config.toml Cloudflare dashboard defaults" : undefined,
    });
  }
  if (!status.projectFiles.wranglerConfig) {
    diagnostics.push({
      source: "policy",
      code: "dashboard-deploy-config-missing",
      status: "warn",
      message: "No local Wrangler config declares the future homepage deployment target",
      fixable: true,
      safety: "plan_only",
      command: "create wrangler config proposal",
    });
  }
  if (!status.projectFiles.accessPolicy) {
    diagnostics.push({
      source: "policy",
      code: "access-policy-config-missing",
      status: "warn",
      message: "No repo-local Cloudflare Access policy file is present",
      fixable: true,
      safety: "plan_only",
      command: "create .cloudflare-access.yml proposal",
    });
  }
  return diagnostics;
}

function summarizeStatus(
  diagnostics: CloudflareStatusDiagnostic[],
  actions: CloudflareStatusAction[]
): CloudflareIntegrationStatus["summary"] {
  return {
    errors: diagnostics.filter((diagnostic) => diagnostic.status === "error").length,
    warnings: diagnostics.filter((diagnostic) => diagnostic.status === "warn").length,
    actions: actions.length,
  };
}

export async function buildCloudflareIntegrationStatus(
  options: CloudflareIntegrationStatusOptions = {}
): Promise<CloudflareIntegrationStatus> {
  const projectRoot = options.projectRoot ?? Bun.cwd;
  const home = options.home ?? Bun.env.HOME ?? "/tmp";
  const env = options.env ?? Bun.env;
  const secrets = options.secrets ?? Bun.secrets;
  const now = options.now ?? (() => new Date());
  const [credentials, mcp, dxCloudflare, identity, wranglerConfig, accessPolicy, wrangler] =
    await Promise.all([
      inspectCredentials(env, secrets),
      inspectMcp(home, projectRoot),
      checkDxCloudflareConfig(projectRoot),
      inspectIdentity(home, projectRoot),
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
      options.detectWrangler
        ? options.detectWrangler()
        : defaultDetectWrangler(options.includeToolVersions),
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
    identity,
    dxCloudflare,
  };
  const actions = buildActions(base);
  const diagnostics = buildDiagnostics(base);
  const status = {
    ...base,
    overall: "info" as Status,
    diagnostics,
    actions,
    summary: summarizeStatus(diagnostics, actions),
  };
  return {
    ...status,
    overall: deriveOverall(status),
  };
}
