/**
 * DX Cloudflare config contract.
 *
 * Pure parser/evaluator for the future DX dashboard/homepage surface. This
 * intentionally does not call Cloudflare, Wrangler, MCP, or the filesystem
 * except in checkDxCloudflareConfig().
 */

import { existsSync } from "fs";
import { join } from "path";
import { CLOUDFLARE_API_SERVER, CLOUDFLARE_MCP_URL } from "./mcp-config.ts";

type Status = "ok" | "warn" | "error";
type UnknownRecord = Record<string, unknown>;

export type DxCloudflareMode = "read-only" | "plan-only" | "manual-apply";
export type DxCloudflareDashboardSource = "snapshot" | "live-api";
export type DxCloudflareDashboardAccess = "cloudflare-sso" | "private";
export type DxCloudflareTlsMode = "managed" | "strict";
export type DxCloudflareMcpAuth = "cloudflare-sso-oauth" | "manual";
export type DxCloudflareMutationMode = "manual-script" | "disabled";

export interface DxCloudflareDashboardConfig {
  enabled: boolean;
  title: string;
  homepagePath: string;
  source: DxCloudflareDashboardSource;
  snapshotCommand: string;
  access: DxCloudflareDashboardAccess;
}

export interface DxCloudflareDomainConfig {
  managed: boolean;
  zone: string | null;
  hostname: string | null;
  accessRequired: boolean;
  tls: DxCloudflareTlsMode;
}

export interface DxCloudflareAccessConfig {
  policyFile: string;
  appLauncherVisible: boolean;
  sessionDuration: string;
}

export interface DxCloudflareMcpConfig {
  server: string;
  url: string;
  auth: DxCloudflareMcpAuth;
  readOnlyByDefault: boolean;
  mutationMode: DxCloudflareMutationMode;
}

export interface DxCloudflareConfig {
  mode: DxCloudflareMode;
  accountIdEnv: string;
  apiTokenEnv: string;
  dashboard: DxCloudflareDashboardConfig;
  domain: DxCloudflareDomainConfig;
  access: DxCloudflareAccessConfig;
  mcp: DxCloudflareMcpConfig;
}

export interface DxCloudflareParseIssue {
  path: string;
  expected: string;
  actual: string;
}

export interface DxCloudflareParseResult {
  config: DxCloudflareConfig;
  issues: DxCloudflareParseIssue[];
}

export interface DxCloudflareContractCheck {
  name: string;
  status: Status;
  message: string;
  fixable: boolean;
}

export interface DxCloudflareContractReport {
  applicable: boolean;
  aligned: boolean;
  checks: DxCloudflareContractCheck[];
}

export const DEFAULT_DX_CLOUDFLARE_CONFIG: DxCloudflareConfig = {
  mode: "read-only",
  accountIdEnv: "CLOUDFLARE_ACCOUNT_ID",
  apiTokenEnv: "CLOUDFLARE_API_TOKEN",
  dashboard: {
    enabled: true,
    title: "DX Dashboard",
    homepagePath: "/",
    source: "snapshot",
    snapshotCommand: "kimi-cloudflare-access dashboard --json",
    access: "cloudflare-sso",
  },
  domain: {
    managed: true,
    zone: null,
    hostname: null,
    accessRequired: true,
    tls: "managed",
  },
  access: {
    policyFile: ".cloudflare-access.yml",
    appLauncherVisible: true,
    sessionDuration: "24h",
  },
  mcp: {
    server: CLOUDFLARE_API_SERVER,
    url: CLOUDFLARE_MCP_URL,
    auth: "cloudflare-sso-oauth",
    readOnlyByDefault: true,
    mutationMode: "manual-script",
  },
} as const;

function record(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function actualType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function stringValue(
  source: UnknownRecord,
  key: string,
  fallback: string,
  path: string,
  issues: DxCloudflareParseIssue[]
): string {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  issues.push({ path, expected: "non-empty string", actual: actualType(value) });
  return fallback;
}

function nullableStringValue(
  source: UnknownRecord,
  key: string,
  fallback: string | null,
  path: string,
  issues: DxCloudflareParseIssue[]
): string | null {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value === "string") return value.trim() || null;
  issues.push({ path, expected: "string", actual: actualType(value) });
  return fallback;
}

function booleanValue(
  source: UnknownRecord,
  key: string,
  fallback: boolean,
  path: string,
  issues: DxCloudflareParseIssue[]
): boolean {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  issues.push({ path, expected: "boolean", actual: actualType(value) });
  return fallback;
}

function enumValue<T extends string>(
  source: UnknownRecord,
  key: string,
  allowed: readonly T[],
  fallback: T,
  path: string,
  issues: DxCloudflareParseIssue[]
): T {
  const value = source[key];
  if (value === undefined) return fallback;
  if (typeof value === "string" && allowed.includes(value as T)) return value as T;
  issues.push({ path, expected: allowed.join(" | "), actual: String(value) });
  return fallback;
}

export function hasDxCloudflareConfig(raw: UnknownRecord): boolean {
  return Object.hasOwn(raw, "cloudflare");
}

