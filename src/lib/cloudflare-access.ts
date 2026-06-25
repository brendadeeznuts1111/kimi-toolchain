/**
 * cloudflare-access.ts — Cloudflare Access / Zero Trust library functions
 *
 * Pure library code with no CLI side effects.
 * Moved from src/bin/kimi-cloudflare-access.ts
 */

import { gitRemoteUrl } from "./git-helpers.ts";
import { fetchWithTimeout } from "./utils.ts";
import { pathExists } from "./bun-io.ts";
import { join } from "path";
import { homeDir } from "./paths.ts";
import { parsePolicyConfig } from "./cloudflare-access-policy.ts";
import { SecretKeys } from "./secrets-constants.ts";
import { readSecretFromEnv } from "./secrets-env.ts";
import { safeJsonc } from "./utils.ts";
import { Schema } from "effect";

// ── Config ───────────────────────────────────────────────────────────

const API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_WARN_DAYS = 30;

export const CREDENTIAL_SERVICE = "kimi-toolchain";
const ACCOUNT_SECRET = "cloudflare-account-id";
const TOKEN_SECRET = "cloudflare-api-token";

// ── Types ────────────────────────────────────────────────────────────

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

// ── API ──────────────────────────────────────────────────────────────

/** Cloudflare API envelope — validates success/errors; result is untyped. */
const ApiEnvelope = Schema.Struct({
  success: Schema.Boolean,
  errors: Schema.optional(Schema.mutable(Schema.Array(Schema.Struct({ message: Schema.String })))),
  messages: Schema.optional(Schema.Array(Schema.String)),
  result: Schema.optional(Schema.Unknown),
});

interface ApiOk<T> {
  success: true;
  result: T;
}

interface ApiError {
  success: false;
  errors?: Array<{ message: string }>;
}

/** Narrow parsed JSON to the expected Cloudflare API shape. */
function narrowApiResult<T>(raw: unknown): ApiOk<T> | ApiError {
  const envelope = Schema.decodeUnknownSync(ApiEnvelope)(raw);
  if (envelope.success === false) {
    return { success: false as const, errors: envelope.errors };
  }
  return { success: true as const, result: envelope.result as T };
}

/** Fetch Cloudflare API, validate the envelope, return result or throw. */
async function apiFetch<T>(url: string, init: RequestInit & { timeoutMs?: number }): Promise<T> {
  const resp = await fetchWithTimeout(url, init);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Cloudflare API ${resp.status}: ${text}`);
  }
  const raw = await resp.json();
  const narrowed = narrowApiResult<T>(raw);
  if (narrowed.success === false) {
    const msg = narrowed.errors?.[0]?.message ?? "API returned success: false";
    throw new Error(`Cloudflare API error: ${msg}`);
  }
  return narrowed.result;
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
  const fromSecrets = await loadCredentialsFromSecrets(secrets);
  const accountId =
    fromSecrets.accountId ??
    readSecretFromEnv(
      SecretKeys.CLOUDFLARE_ACCOUNT_ID.service,
      SecretKeys.CLOUDFLARE_ACCOUNT_ID.name
    );
  const apiToken =
    fromSecrets.apiToken ??
    readSecretFromEnv(
      SecretKeys.CLOUDFLARE_API_TOKEN.service,
      SecretKeys.CLOUDFLARE_API_TOKEN.name
    );

  if (accountId && apiToken) {
    return { accountId, apiToken };
  }

  throw new Error(
    "Missing Cloudflare credentials.\n" +
      "Run: kimi-cloudflare-access login\n" +
      "Or set env vars: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN\n" +
      "Create a token with Account > Access: Read (and Access: Edit to rotate) at https://dash.cloudflare.com/profile/api-tokens\n" +
      "Note: Wrangler OAuth / Kimi Code MCP auth is separate and cannot be used by this CLI."
  );
}

export async function verifyToken(apiToken: string): Promise<{ valid: boolean; message?: string }> {
  const TokenStatusSchema = Schema.Struct({
    success: Schema.Boolean,
    errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String }))),
  });

  try {
    const resp = await fetchWithTimeout(`${API_BASE}/user/tokens/verify`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      timeoutMs: 15000,
    });

    if (!resp.ok) {
      const text = await resp.text();
      return { valid: false, message: `Cloudflare API ${resp.status}: ${text}` };
    }

    const raw = await resp.json();
    const data = Schema.decodeUnknownSync(TokenStatusSchema)(raw);
    if (data.success === false) {
      const msg = data.errors?.[0]?.message || "Token verification failed";
      return { valid: false, message: msg };
    }

    return { valid: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : Bun.inspect(e);
    return { valid: false, message: msg };
  }
}

export async function apiGet<T>(accountId: string, apiToken: string, path: string): Promise<T> {
  return apiFetch<T>(`${API_BASE}/accounts/${accountId}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    timeoutMs: 15000,
  });
}

