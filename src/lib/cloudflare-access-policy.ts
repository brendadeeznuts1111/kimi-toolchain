/**
 * cloudflare-access-policy.ts — Policy-as-Code for Cloudflare Access
 *
 * Defines desired Access application/policy state in `.cloudflare-access.yml`,
 * diffs against live Cloudflare state, and applies changes.
 */

import { fetchWithTimeout } from "./utils.ts";
import { loadDxDefaultsSync } from "./defaults-config.ts";

const API_BASE = "https://api.cloudflare.com/client/v4";

const HARDCODED_RETRIES = 2;
const HARDCODED_BASE_DELAY_MS = 500;
const HARDCODED_TIMEOUT_MS = 30_000;

let DEFAULT_RETRIES = HARDCODED_RETRIES;
let DEFAULT_BASE_DELAY_MS = HARDCODED_BASE_DELAY_MS;
let DEFAULT_TIMEOUT_MS = HARDCODED_TIMEOUT_MS;
const DEFAULT_SESSION_DURATION = "24h";
const DEFAULT_APP_TYPE = "self_hosted";

/** Load cloudflare defaults from dx.config.toml [defaults]. Call once during bootstrap. */
export function loadCloudflareDefaults(projectRoot?: string): void {
  if (!projectRoot) return;
  const dx = loadDxDefaultsSync(projectRoot);
  if (!dx) return;
  if (dx.cloudflareRetries !== undefined) DEFAULT_RETRIES = dx.cloudflareRetries;
  if (dx.cloudflareBaseDelayMs !== undefined) DEFAULT_BASE_DELAY_MS = dx.cloudflareBaseDelayMs;
  if (dx.cloudflareTimeoutMs !== undefined) DEFAULT_TIMEOUT_MS = dx.cloudflareTimeoutMs;
}

/** Reset to hardcoded values (for tests). */
export function resetCloudflareDefaults(): void {
  DEFAULT_RETRIES = HARDCODED_RETRIES;
  DEFAULT_BASE_DELAY_MS = HARDCODED_BASE_DELAY_MS;
  DEFAULT_TIMEOUT_MS = HARDCODED_TIMEOUT_MS;
}

// ── Config Schema ────────────────────────────────────────────────────

export interface PolicyConfig {
  name: string;
  decision: "allow" | "deny" | "bypass" | "non_identity" | "service_auth";
  include: Array<Record<string, unknown>>;
  exclude?: Array<Record<string, unknown>>;
  require?: Array<Record<string, unknown>>;
}

export interface AppConfig {
  name: string;
  domain?: string;
  type?: string;
  self_hosted_domains?: string[];
  session_duration?: string;
  allowed_idps?: string[];
  app_launcher_visible?: boolean;
  policies: PolicyConfig[];
}

export interface AccessPolicyConfig {
  apps: AppConfig[];
  /** When true, only apps listed in this config are managed. Unlisted live apps are ignored, not deleted. */
  scoped?: boolean;
  /** Optional user-level roots for local project discovery. */
  roots?: string[];
  /** Optional app-name → local-path overrides. */
  appOverrides?: Record<string, string>;
  /** Optional infrastructure bindings per app name. */
  infrastructure?: Record<string, unknown>;
}

// ── Config Loader ────────────────────────────────────────────────────