export function parseDxCloudflareConfig(raw: unknown): DxCloudflareParseResult {
  const root = record(raw);
  const cloudflare = record(root.cloudflare);
  const dashboard = record(cloudflare.dashboard);
  const domain = record(cloudflare.domain);
  const access = record(cloudflare.access);
  const mcp = record(cloudflare.mcp);
  const issues: DxCloudflareParseIssue[] = [];
  const defaults = DEFAULT_DX_CLOUDFLARE_CONFIG;

  return {
    issues,
    config: {
      mode: enumValue(
        cloudflare,
        "mode",
        ["read-only", "plan-only", "manual-apply"],
        defaults.mode,
        "cloudflare.mode",
        issues
      ),
      accountIdEnv: stringValue(
        cloudflare,
        "accountIdEnv",
        defaults.accountIdEnv,
        "cloudflare.accountIdEnv",
        issues
      ),
      apiTokenEnv: stringValue(
        cloudflare,
        "apiTokenEnv",
        defaults.apiTokenEnv,
        "cloudflare.apiTokenEnv",
        issues
      ),
      dashboard: {
        enabled: booleanValue(
          dashboard,
          "enabled",
          defaults.dashboard.enabled,
          "cloudflare.dashboard.enabled",
          issues
        ),
        title: stringValue(
          dashboard,
          "title",
          defaults.dashboard.title,
          "cloudflare.dashboard.title",
          issues
        ),
        homepagePath: stringValue(
          dashboard,
          "homepagePath",
          defaults.dashboard.homepagePath,
          "cloudflare.dashboard.homepagePath",
          issues
        ),
        source: enumValue(
          dashboard,
          "source",
          ["snapshot", "live-api"],
          defaults.dashboard.source,
          "cloudflare.dashboard.source",
          issues
        ),
        snapshotCommand: stringValue(
          dashboard,
          "snapshotCommand",
          defaults.dashboard.snapshotCommand,
          "cloudflare.dashboard.snapshotCommand",
          issues
        ),
        access: enumValue(
          dashboard,
          "access",
          ["cloudflare-sso", "private"],
          defaults.dashboard.access,
          "cloudflare.dashboard.access",
          issues
        ),
      },
      domain: {
        managed: booleanValue(
          domain,
          "managed",
          defaults.domain.managed,
          "cloudflare.domain.managed",
          issues
        ),
        zone: nullableStringValue(
          domain,
          "zone",
          defaults.domain.zone,
          "cloudflare.domain.zone",
          issues
        ),
        hostname: nullableStringValue(
          domain,
          "hostname",
          defaults.domain.hostname,
          "cloudflare.domain.hostname",
          issues
        ),
        accessRequired: booleanValue(
          domain,
          "accessRequired",
          defaults.domain.accessRequired,
          "cloudflare.domain.accessRequired",
          issues
        ),
        tls: enumValue(
          domain,
          "tls",
          ["managed", "strict"],
          defaults.domain.tls,
          "cloudflare.domain.tls",
          issues
        ),
      },
      access: {
        policyFile: stringValue(
          access,
          "policyFile",
          defaults.access.policyFile,
          "cloudflare.access.policyFile",
          issues
        ),
        appLauncherVisible: booleanValue(
          access,
          "appLauncherVisible",
          defaults.access.appLauncherVisible,
          "cloudflare.access.appLauncherVisible",
          issues
        ),
        sessionDuration: stringValue(
          access,
          "sessionDuration",
          defaults.access.sessionDuration,
          "cloudflare.access.sessionDuration",
          issues
        ),
      },
      mcp: {
        server: stringValue(mcp, "server", defaults.mcp.server, "cloudflare.mcp.server", issues),
        url: stringValue(mcp, "url", defaults.mcp.url, "cloudflare.mcp.url", issues),
        auth: enumValue(
          mcp,
          "auth",
          ["cloudflare-sso-oauth", "manual"],
          defaults.mcp.auth,
          "cloudflare.mcp.auth",
          issues
        ),
        readOnlyByDefault: booleanValue(
          mcp,
          "readOnlyByDefault",
          defaults.mcp.readOnlyByDefault,
          "cloudflare.mcp.readOnlyByDefault",
          issues
        ),
        mutationMode: enumValue(
          mcp,
          "mutationMode",
          ["manual-script", "disabled"],
          defaults.mcp.mutationMode,
          "cloudflare.mcp.mutationMode",
          issues
        ),
      },
    },
  };
}

function ok(name: string, message: string): DxCloudflareContractCheck {
  return { name, status: "ok", message, fixable: false };
}

function warn(name: string, message: string): DxCloudflareContractCheck {
  return { name, status: "warn", message, fixable: true };
}