export function isAuthError(err: unknown): boolean {
  return err instanceof Error && /\b40[13]\b|Authentication error/.test(err.message);
}

export function parseSessionHours(raw = ""): number {
  const hourMatch = raw.match(/^(\d+)h$/);
  if (hourMatch) return Number.parseInt(hourMatch[1]!, 10);
  const dayMatch = raw.match(/^(\d+)d$/);
  if (dayMatch) return Number.parseInt(dayMatch[1]!, 10) * 24;
  return 24;
}

export function domainToProjectName(domain?: string): string {
  if (!domain) return "";
  const host = domain.replace(/\/\*.*/, "").replace(/^https?:\/\//, "");
  return host.split(".")[0] ?? "";
}

export function listServiceTokens(accountId: string, apiToken: string): Promise<ServiceToken[]> {
  return apiGet<ServiceToken[]>(accountId, apiToken, "/access/service_tokens");
}

export function listApplications(
  accountId: string,
  apiToken: string
): Promise<AccessApplication[]> {
  return apiGet<AccessApplication[]>(accountId, apiToken, "/access/apps");
}

export function rotateServiceToken(
  accountId: string,
  apiToken: string,
  tokenId: string
): Promise<{ client_id: string; client_secret: string }> {
  return apiFetch<{ client_id: string; client_secret: string }>(
    `${API_BASE}/accounts/${accountId}/access/service_tokens/${tokenId}/refresh`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      timeoutMs: 15000,
    }
  );
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

    const dayDelta = (expiry - now) / (1000 * 60 * 60 * 24);
    const daysRemaining = dayDelta >= 0 ? Math.ceil(dayDelta) : Math.floor(dayDelta);

    if (daysRemaining < 0) {
      violations.push({ token, reason: "expired", daysRemaining });
    } else if (daysRemaining <= warnDays) {
      violations.push({ token, reason: "expiring-soon", daysRemaining });
    }
  }

  return violations;
}

