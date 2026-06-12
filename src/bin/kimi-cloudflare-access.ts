#!/usr/bin/env bun
/**
 * kimi-cloudflare-access — Cloudflare Access / Zero Trust hygiene
 * P0: Service token expiry sweep
 * P1: Access application policy audit
 * P2: Policy-as-Code (plan/apply via .cloudflare-access.yml)
 *
 * Usage:
 *   kimi-cloudflare-access [tokens|apps|doctor|fix|login|logout|plan|apply]
 *
 * Auth:
 *   1. CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN env vars (CI override)
 *   2. OS keychain via Bun.secrets (set with `kimi-cloudflare-access login`)
 *
 * Note:
 *   Wrangler OAuth tokens and the Kimi Code cloudflare-api MCP server use different
 *   auth flows. This CLI needs a dedicated Cloudflare API token from
 *   https://dash.cloudflare.com/profile/api-tokens.
 */

import { fetchWithTimeout, log, printSection, printProjectBanner } from "../lib/utils.ts";
import {
  applyDiff,
  computeDiff,
  fetchLiveState,
  loadPolicyConfig,
  parsePolicyConfig,
} from "../lib/cloudflare-access-policy.ts";
import { existsSync } from "fs";

// ── Config ───────────────────────────────────────────────────────────

const API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_WARN_DAYS = 30;

export const CREDENTIAL_SERVICE = "kimi-toolchain";
const ACCOUNT_SECRET = "cloudflare-account-id";
const TOKEN_SECRET = "cloudflare-api-token";

export interface ServiceToken {
  id: string;
  name: string;
  client_id: string;
  expires_at?: string | null;
  created_at?: string;
}

export interface AccessPolicy {
  id: string;
  name: string;
  decision: "allow" | "deny" | "bypass" | "non_identity" | "service_auth";
  include: Array<Record<string, unknown>>;
  exclude: Array<Record<string, unknown>>;
  require: Array<Record<string, unknown>>;
  reusable?: boolean;
  precedence?: number;
}

export interface AccessApplication {
  id: string;
  name: string;
  type: string;
  domain?: string;
  self_hosted_domains?: string[];
  policies: AccessPolicy[];
  allowed_idps?: string[];
  session_duration?: string;
  app_launcher_visible?: boolean;
}

export interface TokenViolation {
  token: ServiceToken;
  reason: "expired" | "expiring-soon" | "no-expiry";
  daysRemaining?: number;
}

export interface AppFinding {
  app: AccessApplication;
  policy?: AccessPolicy;
  reason:
    | "bypass"
    | "allow-everyone"
    | "no-idp-restriction"
    | "shared-service-token"
    | "redundant-service-token"
    | "long-session"
    | "missing-mfa";
  detail: string;
}

// ── Credentials ──────────────────────────────────────────────────────

export async function loadCredentialsFromSecrets(
  secrets: {
    get: (opts: { service: string; name: string }) => Promise<string | null>;
  } = Bun.secrets
): Promise<{
  accountId?: string;
  apiToken?: string;
}> {
  const accountId = await secrets.get({ service: CREDENTIAL_SERVICE, name: ACCOUNT_SECRET });
  const apiToken = await secrets.get({ service: CREDENTIAL_SERVICE, name: TOKEN_SECRET });
  return {
    accountId: typeof accountId === "string" ? accountId : undefined,
    apiToken: typeof apiToken === "string" ? apiToken : undefined,
  };
}

export async function getCredentials(
  secrets: {
    get: (opts: { service: string; name: string }) => Promise<string | null>;
  } = Bun.secrets
): Promise<{ accountId: string; apiToken: string }> {
  const accountId = Bun.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = Bun.env.CLOUDFLARE_API_TOKEN;

  if (accountId && apiToken) {
    return { accountId, apiToken };
  }

  const fromSecrets = await loadCredentialsFromSecrets(secrets);
  if (fromSecrets.accountId && fromSecrets.apiToken) {
    return { accountId: fromSecrets.accountId, apiToken: fromSecrets.apiToken };
  }

  throw new Error(
    "Missing Cloudflare credentials.\n" +
      "Run: kimi-cloudflare-access login\n" +
      "Or set env vars: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN\n" +
      "Create a token with Account > Access: Read (and Access: Edit to rotate) at https://dash.cloudflare.com/profile/api-tokens\n" +
      "Note: Wrangler OAuth / Kimi Code MCP auth is separate and cannot be used by this CLI."
  );
}

async function verifyToken(apiToken: string): Promise<{ valid: boolean; message?: string }> {
  try {
    const resp = (await fetchWithTimeout(`${API_BASE}/user/tokens/verify`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      timeoutMs: 15000,
    })) as unknown as ApiResponse<{ status: string }>;

    if (!resp.ok) {
      const text = await resp.text();
      return { valid: false, message: `Cloudflare API ${resp.status}: ${text}` };
    }

    const data = await resp.json();
    if (data.success === false) {
      const msg = data.errors?.map((e) => e.message).join("; ") || "Token verification failed";
      return { valid: false, message: msg };
    }

    return { valid: true };
  } catch (e: any) {
    return { valid: false, message: e.message };
  }
}

async function login(): Promise<void> {
  const accountId = prompt("Cloudflare Account ID:")?.trim();
  const apiToken = prompt("Cloudflare API Token:")?.trim();

  if (!accountId || !apiToken) {
    console.error("Account ID and API token are required.");
    process.exit(1);
  }

  Bun.stdout.write("Verifying token...");
  const verification = await verifyToken(apiToken);
  if (!verification.valid) {
    console.log(" failed");
    console.error(`Token verification failed: ${verification.message}`);
    process.exit(1);
  }
  console.log(" ok");

  await Bun.secrets.set({ service: CREDENTIAL_SERVICE, name: ACCOUNT_SECRET, value: accountId });
  await Bun.secrets.set({ service: CREDENTIAL_SERVICE, name: TOKEN_SECRET, value: apiToken });

  log("info", "Credentials saved to OS keychain.");
  console.log("Run `kimi-cloudflare-access logout` to remove them.");
}

async function logout(): Promise<void> {
  await Bun.secrets.delete({ service: CREDENTIAL_SERVICE, name: ACCOUNT_SECRET });
  await Bun.secrets.delete({ service: CREDENTIAL_SERVICE, name: TOKEN_SECRET });
  log("info", "Cloudflare credentials removed from OS keychain.");
}

// ── API ──────────────────────────────────────────────────────────────

type ApiResponse<T> = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<{ result?: T; success?: boolean; errors?: Array<{ message: string }> }>;
};