export function evaluateDxCloudflareConfig(
  result: DxCloudflareParseResult
): DxCloudflareContractReport {
  const checks: DxCloudflareContractCheck[] = [
    ok("cloudflare-config", "present"),
    ...result.issues.map((issue) =>
      warn(issue.path, `expected ${issue.expected}, got ${issue.actual}`)
    ),
  ];
  const { config } = result;

  checks.push(
    config.mode === "read-only" || config.mode === "plan-only"
      ? ok("cloudflare.mode", config.mode)
      : warn("cloudflare.mode", "default posture should stay read-only or plan-only")
  );
  checks.push(
    config.accountIdEnv === DEFAULT_DX_CLOUDFLARE_CONFIG.accountIdEnv
      ? ok("cloudflare.accountIdEnv", config.accountIdEnv)
      : warn("cloudflare.accountIdEnv", `expected ${DEFAULT_DX_CLOUDFLARE_CONFIG.accountIdEnv}`)
  );
  checks.push(
    config.apiTokenEnv === DEFAULT_DX_CLOUDFLARE_CONFIG.apiTokenEnv
      ? ok("cloudflare.apiTokenEnv", config.apiTokenEnv)
      : warn("cloudflare.apiTokenEnv", `expected ${DEFAULT_DX_CLOUDFLARE_CONFIG.apiTokenEnv}`)
  );
  checks.push(
    config.dashboard.enabled
      ? ok("cloudflare.dashboard.enabled", "dashboard contract enabled")
      : warn("cloudflare.dashboard.enabled", "dashboard contract disabled")
  );
  checks.push(
    config.dashboard.access === "cloudflare-sso"
      ? ok("cloudflare.dashboard.access", "cloudflare-sso")
      : warn("cloudflare.dashboard.access", "expected cloudflare-sso")
  );
  checks.push(
    config.dashboard.source === "snapshot"
      ? ok("cloudflare.dashboard.source", "snapshot")
      : warn("cloudflare.dashboard.source", "expected snapshot source for repo-local dashboard")
  );
  checks.push(
    config.dashboard.snapshotCommand === DEFAULT_DX_CLOUDFLARE_CONFIG.dashboard.snapshotCommand
      ? ok("cloudflare.dashboard.snapshotCommand", config.dashboard.snapshotCommand)
      : warn(
          "cloudflare.dashboard.snapshotCommand",
          `expected ${DEFAULT_DX_CLOUDFLARE_CONFIG.dashboard.snapshotCommand}`
        )
  );
  checks.push(
    config.domain.managed
      ? ok("cloudflare.domain.managed", "true")
      : warn("cloudflare.domain.managed", "expected true")
  );
  checks.push(
    config.domain.accessRequired
      ? ok("cloudflare.domain.accessRequired", "true")
      : warn("cloudflare.domain.accessRequired", "expected true")
  );
  checks.push(
    config.access.policyFile === DEFAULT_DX_CLOUDFLARE_CONFIG.access.policyFile
      ? ok("cloudflare.access.policyFile", config.access.policyFile)
      : warn(
          "cloudflare.access.policyFile",
          `expected ${DEFAULT_DX_CLOUDFLARE_CONFIG.access.policyFile}`
        )
  );
  checks.push(
    config.mcp.server === DEFAULT_DX_CLOUDFLARE_CONFIG.mcp.server
      ? ok("cloudflare.mcp.server", config.mcp.server)
      : warn("cloudflare.mcp.server", `expected ${DEFAULT_DX_CLOUDFLARE_CONFIG.mcp.server}`)
  );
  checks.push(
    config.mcp.url === DEFAULT_DX_CLOUDFLARE_CONFIG.mcp.url
      ? ok("cloudflare.mcp.url", config.mcp.url)
      : warn("cloudflare.mcp.url", `expected ${DEFAULT_DX_CLOUDFLARE_CONFIG.mcp.url}`)
  );
  checks.push(
    config.mcp.auth === "cloudflare-sso-oauth"
      ? ok("cloudflare.mcp.auth", "cloudflare-sso-oauth")
      : warn("cloudflare.mcp.auth", "expected cloudflare-sso-oauth")
  );
  checks.push(
    config.mcp.readOnlyByDefault
      ? ok("cloudflare.mcp.readOnlyByDefault", "true")
      : warn("cloudflare.mcp.readOnlyByDefault", "expected true")
  );
  checks.push(
    config.mcp.mutationMode === "manual-script" || config.mcp.mutationMode === "disabled"
      ? ok("cloudflare.mcp.mutationMode", config.mcp.mutationMode)
      : warn("cloudflare.mcp.mutationMode", "expected manual-script or disabled")
  );

  return {
    applicable: true,
    aligned: checks.every((check) => check.status === "ok"),
    checks,
  };
}

export async function checkDxCloudflareConfig(
  projectRoot: string
): Promise<DxCloudflareContractReport> {
  const dxPath = join(projectRoot, "dx.config.toml");
  if (!existsSync(dxPath)) return { applicable: false, aligned: true, checks: [] };

  let raw: UnknownRecord;
  try {
    raw = record(Bun.TOML.parse(await Bun.file(dxPath).text()));
  } catch {
    return {
      applicable: true,
      aligned: false,
      checks: [{ name: "dx-config", status: "error", message: "invalid TOML", fixable: true }],
    };
  }

  if (!hasDxCloudflareConfig(raw)) return { applicable: false, aligned: true, checks: [] };
  return evaluateDxCloudflareConfig(parseDxCloudflareConfig(raw));
}