// ── App Policy Audit ─────────────────────────────────────────────────

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

      if (policy.include.some((rule) => "everyone" in rule)) {
        findings.push({
          app,
          policy,
          reason: "allow-everyone",
          detail: `Policy "${policy.name}" allows everyone`,
        });
      }

      if (
        !policy.require.some(
          (rule) => "auth_method" in rule || "gsuite" in rule || "azureAD" in rule
        )
      ) {
        findings.push({
          app,
          policy,
          reason: "missing-mfa",
          detail: `Policy "${policy.name}" does not require MFA`,
        });
      }

      if (policy.include.some((rule) => "service_token" in rule)) {
        const tokenRule = policy.include.find((r) => "service_token" in r) as {
          service_token?: { token_id?: string };
        };
        const tokenId = tokenRule?.service_token?.token_id;
        if (tokenId && tokenIds.has(tokenId)) {
          if (policy.include.some((rule) => "everyone" in rule)) {
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

    let sessionHours = 24;
    if (app.session_duration) {
      const hourMatch = app.session_duration.match(/^(\d+)h$/);
      if (hourMatch) {
        sessionHours = Number.parseInt(hourMatch[1], 10);
      } else {
        const dayMatch = app.session_duration.match(/^(\d+)d$/);
        if (dayMatch) sessionHours = Number.parseInt(dayMatch[1], 10) * 24;
      }
    }
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

// ── Dashboard ────────────────────────────────────────────────────────

function loadProjectRoots(): string[] {
  const defaults = [join(homeDir(), "kimi-toolchain"), join(homeDir(), "Projects")];
  try {
    const userConfigPath = join(homeDir(), ".kimi-code", "project-mappings.yml");
    if (pathExists(userConfigPath)) {
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

const KNOWN_PROJECT_ROOTS = loadProjectRoots();

function loadAppOverrides(): Record<string, string> {
  const defaults: Record<string, string> = {};
  try {
    const userConfigPath = join(homeDir(), ".kimi-code", "project-mappings.yml");
    if (pathExists(userConfigPath)) {
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

const APP_TO_PROJECT_OVERRIDE: Record<string, string> = loadAppOverrides();

export async function discoverLocalProject(app: AccessApplication): Promise<{
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
      const pkg = (await pkgFile.json()) as {
        name?: string;
        version?: string;
        repository?: { url?: string } | string;
      };
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
        repoUrl = (await gitRemoteUrl(dir)) ?? undefined;
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
  const domain = app.domain || app.self_hosted_domains?.[0];
  const host = domain ? domain.replace(/\/\*.*/, "").replace(/^https?:\/\//, "") : "";
  const parts = host.split(".");
  const projectName = parts.length >= 2 ? parts[0] : host;
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

    const pkg = (await pkgFile.json()) as {
      name?: string;
      version?: string;
      repository?: { url?: string } | string;
    };

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
      repoUrl = (await gitRemoteUrl(dir)) ?? undefined;
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
    const userConfigPath = join(homeDir(), ".kimi-code", "project-mappings.yml");
    if (pathExists(userConfigPath)) {
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

export async function discoverInfrastructure(
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
          if (wp.endsWith(".jsonc") || wp.endsWith(".json")) {
            const parsed = safeJsonc<{
              name?: string;
              r2_buckets?: Array<{ bucket_name?: string }>;
              d1_databases?: Array<{ database_name?: string }>;
              kv_namespaces?: Array<{ id?: string }>;
            } | null>(text, null);
            if (parsed) {
              if (parsed.name && !result.workerName) result.workerName = parsed.name;
              if (parsed.r2_buckets?.length && !result.r2Buckets) {
                result.r2Buckets = parsed.r2_buckets
                  .map((entry) => entry.bucket_name)
                  .filter((name): name is string => Boolean(name));
              }
              if (parsed.d1_databases?.length && !result.d1Databases) {
                result.d1Databases = parsed.d1_databases
                  .map((entry) => entry.database_name)
                  .filter((name): name is string => Boolean(name));
              }
              if (parsed.kv_namespaces?.length && !result.kvNamespaces) {
                result.kvNamespaces = parsed.kv_namespaces
                  .map((entry) => entry.id)
                  .filter((id): id is string => Boolean(id));
              }
            }
          }
          const r2Matches = [...text.matchAll(/bucket_name\s*=\s*"([^"]+)"/g)];
          const d1Matches = [...text.matchAll(/database_name\s*=\s*"([^"]+)"/g)];
          const kvMatches = [...text.matchAll(/id\s*=\s*"([^"]+)"/g)];
          const nameMatches = [...text.matchAll(/name\s*=\s*"([^"]+)"/g)];
          if (r2Matches.length && !result.r2Buckets) result.r2Buckets = r2Matches.map((m) => m[1]!);
          if (d1Matches.length && !result.d1Databases)
            result.d1Databases = d1Matches.map((m) => m[1]!);
          if (kvMatches.length && !result.kvNamespaces)
            result.kvNamespaces = kvMatches.map((m) => m[1]!);
          if (nameMatches.length && !result.workerName) result.workerName = nameMatches[0]![1];
        } catch {
          /* ignore parse errors */
        }
        break;
      }
    }
  }

  return result;
}

export async function discoverOrphanedResources(
  accountId: string,
  apiToken: string
): Promise<OrphanedResource[]> {
  const orphaned: OrphanedResource[] = [];

  // Fetch all R2 buckets
  const bucketsRes = fetchWithTimeout(`${API_BASE}/accounts/${accountId}/r2/buckets`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  const bucketsData: { result?: { buckets?: Array<{ name: string }> } } = await (
    await bucketsRes
  ).json();
  const buckets: Array<{ name: string }> = bucketsData.result?.buckets || [];

  // Fetch all workers and their bindings
  const workersRes = fetchWithTimeout(`${API_BASE}/accounts/${accountId}/workers/scripts`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  const workersData: { result?: Array<{ id: string }> } = await (await workersRes).json();
  const workerNames: string[] = (workersData.result || []).map((w: { id: string }) => w.id);

  const boundBuckets = new Set<string>();
  for (const w of workerNames) {
    try {
      const settingsRes = fetchWithTimeout(
        `${API_BASE}/accounts/${accountId}/workers/scripts/${w}/settings`,
        { headers: { Authorization: `Bearer ${apiToken}` } }
      );
      const settingsData: {
        result?: { bindings?: Array<{ type: string; bucket_name?: string }> };
      } = await (await settingsRes).json();
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