export async function loadPolicyConfig(cwd: string): Promise<AccessPolicyConfig | null> {
  const errors: string[] = [];

  // Try JSON first (native parse, most reliable)
  const jsonPaths = [`${cwd}/.cloudflare-access.json`, `${cwd}/cloudflare-access.json`];
  for (const p of jsonPaths) {
    const file = Bun.file(p);
    if (await file.exists()) {
      try {
        return (await file.json()) as AccessPolicyConfig;
      } catch (err) {
        errors.push(`${p}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Try YAML — Bun has built-in YAML support via Bun.TOML.parse for simple cases,
  // but for full YAML we use js-yaml if available, otherwise best-effort parse.
  const yamlPaths = [
    `${cwd}/.cloudflare-access.yml`,
    `${cwd}/.cloudflare-access.yaml`,
    `${cwd}/cloudflare-access.yml`,
    `${cwd}/cloudflare-access.yaml`,
  ];
  for (const p of yamlPaths) {
    const file = Bun.file(p);
    if (await file.exists()) {
      const text = await file.text();
      try {
        // Attempt js-yaml if available (dev dependency)
        const yaml = await import("js-yaml");
        return yaml.load(text) as AccessPolicyConfig;
      } catch (err) {
        errors.push(`${p}: ${err instanceof Error ? err.message : String(err)}`);
        // Fallback to best-effort parser if js-yaml is unavailable or fails
        try {
          return parsePolicyConfig(text);
        } catch (parseErr) {
          errors.push(
            `${p} (fallback): ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Failed to load policy config from ${cwd}:\n  ${errors.join("\n  ")}`);
  }
  return null;
}

export function parsePolicyConfig(yaml: string): AccessPolicyConfig {
  // Indentation-aware YAML parser for the Access policy subset.
  // Supports: apps, policies, include/require/exclude arrays, and nested objects.
  const lines = yaml.split("\n");
  const result: AccessPolicyConfig = { apps: [] };

  type StackEntry =
    | { type: "root"; indent: number }
    | { type: "app"; indent: number; app: AppConfig }
    | { type: "policies"; indent: number }
    | { type: "policy"; indent: number; policy: PolicyConfig }
    | {
        type: "list";
        indent: number;
        key: "include" | "require" | "exclude";
        arr: Array<Record<string, unknown>>;
      }
    | { type: "object"; indent: number; obj: Record<string, unknown> };

  const stack: StackEntry[] = [{ type: "root", indent: -1 }];

  function isStackEntry<T extends StackEntry["type"]>(
    entry: StackEntry,
    type: T
  ): entry is Extract<StackEntry, { type: T }> {
    return entry.type === type;
  }

  function currentList(): Array<Record<string, unknown>> | null {
    for (let i = stack.length - 1; i >= 0; i--) {
      const entry = stack[i];
      if (isStackEntry(entry, "list")) return entry.arr;
    }
    return null;
  }

  function currentObject(): Record<string, unknown> | null {
    for (let i = stack.length - 1; i >= 0; i--) {
      const entry = stack[i];
      if (isStackEntry(entry, "object")) return entry.obj;
      if (isStackEntry(entry, "policy")) return entry.policy as unknown as Record<string, unknown>;
      if (isStackEntry(entry, "app")) return entry.app as unknown as Record<string, unknown>;
    }
    return null;
  }

  function popUntil(indent: number) {
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = raw.length - raw.trimStart().length;
    popUntil(indent);

    const parent = stack[stack.length - 1];

    // scoped: true
    if (trimmed === "scoped: true") {
      result.scoped = true;
      continue;
    }

    // apps:
    if (trimmed === "apps:") {
      continue;
    }

    // - name: App Name  (new app)
    if (trimmed.startsWith("- name:") && parent.type === "root") {
      const app: AppConfig = {
        name: trimmed.slice("- name:".length).trim(),
        policies: [],
      };
      result.apps.push(app);
      stack.push({ type: "app", indent, app });
      continue;
    }

    // - name: Policy Name  (new policy)
    if (trimmed.startsWith("- name:") && parent.type === "policies") {
      const policy: PolicyConfig = {
        name: trimmed.slice("- name:".length).trim(),
        decision: "allow",
        include: [],
      };
      const appParent = stack.find((s) => s.type === "app") as
        | Extract<StackEntry, { type: "app" }>
        | undefined;
      if (appParent) appParent.app.policies.push(policy);
      stack.push({ type: "policy", indent, policy });
      continue;
    }

    // policies:
    if (trimmed === "policies:") {
      stack.push({ type: "policies", indent });
      continue;
    }

    // include: / require: / exclude:
    if (["include:", "require:", "exclude:"].includes(trimmed)) {
      const key = trimmed.replace(":", "") as "include" | "require" | "exclude";
      const policyParent = stack.find((s) => s.type === "policy") as
        | Extract<StackEntry, { type: "policy" }>
        | undefined;
      if (policyParent) {
        if (!policyParent.policy[key]) policyParent.policy[key] = [];
        stack.push({ type: "list", indent, key, arr: policyParent.policy[key]! });
      }
      continue;
    }

    // - key: value  (list item)
    if (trimmed.startsWith("- ")) {
      const list = currentList();
      if (list) {
        const content = trimmed.slice(2);
        const colonIdx = content.indexOf(":");
        if (colonIdx === -1) {
          list.push({ [content]: true });
        } else {
          const key = content.slice(0, colonIdx).trim();
          const value = content.slice(colonIdx + 1).trim();
          if (value === "") {
            // Nested object starting — push to stack
            const newObj: Record<string, unknown> = {};
            list.push({ [key]: newObj });
            stack.push({ type: "object", indent, obj: newObj });
          } else {
            list.push({ [key]: parseScalar(value) });
          }
        }
      }
      continue;
    }

    // key: value  (property)
    if (trimmed.includes(":")) {
      const colonIdx = trimmed.indexOf(":");
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      const obj = currentObject();
      if (obj) {
        if (value === "") {
          // Nested object starting
          const newObj: Record<string, unknown> = {};
          obj[key] = newObj;
          stack.push({ type: "object", indent, obj: newObj });
        } else {
          obj[key] = parseScalar(value);
        }
      }
      continue;
    }
  }

  return result;
}

function parseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null" || trimmed === "~") return null;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((s) => parseScalar(s.trim()));
  }
  return trimmed;
}

// ── Diff Engine ──────────────────────────────────────────────────────

export interface PolicyDiff {
  policyName: string;
  action: "create" | "update" | "delete" | "noop";
  changes?: string[];
}

export interface DiffResult {
  appName: string;
  action: "create" | "update" | "delete" | "noop";
  appChanges?: string[];
  policyChanges?: PolicyDiff[];
}

export interface LiveState {
  apps: Array<{
    id: string;
    name: string;
    domain?: string;
    type?: string;
    session_duration?: string;
    allowed_idps?: string[];
    policies: Array<{
      id: string;
      name: string;
      decision: string;
      include: Array<Record<string, unknown>>;
      exclude: Array<Record<string, unknown>>;
      require: Array<Record<string, unknown>>;
    }>;
  }>;
}

export async function fetchLiveState(accountId: string, apiToken: string): Promise<LiveState> {
  const apps = await apiCall<LiveState["apps"]>(accountId, apiToken, "/access/apps", "GET");
  return { apps };
}

export function computeDiff(desired: AccessPolicyConfig, live: LiveState): DiffResult[] {
  const results: DiffResult[] = [];
  const liveAppMap = new Map(live.apps.map((a) => [a.name, a]));
  const desiredAppMap = new Map(desired.apps.map((a) => [a.name, a]));

  // Apps to create or update
  for (const desiredApp of desired.apps) {
    const liveApp = liveAppMap.get(desiredApp.name);
    if (!liveApp) {
      results.push({
        appName: desiredApp.name,
        action: "create",
        policyChanges: desiredApp.policies.map((p) => ({
          policyName: p.name,
          action: "create" as const,
        })),
      });
      continue;
    }

    const appChanges: string[] = [];
    if (desiredApp.domain && desiredApp.domain !== liveApp.domain) {
      appChanges.push(`domain: ${liveApp.domain} → ${desiredApp.domain}`);
    }
    if (desiredApp.session_duration && desiredApp.session_duration !== liveApp.session_duration) {
      appChanges.push(
        `session_duration: ${liveApp.session_duration} → ${desiredApp.session_duration}`
      );
    }
    if (desiredApp.allowed_idps && Array.isArray(desiredApp.allowed_idps)) {
      const liveIdps = liveApp.allowed_idps || [];
      const desiredIdps = desiredApp.allowed_idps;
      if (JSON.stringify([...liveIdps].sort()) !== JSON.stringify([...desiredIdps].sort())) {
        appChanges.push(`allowed_idps: [${liveIdps.join(", ")}] → [${desiredIdps.join(", ")}]`);
      }
    }

    const policyChanges = computePolicyDiff(desiredApp.policies, liveApp.policies);
    const hasPolicyChanges = policyChanges.some((p) => p.action !== "noop");

    if (appChanges.length > 0 || hasPolicyChanges) {
      results.push({
        appName: desiredApp.name,
        action: "update",
        appChanges,
        policyChanges,
      });
    } else {
      results.push({ appName: desiredApp.name, action: "noop" });
    }
  }

  // Apps to delete (not in desired) — only when config is not scoped
  if (!desired.scoped) {
    for (const liveApp of live.apps) {
      if (!desiredAppMap.has(liveApp.name)) {
        results.push({ appName: liveApp.name, action: "delete" });
      }
    }
  }

  return results;
}

function computePolicyDiff(
  desired: PolicyConfig[],
  live: LiveState["apps"][0]["policies"]
): PolicyDiff[] {
  const results: PolicyDiff[] = [];
  const liveMap = new Map(live.map((p) => [p.name, p]));
  const desiredMap = new Map(desired.map((p) => [p.name, p]));

  for (const d of desired) {
    const l = liveMap.get(d.name);
    if (!l) {
      results.push({ policyName: d.name, action: "create" });
      continue;
    }

    const changes: string[] = [];
    if (d.decision !== l.decision) {
      changes.push(`decision: ${l.decision} → ${d.decision}`);
    }
    if (JSON.stringify(d.include) !== JSON.stringify(l.include)) {
      changes.push("include rules changed");
    }
    if (JSON.stringify(d.exclude || []) !== JSON.stringify(l.exclude || [])) {
      changes.push("exclude rules changed");
    }
    if (JSON.stringify(d.require || []) !== JSON.stringify(l.require || [])) {
      changes.push("require rules changed");
    }

    if (changes.length > 0) {
      results.push({ policyName: d.name, action: "update", changes });
    } else {
      results.push({ policyName: d.name, action: "noop" });
    }
  }

  for (const l of live) {
    if (!desiredMap.has(l.name)) {
      results.push({ policyName: l.name, action: "delete" });
    }
  }

  return results;
}

// ── Apply ────────────────────────────────────────────────────────────

export async function applyDiff(
  accountId: string,
  apiToken: string,
  diff: DiffResult[],
  desired: AccessPolicyConfig,
  live: LiveState,
  dryRun: boolean
): Promise<{ created: number; updated: number; deleted: number; errors: string[] }> {
  const result = { created: 0, updated: 0, deleted: 0, errors: [] as string[] };
  const liveAppMap = new Map(live.apps.map((a) => [a.name, a]));
  const desiredAppMap = new Map(desired.apps.map((a) => [a.name, a]));

  for (const d of diff) {
    if (d.action === "noop") continue;

    if (d.action === "create") {
      const appConfig = desiredAppMap.get(d.appName);
      if (!appConfig) continue;
      if (dryRun) {
        result.created++;
        continue;
      }
      try {
        const newApp = await apiCall<Record<string, unknown>>(
          accountId,
          apiToken,
          "/access/apps",
          "POST",
          {
            name: appConfig.name,
            domain: appConfig.domain,
            type: appConfig.type || DEFAULT_APP_TYPE,
            session_duration: appConfig.session_duration || DEFAULT_SESSION_DURATION,
            allowed_idps: appConfig.allowed_idps,
            policies: appConfig.policies,
          }
        );
        result.created++;
        // Update live state with new IDs for policy creation
        if (typeof newApp.id === "string") {
          liveAppMap.set(d.appName, {
            id: newApp.id,
            name: d.appName,
            policies: [],
          });
        }
      } catch (e: unknown) {
        result.errors.push(
          `Failed to create app ${d.appName}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      continue;
    }

    if (d.action === "delete") {
      const liveApp = liveAppMap.get(d.appName);
      if (!liveApp) continue;
      if (dryRun) {
        result.deleted++;
        continue;
      }
      try {
        await apiCall(accountId, apiToken, `/access/apps/${liveApp.id}`, "DELETE");
        result.deleted++;
      } catch (e: unknown) {
        result.errors.push(
          `Failed to delete app ${d.appName}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      continue;
    }

    if (d.action === "update") {
      const liveApp = liveAppMap.get(d.appName);
      const appConfig = desiredAppMap.get(d.appName);
      if (!liveApp || !appConfig) continue;

      if (dryRun) {
        result.updated++;
        continue;
      }

      try {
        // Update app settings
        const appUpdate: Record<string, unknown> = {};
        if (appConfig.domain) appUpdate.domain = appConfig.domain;
        if (appConfig.session_duration) appUpdate.session_duration = appConfig.session_duration;
        if (appConfig.allowed_idps) appUpdate.allowed_idps = appConfig.allowed_idps;

        if (Object.keys(appUpdate).length > 0) {
          await apiCall(accountId, apiToken, `/access/apps/${liveApp.id}`, "PUT", appUpdate);
        }

        // Update policies
        const livePolicyMap = new Map(liveApp.policies.map((p) => [p.name, p]));
        for (const pc of d.policyChanges || []) {
          if (pc.action === "create") {
            const policyConfig = appConfig.policies.find((p) => p.name === pc.policyName);
            if (!policyConfig) continue;
            await apiCall(accountId, apiToken, `/access/apps/${liveApp.id}/policies`, "POST", {
              name: policyConfig.name,
              decision: policyConfig.decision,
              include: policyConfig.include,
              exclude: policyConfig.exclude || [],
              require: policyConfig.require || [],
            });
          } else if (pc.action === "update") {
            const livePolicy = livePolicyMap.get(pc.policyName);
            const policyConfig = appConfig.policies.find((p) => p.name === pc.policyName);
            if (livePolicy && policyConfig) {
              await apiCall(
                accountId,
                apiToken,
                `/access/apps/${liveApp.id}/policies/${livePolicy.id}`,
                "PUT",
                {
                  name: policyConfig.name,
                  decision: policyConfig.decision,
                  include: policyConfig.include,
                  exclude: policyConfig.exclude || [],
                  require: policyConfig.require || [],
                }
              );
            }
          } else if (pc.action === "delete") {
            const livePolicy = livePolicyMap.get(pc.policyName);
            if (livePolicy) {
              await apiCall(
                accountId,
                apiToken,
                `/access/apps/${liveApp.id}/policies/${livePolicy.id}`,
                "DELETE"
              );
            }
          }
        }

        result.updated++;
      } catch (e: unknown) {
        result.errors.push(
          `Failed to update app ${d.appName}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  return result;
}

// ── API Helpers ──────────────────────────────────────────────────────

interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<{ result?: T; success?: boolean; errors?: Array<{ message: string }> }>;
}

export class CloudflareApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
    public readonly method: string,
    public readonly errors?: Array<{ message: string }>
  ) {
    super(message);
    this.name = "CloudflareApiError";
  }
}

export interface ApiRequestOptions {
  debug?: boolean;
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
}

export interface ApiRequestDebugLog {
  retry?: { attempt: number; maxRetries: number; delayMs: number; method: string; path: string };
  request?: { method: string; url: string; body?: unknown };
  response?: { method: string; path: string; status: number };
}

async function apiCall<T = unknown>(
  accountId: string,
  apiToken: string,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const resp = (await fetchWithTimeout(`${API_BASE}/accounts/${accountId}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    timeoutMs,
  })) as unknown as ApiResponse<T>;

  if (!resp.ok) {
    const text = await resp.text();
    throw new CloudflareApiError(
      `Cloudflare API ${resp.status}: ${text}`,
      resp.status,
      path,
      method
    );
  }

  const data = await resp.json();
  if (data.success === false) {
    const msg =
      data.errors?.map((e: { message: string }) => e.message).join("; ") || "API request failed";
    throw new CloudflareApiError(`Cloudflare API error: ${msg}`, 200, path, method, data.errors);
  }

  const empty: T = method === "GET" ? ([] as unknown as T) : ({} as unknown as T);
  return (data.result ?? empty) as T;
}

export async function apiRequest<T = unknown>(
  accountId: string,
  apiToken: string,
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
  options: ApiRequestOptions = {}
): Promise<T> {
  const {
    debug = false,
    retries = DEFAULT_RETRIES,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const url = `${API_BASE}/accounts/${accountId}${path}`;
  const debugLogs: ApiRequestDebugLog[] = [];
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      if (debug) {
        debugLogs.push({
          retry: { attempt, maxRetries: retries, delayMs: delay, method, path },
        });
      }
      await Bun.sleep(delay);
    }

    if (debug) {
      debugLogs.push({ request: { method, url, body } });
    }

    try {
      const result = await apiCall<T>(accountId, apiToken, path, method, body, timeoutMs);
      return result;
    } catch (e: unknown) {
      lastError = e instanceof Error ? e : new Error(String(e));
      // Only retry on 5xx or network errors, not on 4xx client errors
      const is5xx = e instanceof CloudflareApiError && e.status >= 500 && e.status < 600;
      const isNetworkError = !(e instanceof CloudflareApiError);
      if (!is5xx && !isNetworkError) {
        throw e;
      }
      if (attempt === retries) {
        break;
      }
    }
  }

  throw lastError || new Error(`Cloudflare API request failed after ${retries + 1} attempts`);
}
