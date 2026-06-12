/**
 * cloudflare-access-policy.ts — Policy-as-Code for Cloudflare Access
 *
 * Defines desired Access application/policy state in `.cloudflare-access.yml`,
 * diffs against live Cloudflare state, and applies changes.
 */

import { fetchWithTimeout } from "./utils.ts";

const API_BASE = "https://api.cloudflare.com/client/v4";

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
  // Try JSON first (native parse, most reliable)
  const jsonPaths = [`${cwd}/.cloudflare-access.json`, `${cwd}/cloudflare-access.json`];
  for (const p of jsonPaths) {
    const file = Bun.file(p);
    if (await file.exists()) {
      try {
        return (await file.json()) as AccessPolicyConfig;
      } catch {
        // Fall through to YAML
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
      } catch {
        return parsePolicyConfig(text);
      }
    }
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

  function currentList(): Array<Record<string, unknown>> | null {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].type === "list") return (stack[i] as Extract<StackEntry, { type: "list" }>).arr;
    }
    return null;
  }

  function currentObject(): Record<string, unknown> | null {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].type === "object")
        return (stack[i] as Extract<StackEntry, { type: "object" }>).obj;
      if (stack[i].type === "policy")
        return (stack[i] as Extract<StackEntry, { type: "policy" }>).policy as unknown as Record<
          string,
          unknown
        >;
      if (stack[i].type === "app")
        return (stack[i] as Extract<StackEntry, { type: "app" }>).app as unknown as Record<
          string,
          unknown
        >;
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

export interface DiffResult {
  appName: string;
  action: "create" | "update" | "delete" | "noop";
  appChanges?: string[];
  policyChanges?: Array<{
    policyName: string;
    action: "create" | "update" | "delete" | "noop";
    changes?: string[];
  }>;
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
  const apps = (await apiGet(accountId, apiToken, "/access/apps")) as Array<{
    id: string;
    name: string;
    domain?: string;
    type?: string;
    session_duration?: string;
    allowed_idps?: string[];
    policies: LiveState["apps"][0]["policies"];
  }>;
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
          action: "create",
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
): Array<{
  policyName: string;
  action: "create" | "update" | "delete" | "noop";
  changes?: string[];
}> {
  const results: Array<{
    policyName: string;
    action: "create" | "update" | "delete" | "noop";
    changes?: string[];
  }> = [];
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
      const appConfig = desiredAppMap.get(d.appName)!;
      if (dryRun) {
        result.created++;
        continue;
      }
      try {
        const newApp = await apiPost(accountId, apiToken, "/access/apps", {
          name: appConfig.name,
          domain: appConfig.domain,
          type: appConfig.type || "self_hosted",
          session_duration: appConfig.session_duration || "24h",
          allowed_idps: appConfig.allowed_idps,
          policies: appConfig.policies,
        });
        result.created++;
        // Update live state with new IDs for policy creation
        if (newApp && typeof newApp === "object" && "id" in newApp) {
          const appWithId = newApp as { id: string };
          liveAppMap.set(d.appName, {
            id: appWithId.id,
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
        await apiDelete(accountId, apiToken, `/access/apps/${liveApp.id}`);
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
          await apiPut(accountId, apiToken, `/access/apps/${liveApp.id}`, appUpdate);
        }

        // Update policies
        const livePolicyMap = new Map(liveApp.policies.map((p) => [p.name, p]));
        for (const pc of d.policyChanges || []) {
          if (pc.action === "create") {
            const policyConfig = appConfig.policies.find((p) => p.name === pc.policyName)!;
            await apiPost(accountId, apiToken, `/access/apps/${liveApp.id}/policies`, {
              name: policyConfig.name,
              decision: policyConfig.decision,
              include: policyConfig.include,
              exclude: policyConfig.exclude || [],
              require: policyConfig.require || [],
            });
          } else if (pc.action === "update") {
            const livePolicy = livePolicyMap.get(pc.policyName);
            const policyConfig = appConfig.policies.find((p) => p.name === pc.policyName)!;
            if (livePolicy) {
              await apiPut(
                accountId,
                apiToken,
                `/access/apps/${liveApp.id}/policies/${livePolicy.id}`,
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
              await apiDelete(
                accountId,
                apiToken,
                `/access/apps/${liveApp.id}/policies/${livePolicy.id}`
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

async function apiGet<T = unknown>(accountId: string, apiToken: string, path: string): Promise<T> {
  const resp = (await fetchWithTimeout(`${API_BASE}/accounts/${accountId}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    timeoutMs: 30000,
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
  return (data.result || ([] as T)) as T;
}

async function apiPost<T = unknown>(
  accountId: string,
  apiToken: string,
  path: string,
  body: unknown
): Promise<T> {
  const resp = (await fetchWithTimeout(`${API_BASE}/accounts/${accountId}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 30000,
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
  return (data.result || ({} as T)) as T;
}

async function apiPut<T = unknown>(
  accountId: string,
  apiToken: string,
  path: string,
  body: unknown
): Promise<T> {
  const resp = (await fetchWithTimeout(`${API_BASE}/accounts/${accountId}${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 30000,
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
  return (data.result || ({} as T)) as T;
}

async function apiDelete<T = unknown>(
  accountId: string,
  apiToken: string,
  path: string
): Promise<T> {
  const resp = (await fetchWithTimeout(`${API_BASE}/accounts/${accountId}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    timeoutMs: 30000,
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
  return (data.result || ({} as T)) as T;
}