async function apiGet<T>(accountId: string, apiToken: string, path: string): Promise<T> {
  const url = `${API_BASE}/accounts/${accountId}${path}`;
  const resp = (await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    timeoutMs: 15000,
  })) as unknown as ApiResponse<T>;

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Cloudflare API ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  if (data.success === false) {
    const msg = data.errors?.map((e) => e.message).join("; ") || "API request failed";
    throw new Error(`Cloudflare API error: ${msg}`);
  }
  return data.result || ([] as T);
}

function isAuthError(err: unknown): boolean {
  return err instanceof Error && /\b40[13]\b|Authentication error/.test(err.message);
}

function printAuthHelp() {
  log(
    "error",
    "API token lacks Access permissions. Ensure the token has Account > Access: Read (and Access: Edit to rotate tokens)."
  );
  log("info", "Create or verify tokens at https://dash.cloudflare.com/profile/api-tokens");
}

async function listServiceTokens(accountId: string, apiToken: string): Promise<ServiceToken[]> {
  try {
    return await apiGet<ServiceToken[]>(accountId, apiToken, "/access/service_tokens");
  } catch (e: unknown) {
    if (isAuthError(e)) printAuthHelp();
    throw e;
  }
}

async function listApplications(accountId: string, apiToken: string): Promise<AccessApplication[]> {
  try {
    return await apiGet<AccessApplication[]>(accountId, apiToken, "/access/apps");
  } catch (e: unknown) {
    if (isAuthError(e)) printAuthHelp();
    throw e;
  }
}

async function rotateServiceToken(
  accountId: string,
  apiToken: string,
  tokenId: string
): Promise<{ client_id: string; client_secret: string }> {
  const url = `${API_BASE}/accounts/${accountId}/access/service_tokens/${tokenId}/refresh`;
  const resp = (await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    timeoutMs: 15000,
  })) as unknown as ApiResponse<{ client_id: string; client_secret: string }>;

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Cloudflare API ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  if (data.success === false) {
    const msg = data.errors?.map((e) => e.message).join("; ") || "API request failed";
    throw new Error(`Cloudflare API error: ${msg}`);
  }
  if (!data.result) throw new Error("API returned empty result");
  return data.result;
}

// ── Token Violation Sweep ────────────────────────────────────────────

export function checkTokenExpiry(
  tokens: ServiceToken[],
  warnDays: number = DEFAULT_WARN_DAYS
): TokenViolation[] {
  const now = Date.now();
  const violations: TokenViolation[] = [];

  for (const token of tokens) {
    if (!token.id) {
      continue;
    }

    if (!token.expires_at) {
      violations.push({ token, reason: "no-expiry" });
      continue;
    }

    const expiry = new Date(token.expires_at).getTime();
    if (Number.isNaN(expiry)) {
      violations.push({ token, reason: "no-expiry" });
      continue;
    }

    const daysRemaining = Math.floor((expiry - now) / (1000 * 60 * 60 * 24));

    if (daysRemaining < 0) {
      violations.push({ token, reason: "expired", daysRemaining });
    } else if (daysRemaining <= warnDays) {
      violations.push({ token, reason: "expiring-soon", daysRemaining });
    }
  }

  return violations;
}

function printViolations(violations: TokenViolation[]) {
  if (violations.length === 0) {
    log("info", "No service token expiry issues");
    return;
  }

  for (const v of violations) {
    const label = v.token.name || v.token.client_id || v.token.id;
    if (v.reason === "expired") {
      log("error", `${label}: expired ${Math.abs(v.daysRemaining || 0)} day(s) ago`);
    } else if (v.reason === "expiring-soon") {
      log("warn", `${label}: expires in ${v.daysRemaining} day(s)`);
    } else {
      log("warn", `${label}: no expiry set`);
    }
  }
}

// ── App Policy Audit ─────────────────────────────────────────────────

export function parseSessionHours(duration?: string): number {
  if (!duration) return 24;
  const match = duration.match(/^(\d+)h$/);
  if (match) return Number.parseInt(match[1], 10);
  const dayMatch = duration.match(/^(\d+)d$/);
  if (dayMatch) return Number.parseInt(dayMatch[1], 10) * 24;
  return 24;
}

function hasEveryone(include: Array<Record<string, unknown>>): boolean {
  return include.some((rule) => "everyone" in rule);
}

function hasServiceToken(include: Array<Record<string, unknown>>): boolean {
  return include.some((rule) => "service_token" in rule);
}

function hasMfa(require: Array<Record<string, unknown>>): boolean {
  return require.some((rule) => "auth_method" in rule || "gsuite" in rule || "azureAD" in rule);
}

export function auditApps(apps: AccessApplication[], tokens: ServiceToken[]): AppFinding[] {
  const findings: AppFinding[] = [];
  const tokenIds = new Set(tokens.map((t) => t.id));

  for (const app of apps) {
    if (!app.policies || app.policies.length === 0) {
      findings.push({
        app,
        reason: "allow-everyone",
        detail: "No policies configured",
      });
      continue;
    }

    for (const policy of app.policies) {
      if (policy.decision === "bypass") {
        findings.push({
          app,
          policy,
          reason: "bypass",
          detail: `Policy "${policy.name}" bypasses Access entirely`,
        });
        continue;
      }

      if (policy.decision !== "allow") continue;

      if (hasEveryone(policy.include)) {
        findings.push({
          app,
          policy,
          reason: "allow-everyone",
          detail: `Policy "${policy.name}" allows everyone`,
        });
      }

      if (!hasMfa(policy.require)) {
        findings.push({
          app,
          policy,
          reason: "missing-mfa",
          detail: `Policy "${policy.name}" does not require MFA`,
        });
      }

      if (hasServiceToken(policy.include)) {
        const tokenRule = policy.include.find((r) => "service_token" in r) as {
          service_token?: { token_id?: string };
        };
        const tokenId = tokenRule?.service_token?.token_id;
        if (tokenId && tokenIds.has(tokenId)) {
          if (hasEveryone(policy.include)) {
            findings.push({
              app,
              policy,
              reason: "redundant-service-token",
              detail: `Policy "${policy.name}" allows everyone, so service token ${tokenId.slice(0, 8)}... is redundant`,
            });
          } else {
            findings.push({
              app,
              policy,
              reason: "shared-service-token",
              detail: `Policy "${policy.name}" uses service token ${tokenId.slice(0, 8)}...`,
            });
          }
        }
      }
    }

    const sessionHours = parseSessionHours(app.session_duration);
    if (sessionHours > 168) {
      findings.push({
        app,
        reason: "long-session",
        detail: `Session duration ${app.session_duration} exceeds 7 days`,
      });
    }

    if (!app.allowed_idps || app.allowed_idps.length === 0) {
      const appTypesWithIdps = ["self_hosted", "saas", "ssh", "vnc"];
      if (appTypesWithIdps.includes(app.type)) {
        findings.push({
          app,
          reason: "no-idp-restriction",
          detail: "No IdP restriction configured; all account IdPs allowed",
        });
      }
    }
  }

  return findings;
}

