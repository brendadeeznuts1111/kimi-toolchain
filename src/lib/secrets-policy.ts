/**
 * secrets-policy.ts — Loader, validator, and env-override merge for secrets-policy.json5.
 *
 * Uses the existing config-loader.ts facade for format detection and parsing.
 * JSON5 is preferred (Bun >= 1.3.7); JSON fallback is valid JSON5.
 */

import { loadConfig, detectConfigFormat, json5Supported } from "./config-loader.ts";
import { STORAGE_TIERS } from "./secrets-storage.ts";
import type {
  SecretsPolicyDocument,
  SecretPolicyEntry,
  StorageBackend,
  ValidationResult,
} from "./secrets-types.ts";

const SCHEMA_VERSION = "v1";

export async function loadSecretsPolicy(policyPath: string): Promise<SecretsPolicyDocument> {
  const file = Bun.file(policyPath);
  if (!(await file.exists())) {
    return { $schema: SCHEMA_VERSION };
  }
  const text = await file.text();
  const format = detectConfigFormat(policyPath);
  const fallback: SecretsPolicyDocument = { $schema: SCHEMA_VERSION };
  return loadConfig<SecretsPolicyDocument>(text, format, fallback);
}

export function validateSecretsPolicy(doc: unknown): ValidationResult<SecretsPolicyDocument> {
  const errors: string[] = [];

  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: ["Policy document must be an object"] };
  }

  const obj = doc as Record<string, unknown>;

  if (obj.$schema !== SCHEMA_VERSION) {
    errors.push(`$schema must be "${SCHEMA_VERSION}", got "${String(obj.$schema)}"`);
  }

  for (const [service, serviceEntry] of Object.entries(obj)) {
    if (service === "$schema") continue;

    if (typeof serviceEntry !== "object" || serviceEntry === null) {
      errors.push(`Service "${service}" must be an object`);
      continue;
    }

    for (const [name, entry] of Object.entries(serviceEntry as Record<string, unknown>)) {
      const entryErrors = validatePolicyEntry(entry, `${service}/${name}`);
      errors.push(...entryErrors);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, errors: [], value: doc as SecretsPolicyDocument };
}

function validatePolicyEntry(entry: unknown, path: string): string[] {
  const errors: string[] = [];

  if (!entry || typeof entry !== "object") {
    return [`Policy entry "${path}" must be an object`];
  }

  const e = entry as Record<string, unknown>;

  if (!Array.isArray(e.allowedConsumers) || e.allowedConsumers.length === 0) {
    errors.push(`Policy entry "${path}": allowedConsumers must be a non-empty array`);
  } else if (!e.allowedConsumers.every((c) => typeof c === "string")) {
    errors.push(`Policy entry "${path}": allowedConsumers must be strings`);
  }

  if (
    typeof e.rotationDays !== "number" ||
    e.rotationDays <= 0 ||
    !Number.isInteger(e.rotationDays)
  ) {
    errors.push(`Policy entry "${path}": rotationDays must be a positive integer`);
  }

  if (e.lastRotated !== null && typeof e.lastRotated !== "string") {
    errors.push(`Policy entry "${path}": lastRotated must be string or null`);
  } else if (typeof e.lastRotated === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(e.lastRotated)) {
    errors.push(`Policy entry "${path}": lastRotated must be YYYY-MM-DD format`);
  }

  if (typeof e.version !== "number" || e.version <= 0 || !Number.isInteger(e.version)) {
    errors.push(`Policy entry "${path}": version must be a positive integer`);
  }

  if (e.storageTier !== undefined) {
    if (
      typeof e.storageTier !== "string" ||
      !STORAGE_TIERS.includes(e.storageTier as StorageBackend)
    ) {
      errors.push(`Policy entry "${path}": storageTier must be one of ${STORAGE_TIERS.join(", ")}`);
    }
  }

  if (e.expiresAt !== undefined && e.expiresAt !== null) {
    if (typeof e.expiresAt !== "string" || isNaN(Date.parse(e.expiresAt))) {
      errors.push(`Policy entry "${path}": expiresAt must be a valid ISO 8601 datetime or null`);
    }
  }

  if (e.environments !== undefined) {
    if (typeof e.environments !== "object" || e.environments === null) {
      errors.push(`Policy entry "${path}": environments must be an object`);
    } else {
      for (const [envName, envEntry] of Object.entries(e.environments as Record<string, unknown>)) {
        if (typeof envName !== "string" || !envName) {
          errors.push(`Policy entry "${path}": environment name must be non-empty string`);
        }
        if (typeof envEntry !== "object" || envEntry === null) {
          errors.push(`Policy entry "${path}": environment "${envName}" must be an object`);
        }
      }
    }
  }

  return errors;
}

