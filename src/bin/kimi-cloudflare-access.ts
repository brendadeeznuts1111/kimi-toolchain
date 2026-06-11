#!/usr/bin/env bun
/**
 * kimi-cloudflare-access — Cloudflare Access / Zero Trust hygiene
 * P0: Service token expiry sweep
 * P1: Access application policy audit
 *
 * Usage:
 *   kimi-cloudflare-access [tokens|apps|doctor|fix]
 *
 * Env:
 *   CLOUDFLARE_ACCOUNT_ID  required
 *   CLOUDFLARE_API_TOKEN   required — API token with Access:Read (and Access:Edit to rotate)
 *
 * Note:
 *   Wrangler OAuth tokens and the Kimi Code cloudflare-api MCP server use different
 *   auth flows. This CLI needs a dedicated Cloudflare API token from
 *   https://dash.cloudflare.com/profile/api-tokens.
 */

import { fetchWithTimeout, log, printSection } from "../lib/utils.ts";

// ── Config ───────────────────────────────────────────────────────────

const API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_WARN_DAYS = 30;

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

// ── API ──────────────────────────────────────────────────────────────

function getCredentials(): { accountId: string; apiToken: string } {
  const accountId = Bun.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = Bun.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    console.error("Missing CLOUDFLARE_ACCOUNT_ID and/or CLOUDFLARE_API_TOKEN");
    console.error(
      "Create a token with Access:Read (and Access:Edit to rotate) at https://dash.cloudflare.com/profile/api-tokens"
    );
    console.error(
      "Note: Wrangler OAuth / Kimi Code MCP auth is separate and cannot be used by this CLI."
    );
    process.exit(1);
  }

  return { accountId, apiToken };
}

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

  const accountId = Bun.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = Bun.env.CLOUDFLARE_API_TOKEN;

  if (!accountId || !apiToken) {
    checks.push({
      name: "cloudflare-credentials",
      status: "error",
      message: "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required",
      fixable: false,
    });
    return checks;
  }

  checks.push({
    name: "cloudflare-credentials",
    status: "ok",
    message: "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN present",
    fixable: false,
  });

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

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = Bun.argv.slice(2);
  const command = args[0] || "tokens";

  console.log(`╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║      Kimi Cloudflare Access — Zero Trust Hygiene             ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝`);
  console.log("");

  if (command === "doctor") {
    printSection("Cloudflare Access Doctor");
    const checks = await doctor();
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

  const { accountId, apiToken } = getCredentials();

  if (command === "tokens") {
    printSection("Service Token Expiry Sweep");
    let tokens: ServiceToken[];
    try {
      tokens = await listServiceTokens(accountId, apiToken);
    } catch (e: any) {
      log("error", `Failed to list service tokens: ${e.message}`);
      process.exit(1);
    }
    console.log(`  Found ${tokens.length} service token(s)`);
    const violations = checkTokenExpiry(tokens);
    printViolations(violations);
    console.log("");
    console.log("Commands: tokens (default) | apps | doctor | fix");
    process.exit(violations.some((v) => v.reason === "expired") ? 1 : 0);
  }

  if (command === "apps") {
    printSection("Access Application Policy Audit");
    let apps: AccessApplication[];
    let tokens: ServiceToken[];
    try {
      [apps, tokens] = await Promise.all([
        listApplications(accountId, apiToken),
        listServiceTokens(accountId, apiToken),
      ]);
    } catch (e: any) {
      log("error", `Failed to fetch Access data: ${e.message}`);
      process.exit(1);
    }
    console.log(`  Found ${apps.length} application(s), ${tokens.length} service token(s)`);
    const findings = auditApps(apps, tokens);
    printAppFindings(findings);
    console.log("");
    console.log("Commands: tokens (default) | apps | doctor | fix");
    process.exit(findings.some((f) => f.reason === "bypass") ? 1 : 0);
  }

  if (command === "fix") {
    printSection("Service Token Rotation");
    let tokens: ServiceToken[];
    try {
      tokens = await listServiceTokens(accountId, apiToken);
    } catch (e: any) {
      log("error", `Failed to list service tokens: ${e.message}`);
      process.exit(1);
    }
    const violations = checkTokenExpiry(tokens);
    const rotatable = violations.filter(
      (v) => v.reason === "expired" || v.reason === "expiring-soon"
    );

    if (rotatable.length === 0) {
      log("info", "No expired or expiring tokens to rotate");
      return;
    }

    let failures = 0;
    for (const v of rotatable) {
      const label = v.token.name || v.token.client_id || v.token.id;
      try {
        const rotated = await rotateServiceToken(accountId, apiToken, v.token.id);
        log("info", `Rotated ${label}`);
        console.log(`    new client_id: ${rotated.client_id}`);
        console.log(
          `    new client_secret: ${rotated.client_secret.slice(0, 8)}... (store securely)`
        );
      } catch (e: any) {
        failures++;
        log("error", `Failed to rotate ${label}: ${e.message}`);
      }
    }
    process.exit(failures > 0 ? 1 : 0);
  }

  console.error(`Unknown command: ${command}`);
  console.error("Usage: kimi-cloudflare-access [tokens|apps|doctor|fix]");
  process.exit(1);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Cloudflare Access check failed:", err.message);
    process.exit(1);
  });
}