function printAppFindings(findings: AppFinding[]) {
  if (findings.length === 0) {
    log("info", "No Access application policy issues");
    return;
  }

  const byApp = new Map<string, AppFinding[]>();
  for (const f of findings) {
    const list = byApp.get(f.app.name) || [];
    list.push(f);
    byApp.set(f.app.name, list);
  }

  for (const [appName, list] of byApp) {
    console.log(`  ${appName}`);
    for (const f of list) {
      const icon =
        f.reason === "bypass"
          ? "✗"
          : f.reason === "allow-everyone" || f.reason === "missing-mfa"
            ? "⚠"
            : "⚠";
      console.log(`    ${icon} ${f.detail}`);
    }
  }
}

// ── Doctor ───────────────────────────────────────────────────────────

async function doctor(): Promise<
  Array<{ name: string; status: "ok" | "warn" | "error"; message: string; fixable: boolean }>
> {
  const checks: Array<{
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    fixable: boolean;
  }> = [];

  let accountId: string;
  let apiToken: string;

  try {
    const creds = await getCredentials();
    accountId = creds.accountId;
    apiToken = creds.apiToken;
    checks.push({
      name: "cloudflare-credentials",
      status: "ok",
      message: "Cloudflare credentials resolved",
      fixable: false,
    });
  } catch (e: any) {
    checks.push({
      name: "cloudflare-credentials",
      status: "error",
      message: e.message.replace(/\n/g, " "),
      fixable: false,
    });
    return checks;
  }

  let tokens: ServiceToken[] = [];
  try {
    tokens = await listServiceTokens(accountId, apiToken);
    checks.push({
      name: "service-tokens-api",
      status: "ok",
      message: `Listed ${tokens.length} service token(s)`,
      fixable: false,
    });

    const violations = checkTokenExpiry(tokens);
    const expired = violations.filter((v) => v.reason === "expired").length;
    const expiring = violations.filter((v) => v.reason === "expiring-soon").length;
    const noExpiry = violations.filter((v) => v.reason === "no-expiry").length;

    if (expired > 0) {
      checks.push({
        name: "service-tokens-expired",
        status: "error",
        message: `${expired} token(s) expired`,
        fixable: true,
      });
    }
    if (expiring > 0) {
      checks.push({
        name: "service-tokens-expiring",
        status: "warn",
        message: `${expiring} token(s) expire within ${DEFAULT_WARN_DAYS} days`,
        fixable: true,
      });
    }
    if (noExpiry > 0) {
      checks.push({
        name: "service-tokens-no-expiry",
        status: "warn",
        message: `${noExpiry} token(s) have no expiry`,
        fixable: false,
      });
    }

    if (expired === 0 && expiring === 0 && noExpiry === 0) {
      checks.push({
        name: "service-tokens-expiry",
        status: "ok",
        message: "All service tokens have healthy expiry",
        fixable: false,
      });
    }
  } catch (e: any) {
    checks.push({
      name: "service-tokens-api",
      status: "error",
      message: `API call failed: ${e.message}`,
      fixable: false,
    });
  }

  try {
    const apps = await listApplications(accountId, apiToken);
    checks.push({
      name: "access-apps-api",
      status: "ok",
      message: `Listed ${apps.length} Access application(s)`,
      fixable: false,
    });

    const findings = auditApps(apps, tokens);
    const bypass = findings.filter((f) => f.reason === "bypass").length;
    const allowEveryone = findings.filter((f) => f.reason === "allow-everyone").length;
    const missingMfa = findings.filter((f) => f.reason === "missing-mfa").length;
    const longSession = findings.filter((f) => f.reason === "long-session").length;
    const noIdp = findings.filter((f) => f.reason === "no-idp-restriction").length;
    const sharedToken = findings.filter((f) => f.reason === "shared-service-token").length;
    const redundantToken = findings.filter((f) => f.reason === "redundant-service-token").length;

    if (bypass > 0) {
      checks.push({
        name: "access-apps-bypass",
        status: "error",
        message: `${bypass} bypass policy(ies) found`,
        fixable: false,
      });
    }
    if (allowEveryone > 0) {
      checks.push({
        name: "access-apps-allow-everyone",
        status: "warn",
        message: `${allowEveryone} "allow everyone" policy(ies) found`,
        fixable: false,
      });
    }
    if (missingMfa > 0) {
      checks.push({
        name: "access-apps-missing-mfa",
        status: "warn",
        message: `${missingMfa} allow policy(ies) do not require MFA`,
        fixable: false,
      });
    }
    if (longSession > 0) {
      checks.push({
        name: "access-apps-long-session",
        status: "warn",
        message: `${longSession} app(s) with session > 7 days`,
        fixable: false,
      });
    }
    if (noIdp > 0) {
      checks.push({
        name: "access-apps-no-idp-restriction",
        status: "warn",
        message: `${noIdp} app(s) without IdP restriction`,
        fixable: false,
      });
    }
    if (sharedToken > 0) {
      checks.push({
        name: "access-apps-shared-service-token",
        status: "warn",
        message: `${sharedToken} app/policy use(s) of shared service token`,
        fixable: false,
      });
    }
    if (redundantToken > 0) {
      checks.push({
        name: "access-apps-redundant-service-token",
        status: "warn",
        message: `${redundantToken} policy(ies) with redundant service token (everyone already allowed)`,
        fixable: false,
      });
    }

    if (
      bypass === 0 &&
      allowEveryone === 0 &&
      missingMfa === 0 &&
      longSession === 0 &&
      noIdp === 0 &&
      sharedToken === 0 &&
      redundantToken === 0
    ) {
      checks.push({
        name: "access-apps-policy",
        status: "ok",
        message: "All Access applications pass policy audit",
        fixable: false,
      });
    }
  } catch (e: any) {
    checks.push({
      name: "access-apps-api",
      status: "error",
      message: `API call failed: ${e.message}`,
      fixable: false,
    });
  }

  return checks;
}

// ── Dashboard ────────────────────────────────────────────────────────