export function resolvePolicyEntry(entry: SecretPolicyEntry, env?: string): SecretPolicyEntry {
  const envName = env ?? Bun.env.NODE_ENV ?? "development";
  const override = entry.environments?.[envName];
  if (!override) return entry;
  return { ...entry, ...override, environments: undefined };
}

export function getPolicyEntry(
  doc: SecretsPolicyDocument,
  service: string,
  name: string,
  env?: string
): SecretPolicyEntry | null {
  const serviceEntry = doc[service];
  if (!serviceEntry || typeof serviceEntry !== "object") return null;
  const entry = (serviceEntry as Record<string, SecretPolicyEntry>)[name];
  if (!entry) return null;
  return resolvePolicyEntry(entry, env);
}

export function getAllPolicyEntries(
  doc: SecretsPolicyDocument
): Array<{ service: string; name: string; entry: SecretPolicyEntry }> {
  const results: Array<{ service: string; name: string; entry: SecretPolicyEntry }> = [];
  for (const [service, serviceEntry] of Object.entries(doc)) {
    if (service === "$schema") continue;
    if (typeof serviceEntry !== "object" || serviceEntry === null) continue;
    for (const [name, entry] of Object.entries(serviceEntry as Record<string, SecretPolicyEntry>)) {
      results.push({ service, name, entry });
    }
  }
  return results;
}

export async function writeSecretsPolicy(
  policyPath: string,
  doc: SecretsPolicyDocument
): Promise<void> {
  const text = json5Supported()
    ? (
        Bun.JSON5 as {
          stringify: (value: unknown, replacer?: unknown, space?: string | number) => string;
        }
      ).stringify(doc, null, 2)
    : JSON.stringify(doc, null, 2);
  await Bun.write(policyPath, text + "\n");
}

/**
 * Surgically update one entry's version/lastRotated in place, preserving the
 * curated file's comments, quoting, and formatting. Returns false when the
 * entry can't be located (caller should fall back to writeSecretsPolicy).
 */
export async function patchSecretsPolicyEntry(
  policyPath: string,
  service: string,
  name: string,
  updates: { version: number; lastRotated: string }
): Promise<boolean> {
  const text = await Bun.file(policyPath).text();
  const lines = text.split("\n");
  const keyRe = /^(\s*)["']([^"']+)["']:\s*\{/;
  const rotatedRe = /^(\s*["']?lastRotated["']?\s*:\s*).*$/;
  const versionRe = /^(\s*["']?version["']?\s*:\s*).*$/;

  let currentService: string | null = null;
  let inEntry = false;
  let entryDepth = 0;
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const original = lines[i]!;
    const key = keyRe.exec(original);
    if (key) {
      const depth = key[1]!.length;
      if (inEntry && depth <= entryDepth) inEntry = false;
      if (depth === 2) currentService = key[2]!;
      else if (currentService === service && key[2] === name && !inEntry) {
        inEntry = true;
        entryDepth = depth;
        found = true;
      }
      continue;
    }
    if (!inEntry) continue;
    const rotated = rotatedRe.exec(original);
    if (rotated) {
      lines[i] = `${rotated[1]}${JSON.stringify(updates.lastRotated)},`;
      continue;
    }
    const version = versionRe.exec(original);
    if (version) {
      lines[i] = `${version[1]}${updates.version},`;
    }
  }

  if (!found) return false;
  await Bun.write(policyPath, lines.join("\n"));
  return true;
}

export function daysSince(dateStr: string | null, now: Date): number | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

export function isStale(
  entry: SecretPolicyEntry,
  now: Date
): { stale: boolean; daysStale: number | null } {
  const days = daysSince(entry.lastRotated, now);
  if (days === null) return { stale: true, daysStale: null };
  return { stale: days > entry.rotationDays, daysStale: days };
}

export function todayDateString(): string {
  return new Date().toISOString().split("T")[0] ?? new Date().toISOString();
}
