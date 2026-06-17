/**
 * DX config domain — pure merge logic and typed accessors.
 *
 * The resolver owns *loading and merging* global + project config.
 * Individual domains (PropertyTable, Herdr, Doctor, etc.) parse their own
 * slices from the merged `DxConfigDocument`.
 */

import { Effect } from "effect";
import { ConfigReadError } from "./dx-config-errors.ts";

export type ArrayMergePolicy = "replace" | "append" | "appendUnique" | "mergeByName";

export interface MergePolicyEntry {
  readonly path: string;
  readonly policy: ArrayMergePolicy;
}

export interface DxConfigMergeOptions {
  readonly policies?: readonly MergePolicyEntry[];
  readonly defaultArrayPolicy?: ArrayMergePolicy;
}

export interface DxConfigDocument {
  readonly raw: Record<string, unknown>;
  readonly global: Record<string, unknown>;
  readonly project: Record<string, unknown>;
}

export interface AgentContext {
  readonly firstRead: string[];
  readonly bootstrap: string[];
  readonly iterate?: string;
  readonly fullValidation?: string;
  readonly prePush: string[];
  readonly handoff: string[];
  readonly avoid: string[];
  readonly skills?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return isStringArray(value) ? value.map((s) => s.trim()) : [];
}

function normalizePolicies(options: DxConfigMergeOptions): Map<string, ArrayMergePolicy> {
  const map = new Map<string, ArrayMergePolicy>();
  for (const entry of options.policies ?? []) {
    map.set(entry.path, entry.policy);
  }
  return map;
}

function resolvePolicy(
  path: string,
  policies: Map<string, ArrayMergePolicy>,
  defaultPolicy: ArrayMergePolicy
): ArrayMergePolicy {
  return policies.get(path) ?? defaultPolicy;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

function applyArrayPolicy(
  base: unknown[],
  override: unknown[],
  policy: ArrayMergePolicy,
  path: string,
  policies: Map<string, ArrayMergePolicy>,
  defaultPolicy: ArrayMergePolicy
): unknown[] {
  switch (policy) {
    case "replace":
      return [...override];
    case "append":
      return [...base, ...override];
    case "appendUnique": {
      const out = [...base];
      for (const item of override) {
        if (!out.some((existing) => deepEqual(existing, item))) {
          out.push(item);
        }
      }
      return out;
    }
    case "mergeByName": {
      const out = [...base];
      for (const item of override) {
        if (isRecord(item) && typeof item.name === "string") {
          const idx = out.findIndex(
            (existing) => isRecord(existing) && existing.name === item.name
          );
          if (idx >= 0) {
            out[idx] = mergeValues(out[idx], item, path, policies, defaultPolicy);
          } else {
            out.push(item);
          }
        } else {
          out.push(item);
        }
      }
      return out;
    }
  }
}

function mergeValues(
  base: unknown,
  override: unknown,
  path: string,
  policies: Map<string, ArrayMergePolicy>,
  defaultPolicy: ArrayMergePolicy
): unknown {
  if (isRecord(base) && isRecord(override)) {
    return mergeRecords(base, override, path, policies, defaultPolicy);
  }
  if (Array.isArray(base) && Array.isArray(override)) {
    const policy = resolvePolicy(path, policies, defaultPolicy);
    return applyArrayPolicy(base, override, policy, path, policies, defaultPolicy);
  }
  return override;
}

function mergeRecords(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
  path: string,
  policies: Map<string, ArrayMergePolicy>,
  defaultPolicy: ArrayMergePolicy
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const childPath = path ? `${path}.${key}` : key;
    result[key] = mergeValues(result[key], value, childPath, policies, defaultPolicy);
  }
  return result;
}

/** Deep-merge global and project config documents. */
export function mergeConfigs(
  globalConfig: Record<string, unknown>,
  projectConfig: Record<string, unknown>,
  options: DxConfigMergeOptions = {}
): DxConfigDocument {
  const policies = normalizePolicies(options);
  const defaultPolicy = options.defaultArrayPolicy ?? "replace";
  const raw = mergeRecords(globalConfig, projectConfig, "", policies, defaultPolicy);
  return { raw, global: globalConfig, project: projectConfig };
}

/** Load and parse a TOML config file. */
export function loadConfigFile(
  path: string
): Effect.Effect<Record<string, unknown>, ConfigReadError> {
  return Effect.gen(function* () {
    const file = Bun.file(path);
    const exists = yield* Effect.tryPromise({
      try: () => file.exists(),
      catch: () => new ConfigReadError({ path, reason: "not_found" }),
    });
    if (!exists) {
      return yield* Effect.fail(new ConfigReadError({ path, reason: "not_found" }));
    }
    const text = yield* Effect.tryPromise({
      try: () => file.text(),
      catch: () => new ConfigReadError({ path, reason: "invalid_format" }),
    });
    return yield* Effect.try({
      try: () => Bun.TOML.parse(text) as Record<string, unknown>,
      catch: () => new ConfigReadError({ path, reason: "parse_failed" }),
    });
  });
}

/** Read a top-level section from the merged document. */
export function getSection<T>(doc: DxConfigDocument, key: string): T | undefined {
  const value = doc.raw[key];
  return value as T | undefined;
}

/** Parse agent-context fields from the merged document. */
export function getAgentContext(doc: DxConfigDocument): AgentContext {
  const agents = getSection<Record<string, unknown>>(doc, "agents") ?? {};
  return {
    firstRead: readStringArray(agents.firstRead),
    bootstrap: readStringArray(agents.bootstrap),
    iterate: readString(agents.iterate),
    fullValidation: readString(agents.fullValidation),
    prePush: readStringArray(agents.prePush),
    handoff: readStringArray(agents.handoff),
    avoid: readStringArray(agents.avoid),
    skills: isRecord(agents.skills) ? agents.skills : undefined,
  };
}