export interface ProjectMapping {
  appName: string;
  appId: string;
  appType: string;
  domain?: string;
  localPath?: string;
  repoUrl?: string;
  packageName?: string;
  packageVersion?: string;
  hasWranglerConfig: boolean;
  hasAccessConfig: boolean;
  policyCount: number;
  bypassCount: number;
  allowEveryoneCount: number;
  status: "ok" | "warn" | "error" | "info";
  notes: string[];
  // Infrastructure bindings
  workerName?: string;
  workerRoute?: string;
  r2Buckets?: string[];
  d1Databases?: string[];
  kvNamespaces?: string[];
}

export interface OrphanedResource {
  type: "r2_bucket" | "d1_database" | "kv_namespace" | "worker";
  name: string;
  detail: string;
  suggestedAction: string;
}

const KNOWN_PROJECT_ROOTS = loadProjectRoots();

function loadProjectRoots(): string[] {
  const defaults = [
    `${Bun.env.HOME || "/tmp"}/kimi-toolchain`,
    `${Bun.env.HOME || "/tmp"}/Projects`,
  ];
  try {
    const userConfigPath = `${Bun.env.HOME || "/tmp"}/.kimi-code/project-mappings.yml`;
    if (existsSync(userConfigPath)) {
      const text = Bun.file(userConfigPath).textSync?.() || "";
      const parsed = parsePolicyConfig(text);
      const roots = parsed?.roots;
      if (Array.isArray(roots)) return roots as string[];
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

/** Explicit overrides when heuristic discovery fails */
const APP_TO_PROJECT_OVERRIDE: Record<string, string> = loadAppOverrides();

function loadAppOverrides(): Record<string, string> {
  const defaults: Record<string, string> = {};
  try {
    const userConfigPath = `${Bun.env.HOME || "/tmp"}/.kimi-code/project-mappings.yml`;
    if (existsSync(userConfigPath)) {
      const text = Bun.file(userConfigPath).textSync?.() || "";
      const parsed = parsePolicyConfig(text);
      const overrides = parsed?.appOverrides;
      if (overrides && typeof overrides === "object") {
        return { ...defaults, ...(overrides as Record<string, string>) };
      }
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

export function domainToProjectName(domain?: string): string {
  if (!domain) return "";
  const host = domain.replace(/\/\*.*/, "").replace(/^https?:\/\//, "");
  const parts = host.split(".");
  if (parts.length >= 2) return parts[0];
  return host;
}

async function discoverLocalProject(app: AccessApplication): Promise<{
  localPath?: string;
  repoUrl?: string;
  packageName?: string;
  packageVersion?: string;
  hasWranglerConfig: boolean;
  hasAccessConfig: boolean;
} | null> {
  // Explicit override first
  const override = APP_TO_PROJECT_OVERRIDE[app.name];
  if (override === "") return null; // explicitly unmapped
  if (override) {
    const dir = override;
    const pkgFile = Bun.file(`${dir}/package.json`);
    if (await pkgFile.exists()) {
      let pkg: { name?: string; version?: string; repository?: { url?: string } | string } = {};
      try {
        pkg = await pkgFile.json();
      } catch {
        /* ignore */
      }
      const wranglerFile = Bun.file(`${dir}/wrangler.toml`);
      const wranglerJson = Bun.file(`${dir}/wrangler.json`);
      const wranglerJsonc = Bun.file(`${dir}/wrangler.jsonc`);
      const hasWrangler =
        (await wranglerFile.exists()) ||
        (await wranglerJson.exists()) ||
        (await wranglerJsonc.exists());
      const accessFile = Bun.file(`${dir}/.cloudflare-access.yml`);
      const accessJson = Bun.file(`${dir}/.cloudflare-access.json`);
      const hasAccess = (await accessFile.exists()) || (await accessJson.exists());
      let repoUrl: string | undefined;
      if (typeof pkg.repository === "string") {
        repoUrl = pkg.repository;
      } else if (pkg.repository?.url) {
        repoUrl = pkg.repository.url;
      }
      if (!repoUrl) {
        try {
          const proc = Bun.spawn(["git", "remote", "get-url", "origin"], {
            cwd: dir,
            stdout: "pipe",
            stderr: "pipe",
          });
          const exit = await proc.exited;
          if (exit === 0) {
            repoUrl = (await Bun.readableStreamToText(proc.stdout)).trim() || undefined;
          }
        } catch {
          /* ignore */
        }
      }
      return {
        localPath: dir,
        repoUrl,
        packageName: pkg.name,
        packageVersion: pkg.version,
        hasWranglerConfig: hasWrangler,
        hasAccessConfig: hasAccess,
      };
    }
    return null;
  }

  const candidates: string[] = [];

  // Domain-based guess
  const projectName = domainToProjectName(app.domain || app.self_hosted_domains?.[0]);
  if (projectName) {
    for (const root of KNOWN_PROJECT_ROOTS) {
      candidates.push(`${root}/${projectName}`);
    }
  }

  // Name-based guess
  const normalized = app.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
  for (const root of KNOWN_PROJECT_ROOTS) {
    candidates.push(`${root}/${normalized}`);
    candidates.push(`${root}/${app.name}`);
  }

  // Direct root matches — only when we have a projectName to match against
  if (projectName) {
    for (const root of KNOWN_PROJECT_ROOTS) {
      candidates.push(root);
    }
  }

  const seen = new Set<string>();
  for (const dir of candidates) {
    if (seen.has(dir)) continue;
    seen.add(dir);

    const pkgPath = `${dir}/package.json`;
    const pkgFile = Bun.file(pkgPath);
    if (!(await pkgFile.exists())) continue;

    let pkg: { name?: string; version?: string; repository?: { url?: string } | string } = {};
    try {
      pkg = await pkgFile.json();
    } catch {
      continue;
    }

    // Verify this package matches the app domain or name
    const pkgName = pkg.name || "";
    const cleanPkgName = pkgName
      .replace(/^@[^/]+\//, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-");
    const nameMatch =
      (projectName && pkgName.includes(projectName)) ||
      normalized.includes(cleanPkgName) ||
      app.name.toLowerCase().includes(cleanPkgName);

    const wranglerFile = Bun.file(`${dir}/wrangler.toml`);
    const wranglerJson = Bun.file(`${dir}/wrangler.json`);
    const wranglerJsonc = Bun.file(`${dir}/wrangler.jsonc`);
    const hasWrangler =
      (await wranglerFile.exists()) ||
      (await wranglerJson.exists()) ||
      (await wranglerJsonc.exists());

    const accessFile = Bun.file(`${dir}/.cloudflare-access.yml`);
    const accessJson = Bun.file(`${dir}/.cloudflare-access.json`);
    const hasAccess = (await accessFile.exists()) || (await accessJson.exists());

    let repoUrl: string | undefined;
    if (typeof pkg.repository === "string") {
      repoUrl = pkg.repository;
    } else if (pkg.repository?.url) {
      repoUrl = pkg.repository.url;
    }

    // Try git remote as fallback
    if (!repoUrl) {
      try {
        const proc = Bun.spawn(["git", "remote", "get-url", "origin"], {
          cwd: dir,
          stdout: "pipe",
          stderr: "pipe",
        });
        const exit = await proc.exited;
        if (exit === 0) {
          repoUrl = (await Bun.readableStreamToText(proc.stdout)).trim() || undefined;
        }
      } catch {
        /* ignore */
      }
    }

    // Require strong name match for root-level dirs; subdirs can match by name alone
    const isExactDirMatch =
      dir.endsWith(`/${projectName}`) ||
      dir.endsWith(`/${normalized}`) ||
      dir.endsWith(`/${app.name}`);
    const isStrongMatch = nameMatch || isExactDirMatch;
    if (isStrongMatch) {
      return {
        localPath: dir,
        repoUrl,
        packageName: pkg.name,
        packageVersion: pkg.version,
        hasWranglerConfig: hasWrangler,
        hasAccessConfig: hasAccess,
      };
    }
  }

  return null;
}

// ── Infrastructure Discovery ─────────────────────────────────────────

/** Known infrastructure mappings (app/worker name → bindings) */
const INFRASTRUCTURE_MAP: Record<
  string,
  {
    workerName?: string;
    workerRoute?: string;
    r2Buckets?: string[];
    d1Databases?: string[];
    kvNamespaces?: string[];
  }
> = loadInfraMap();

function loadInfraMap(): Record<
  string,
  {
    workerName?: string;
    workerRoute?: string;
    r2Buckets?: string[];
    d1Databases?: string[];
    kvNamespaces?: string[];
  }
> {
  const defaults: Record<
    string,
    {
      workerName?: string;
      workerRoute?: string;
      r2Buckets?: string[];
      d1Databases?: string[];
      kvNamespaces?: string[];
    }
  > = {};
  try {
    const userConfigPath = `${Bun.env.HOME || "/tmp"}/.kimi-code/project-mappings.yml`;
    if (existsSync(userConfigPath)) {
      const text = Bun.file(userConfigPath).textSync?.() || "";
      const parsed = parsePolicyConfig(text);
      const infra = parsed?.infrastructure;
      if (infra && typeof infra === "object") {
        return {
          ...defaults,
          ...(infra as Record<
            string,
            {
              workerName?: string;
              workerRoute?: string;
              r2Buckets?: string[];
              d1Databases?: string[];
              kvNamespaces?: string[];
            }
          >),
        };
      }
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

async function discoverInfrastructure(
  app: AccessApplication,
  localPath?: string
): Promise<{
  workerName?: string;
  workerRoute?: string;
  r2Buckets?: string[];
  d1Databases?: string[];
  kvNamespaces?: string[];
}> {
  const result: {
    workerName?: string;
    workerRoute?: string;
    r2Buckets?: string[];
    d1Databases?: string[];
    kvNamespaces?: string[];
  } = {};

  // 1. Check known mappings
  const known = INFRASTRUCTURE_MAP[app.name];
  if (known) {
    Object.assign(result, known);
  }

  // 2. Parse wrangler config if available
  if (localPath) {
    const wranglerPaths = [
      `${localPath}/wrangler.toml`,
      `${localPath}/wrangler.json`,
      `${localPath}/wrangler.jsonc`,
    ];
    for (const wp of wranglerPaths) {
      const f = Bun.file(wp);
      if (await f.exists()) {
        try {
          const text = await f.text();
          // Simple regex extraction for bindings (wrangler.toml/json)
          const r2Matches = [...text.matchAll(/bucket_name\s*=\s*"([^"]+)"/g)];
          const d1Matches = [...text.matchAll(/database_name\s*=\s*"([^"]+)"/g)];
          const kvMatches = [...text.matchAll(/id\s*=\s*"([^"]+)"/g)];
          const nameMatches = [...text.matchAll(/name\s*=\s*"([^"]+)"/g)];

          if (r2Matches.length && !result.r2Buckets) {
            result.r2Buckets = r2Matches.map((m) => m[1]);
          }
          if (d1Matches.length && !result.d1Databases) {
            result.d1Databases = d1Matches.map((m) => m[1]);
          }
          if (kvMatches.length && !result.kvNamespaces) {
            result.kvNamespaces = kvMatches.map((m) => m[1]);
          }
          if (nameMatches.length && !result.workerName) {
            result.workerName = nameMatches[0][1];
          }
        } catch {
          /* ignore parse errors */
        }
        break;
      }
    }
  }

  return result;
}

/** Detect orphaned resources not bound to any worker or app */
export async function discoverOrphanedResources(
  accountId: string,
  apiToken: string
): Promise<OrphanedResource[]> {
  const orphaned: OrphanedResource[] = [];

  // Fetch all R2 buckets
  const bucketsRes = await fetchWithTimeout(`${API_BASE}/accounts/${accountId}/r2/buckets`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  const bucketsData = (await (bucketsRes as unknown as { json(): Promise<unknown> }).json()) as {
    result?: { buckets?: Array<{ name: string }> };
  };
  const buckets: Array<{ name: string }> = bucketsData.result?.buckets || [];

  // Fetch all workers and their bindings
  const workersRes = await fetchWithTimeout(`${API_BASE}/accounts/${accountId}/workers/scripts`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  const workersData = (await (workersRes as unknown as { json(): Promise<unknown> }).json()) as {
    result?: Array<{ id: string }>;
  };
  const workerNames: string[] = (workersData.result || []).map((w: { id: string }) => w.id);

  const boundBuckets = new Set<string>();
  for (const w of workerNames) {
    try {
      const settingsRes = await fetchWithTimeout(
        `${API_BASE}/accounts/${accountId}/workers/scripts/${w}/settings`,
        { headers: { Authorization: `Bearer ${apiToken}` } }
      );
      const settingsData = (await (
        settingsRes as unknown as { json(): Promise<unknown> }
      ).json()) as {
        result?: { bindings?: Array<{ type: string; bucket_name?: string }> };
      };
      const r2Bindings = (settingsData.result?.bindings || []).filter(
        (b: { type: string }) => b.type === "r2_bucket"
      );
      for (const b of r2Bindings) {
        if (b.bucket_name) boundBuckets.add(b.bucket_name);
      }
    } catch {
      /* ignore */
    }
  }

  // Known bucket patterns that are intentionally standalone
  const knownOrphanPatterns = [
    /-preview$/, // preview buckets (may be unused)
  ];

  for (const b of buckets) {
    if (!boundBuckets.has(b.name)) {
      const isLikelyOrphan = knownOrphanPatterns.some((p) => p.test(b.name));
      orphaned.push({
        type: "r2_bucket",
        name: b.name,
        detail: isLikelyOrphan
          ? "Preview bucket with no worker binding"
          : "No worker binding found",
        suggestedAction: isLikelyOrphan
          ? "Delete if no longer needed, or bind to a worker"
          : "Bind to a worker or delete if unused",
      });
    }
  }

  return orphaned;
}

export async function buildDashboard(
  apps: AccessApplication[],
  tokens: ServiceToken[]
): Promise<ProjectMapping[]> {
  const mappings: ProjectMapping[] = [];

  for (const app of apps) {
    const local = await discoverLocalProject(app);
    const infra = await discoverInfrastructure(app, local?.localPath);
    const findings = auditApps([app], tokens).filter((f) => f.app.id === app.id);

    const bypassCount = findings.filter((f) => f.reason === "bypass").length;
    const allowEveryoneCount = findings.filter((f) => f.reason === "allow-everyone").length;

    const notes: string[] = [];
    let status: ProjectMapping["status"] = "ok";

    if (!local?.localPath) {
      notes.push("No local project found");
      status = "info";
    } else {
      if (!local.hasWranglerConfig) {
        notes.push("No wrangler.toml found");
        status = "warn";
      }
      if (!local.hasAccessConfig) {
        notes.push("No .cloudflare-access.yml found");
        status = status === "warn" ? "warn" : "info";
      }
    }

    if (bypassCount > 0) {
      notes.push(`${bypassCount} bypass policy(ies)`);
      status = "error";
    }
    if (allowEveryoneCount > 0) {
      notes.push(`${allowEveryoneCount} "allow everyone" policy(ies)`);
      if (status !== "error") status = "warn";
    }
    if (app.type === "self_hosted" && (!app.allowed_idps || app.allowed_idps.length === 0)) {
      notes.push("No IdP restriction");
      if (status !== "error") status = "warn";
    }

    mappings.push({
      appName: app.name,
      appId: app.id,
      appType: app.type,
      domain: app.domain || app.self_hosted_domains?.[0],
      localPath: local?.localPath,
      repoUrl: local?.repoUrl,
      packageName: local?.packageName,
      packageVersion: local?.packageVersion,
      hasWranglerConfig: local?.hasWranglerConfig ?? false,
      hasAccessConfig: local?.hasAccessConfig ?? false,
      policyCount: app.policies?.length ?? 0,
      bypassCount,
      allowEveryoneCount,
      status,
      notes,
      workerName: infra.workerName,
      workerRoute: infra.workerRoute,
      r2Buckets: infra.r2Buckets,
      d1Databases: infra.d1Databases,
      kvNamespaces: infra.kvNamespaces,
    });
  }

  return mappings;
}

function printDashboard(mappings: ProjectMapping[]) {
  printSection("Cloudflare SSO Project Dashboard");

  const byStatus = { ok: 0, warn: 0, error: 0, info: 0 };
  for (const m of mappings) byStatus[m.status]++;

  console.log(
    `  Apps: ${mappings.length}  ✓ ${byStatus.ok}  ⚠ ${byStatus.warn}  ✗ ${byStatus.error}  ℹ ${byStatus.info}`
  );
  console.log("");

  for (const m of mappings) {
    const icon =
      m.status === "ok" ? "✓" : m.status === "warn" ? "⚠" : m.status === "error" ? "✗" : "ℹ";
    console.log(`  ${icon} ${m.appName}  (${m.appType})`);
    if (m.domain) console.log(`     Domain: ${m.domain}`);
    if (m.localPath) {
      console.log(`     Local:  ${m.localPath}`);
      const pkgLine = [
        m.packageName && `pkg: ${m.packageName}`,
        m.packageVersion && `v${m.packageVersion}`,
      ]
        .filter(Boolean)
        .join(" ");
      if (pkgLine) console.log(`     ${pkgLine}`);
      if (m.repoUrl) console.log(`     Repo:   ${m.repoUrl}`);
      console.log(
        `     Config: wrangler=${m.hasWranglerConfig ? "yes" : "no"} access=${m.hasAccessConfig ? "yes" : "no"}`
      );
    } else {
      console.log(`     Local:  (not found)`);
    }
    console.log(
      `     Policies: ${m.policyCount}  Bypass: ${m.bypassCount}  Allow-everyone: ${m.allowEveryoneCount}`
    );
    // Infrastructure bindings
    const infraParts: string[] = [];
    if (m.workerName) infraParts.push(`Worker: ${m.workerName}`);
    if (m.workerRoute) infraParts.push(`Route: ${m.workerRoute}`);
    if (m.r2Buckets?.length) infraParts.push(`R2: ${m.r2Buckets.join(", ")}`);
    if (m.d1Databases?.length) infraParts.push(`D1: ${m.d1Databases.join(", ")}`);
    if (m.kvNamespaces?.length) infraParts.push(`KV: ${m.kvNamespaces.join(", ")}`);
    if (infraParts.length) {
      console.log(`     Infra:  ${infraParts.join("  |  ")}`);
    }
    for (const note of m.notes) {
      console.log(`     → ${note}`);
    }
    console.log("");
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const rawArgs = Bun.argv.slice(2);
  const jsonMode = rawArgs.includes("--json");
  const args = rawArgs.filter((a) => a !== "--json");
  const command = args[0] || "tokens";

  function jsonOut(data: unknown) {
    console.log(JSON.stringify(data, null, 2));
  }

  if (!jsonMode) {
    printProjectBanner("Kimi Cloudflare Access — Zero Trust Hygiene");
  }

  if (command === "login") {
    await login();
    return;
  }

  if (command === "logout") {
    await logout();
    return;
  }

  if (command === "doctor") {
    const checks = await doctor();
    if (jsonMode) {
      const errors = checks.filter((c) => c.status === "error").length;
      const warnings = checks.filter((c) => c.status === "warn").length;
      const fixable = checks.filter((c) => c.fixable).length;
      jsonOut({
        checks,
        summary: { errors, warnings, fixable },
      });
      process.exit(errors > 0 ? 1 : 0);
    }
    printSection("Cloudflare Access Doctor");
    let errors = 0;
    let warns = 0;
    let fixable = 0;
    for (const c of checks) {
      const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "⚠" : "✗";
      console.log(`  ${icon} ${c.name}: ${c.message}${c.fixable ? " [fixable]" : ""}`);
      if (c.status === "error") errors++;
      if (c.status === "warn") warns++;
      if (c.fixable) fixable++;
    }
    console.log(`  ${errors} error(s), ${warns} warning(s), ${fixable} fixable`);
    process.exit(errors > 0 ? 1 : 0);
  }

  let accountId: string;
  let apiToken: string;
  try {
    ({ accountId, apiToken } = await getCredentials());
  } catch (e: any) {
    if (jsonMode) {
      jsonOut({ error: e.message });
    } else {
      log("error", e.message);
    }
    process.exit(1);
  }

  if (command === "tokens") {
    let tokens: ServiceToken[];
    try {
      tokens = await listServiceTokens(accountId, apiToken);
    } catch (e: any) {
      if (jsonMode) {
        jsonOut({ error: e.message });
      } else {
        log("error", `Failed to list service tokens: ${e.message}`);
      }
      process.exit(1);
    }
    const violations = checkTokenExpiry(tokens);
    if (jsonMode) {
      jsonOut({ tokens, violations });
      process.exit(violations.some((v) => v.reason === "expired") ? 1 : 0);
    }
    printSection("Service Token Expiry Sweep");
    console.log(`  Found ${tokens.length} service token(s)`);
    printViolations(violations);
    console.log("");
    console.log("Commands: tokens (default) | apps | doctor | fix | login | logout | dashboard");
    process.exit(violations.some((v) => v.reason === "expired") ? 1 : 0);
  }

  if (command === "dashboard") {
    let apps: AccessApplication[];
    let tokens: ServiceToken[];
    try {
      [apps, tokens] = await Promise.all([
        listApplications(accountId, apiToken),
        listServiceTokens(accountId, apiToken),
      ]);
    } catch (e: any) {
      if (jsonMode) {
        jsonOut({ error: e.message });
      } else {
        log("error", `Failed to fetch Access data: ${e.message}`);
      }
      process.exit(1);
    }
    const mappings = await buildDashboard(apps, tokens);
    const orphaned = await discoverOrphanedResources(accountId, apiToken);
    const errors = mappings.filter((m) => m.status === "error").length;
    const warnings = mappings.filter((m) => m.status === "warn").length;
    const unmapped = mappings.filter((m) => !m.localPath).length;
    if (jsonMode) {
      jsonOut({
        mappings,
        orphaned,
        summary: {
          total: mappings.length,
          errors,
          warnings,
          unmapped,
          mappedWithAccessConfig: mappings.filter((m) => m.hasAccessConfig).length,
          mappedWithWrangler: mappings.filter((m) => m.hasWranglerConfig).length,
          orphanedResources: orphaned.length,
        },
      });
      process.exit(errors > 0 ? 1 : 0);
    }
    printDashboard(mappings);
    if (orphaned.length > 0) {
      printSection("Orphaned Resources");
      for (const o of orphaned) {
        const icon = o.type === "r2_bucket" ? "🪣" : "📦";
        console.log(`  ${icon} ${o.name} (${o.type})`);
        console.log(`     → ${o.detail}`);
        console.log(`     → Suggested: ${o.suggestedAction}`);
      }
      console.log("");
    }
    console.log(`  ${errors} error(s), ${warnings} warning(s), ${unmapped} unmapped`);
    if (orphaned.length > 0) {
      console.log(`  ⚠ ${orphaned.length} orphaned resource(s) detected`);
    }
    process.exit(errors > 0 ? 1 : 0);
  }

  if (command === "apps") {
    let apps: AccessApplication[];
    let tokens: ServiceToken[];
    try {
      [apps, tokens] = await Promise.all([
        listApplications(accountId, apiToken),
        listServiceTokens(accountId, apiToken),
      ]);
    } catch (e: any) {
      if (jsonMode) {
        jsonOut({ error: e.message });
      } else {
        log("error", `Failed to fetch Access data: ${e.message}`);
      }
      process.exit(1);
    }
    const findings = auditApps(apps, tokens);
    if (jsonMode) {
      jsonOut({ apps, tokens, findings });
      process.exit(findings.some((f) => f.reason === "bypass") ? 1 : 0);
    }
    printSection("Access Application Policy Audit");
    console.log(`  Found ${apps.length} application(s), ${tokens.length} service token(s)`);
    printAppFindings(findings);
    console.log("");
    console.log("Commands: tokens (default) | apps | doctor | fix | login | logout | dashboard");
    process.exit(findings.some((f) => f.reason === "bypass") ? 1 : 0);
  }

  if (command === "fix") {
    let tokens: ServiceToken[];
    try {
      tokens = await listServiceTokens(accountId, apiToken);
    } catch (e: any) {
      if (jsonMode) {
        jsonOut({ error: e.message });
      } else {
        log("error", `Failed to list service tokens: ${e.message}`);
      }
      process.exit(1);
    }
    const violations = checkTokenExpiry(tokens);
    const rotatable = violations.filter(
      (v) => v.reason === "expired" || v.reason === "expiring-soon"
    );

    if (rotatable.length === 0) {
      if (jsonMode) {
        jsonOut({ rotated: [], failures: [] });
      } else {
        log("info", "No expired or expiring tokens to rotate");
      }
      return;
    }

    const rotated: Array<{ token: ServiceToken; client_id: string; client_secret: string }> = [];
    const failures: Array<{ token: ServiceToken; error: string }> = [];
    for (const v of rotatable) {
      const label = v.token.name || v.token.client_id || v.token.id;
      try {
        const result = await rotateServiceToken(accountId, apiToken, v.token.id);
        rotated.push({
          token: v.token,
          client_id: result.client_id,
          client_secret: result.client_secret,
        });
        if (!jsonMode) {
          log("info", `Rotated ${label}`);
          console.log(`    new client_id: ${result.client_id}`);
          console.log(
            `    new client_secret: ${result.client_secret.slice(0, 8)}... (store securely)`
          );
        }
      } catch (e: any) {
        failures.push({ token: v.token, error: e.message });
        if (!jsonMode) {
          log("error", `Failed to rotate ${label}: ${e.message}`);
        }
      }
    }
    if (jsonMode) {
      jsonOut({ rotated, failures });
    }
    process.exit(failures.length > 0 ? 1 : 0);
  }

  if (command === "plan" || command === "apply") {
    const config = await loadPolicyConfig(process.cwd());
    if (!config) {
      const msg = "No .cloudflare-access.yml found in current directory";
      if (jsonMode) {
        jsonOut({ error: msg });
      } else {
        log("error", msg);
      }
      process.exit(1);
    }

    let live;
    try {
      live = await fetchLiveState(accountId, apiToken);
    } catch (e: any) {
      if (jsonMode) {
        jsonOut({ error: e.message });
      } else {
        log("error", `Failed to fetch live state: ${e.message}`);
      }
      process.exit(1);
    }

    const diff = computeDiff(config, live);
    const hasChanges = diff.some((d) => d.action !== "noop");

    if (command === "plan") {
      if (jsonMode) {
        jsonOut({ config, live, diff, hasChanges });
      } else {
        printSection("Policy-as-Code Plan");
        if (!hasChanges) {
          log("info", "No changes — live state matches desired state");
        } else {
          for (const d of diff) {
            if (d.action === "noop") continue;
            const icon = d.action === "create" ? "+" : d.action === "delete" ? "-" : "~";
            console.log(`  ${icon} ${d.appName} (${d.action})`);
            if (d.appChanges) {
              for (const c of d.appChanges) console.log(`      app: ${c}`);
            }
            if (d.policyChanges) {
              for (const pc of d.policyChanges) {
                if (pc.action === "noop") continue;
                const picon = pc.action === "create" ? "+" : pc.action === "delete" ? "-" : "~";
                console.log(`      ${picon} policy: ${pc.policyName} (${pc.action})`);
                if (pc.changes) {
                  for (const c of pc.changes) console.log(`          ${c}`);
                }
              }
            }
          }
        }
        console.log("");
        console.log(`Run "kimi-cloudflare-access apply" to apply changes`);
      }
      process.exit(hasChanges ? 1 : 0);
    }

    if (command === "apply") {
      const dryRun = args.includes("--dry-run");
      if (!dryRun && !hasChanges) {
        if (jsonMode) {
          jsonOut({ applied: false, reason: "no changes" });
        } else {
          log("info", "No changes to apply");
        }
        process.exit(0);
      }

      if (!dryRun && !jsonMode) {
        const confirm = prompt(
          `Apply ${diff.filter((d) => d.action !== "noop").length} change(s)? [y/N] `
        );
        if (confirm?.trim().toLowerCase() !== "y") {
          log("info", "Aborted");
          process.exit(0);
        }
      }

      const result = await applyDiff(accountId, apiToken, diff, config, live, dryRun);
      if (jsonMode) {
        jsonOut({ dryRun, ...result });
      } else {
        printSection(dryRun ? "Apply (dry-run)" : "Apply");
        log(
          "info",
          `Created: ${result.created}, Updated: ${result.updated}, Deleted: ${result.deleted}`
        );
        if (result.errors.length > 0) {
          for (const e of result.errors) log("error", e);
        }
      }
      process.exit(result.errors.length > 0 ? 1 : 0);
    }
  }

  if (command === "mcp-apply") {
    const config = await loadPolicyConfig(process.cwd());
    if (!config) {
      const msg = "No .cloudflare-access.yml found in current directory";
      if (jsonMode) {
        jsonOut({ error: msg });
      } else {
        log("error", msg);
      }
      process.exit(1);
    }

    let accountId: string;
    try {
      ({ accountId } = await getCredentials());
    } catch (e: any) {
      if (jsonMode) {
        jsonOut({ error: e.message });
      } else {
        log("error", e.message);
      }
      process.exit(1);
    }

    // Build MCP script for policy updates
    const policyUpdates: Array<{
      appId: string;
      policyId: string;
      appName: string;
      policyName: string;
      body: unknown;
    }> = [];

    for (const app of config.apps) {
      if (!app.policies || app.policies.length === 0) continue;
      // We need live IDs — fetch them
      try {
        const liveApps =
          (await apiGet<
            Array<{
              id: string;
              name: string;
              policies: Array<{ id: string; name: string; reusable?: boolean }>;
            }>
          >(accountId, apiToken, "/access/apps")) || [];
        const liveApp = liveApps.find((a) => a.name === app.name);
        if (!liveApp) {
          if (!jsonMode) log("warn", `App "${app.name}" not found live — skipping`);
          continue;
        }
        for (const desiredPolicy of app.policies) {
          const livePolicy = liveApp.policies.find((p) => p.name === desiredPolicy.name);
          if (livePolicy) {
            policyUpdates.push({
              appId: liveApp.id,
              policyId: livePolicy.id,
              appName: app.name,
              policyName: desiredPolicy.name,
              body: {
                name: desiredPolicy.name,
                decision: desiredPolicy.decision,
                include: desiredPolicy.include,
                exclude: desiredPolicy.exclude || [],
                require: desiredPolicy.require || [],
              },
            });
          }
        }
      } catch (e: any) {
        if (!jsonMode) log("error", `Failed to fetch live state for ${app.name}: ${e.message}`);
      }
    }

    if (policyUpdates.length === 0) {
      if (!jsonMode) log("info", "No matching live policies to update");
      process.exit(0);
    }

    // Generate MCP script
    const mcpScript = `// Run this via MCP cloudflare-api server
// Generated by kimi-cloudflare-access mcp-apply
async () => {
  const accountId = "${accountId}";
  const updates = ${JSON.stringify(policyUpdates, null, 2)};
  const results = [];
  for (const u of updates) {
    const resp = await cloudflare.request({
      method: "PUT",
      path: \`/accounts/\${accountId}/access/apps/\${u.appId}/policies/\${u.policyId}\`,
      body: u.body,
    });
    results.push({ app: u.appName, policy: u.policyName, status: resp.status, success: resp.success, errors: resp.errors });
  }
  return results;
}`;

    if (jsonMode) {
      jsonOut({ policyUpdates, mcpScript });
    } else {
      printSection("MCP Apply Script");
      console.log("  Copy the script below and run via MCP cloudflare-api:");
      console.log("");
      console.log(mcpScript);
      console.log("");
      console.log(`  ${policyUpdates.length} policy update(s) ready`);
    }
    process.exit(0);
  }

  console.error(`Unknown command: ${command}`);
  console.error(
    "Usage: kimi-cloudflare-access [tokens|apps|doctor|fix|login|logout|plan|apply|dashboard|mcp-apply]"
  );
  process.exit(1);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Cloudflare Access check failed:", err.message);
    process.exit(1);
  });
}
