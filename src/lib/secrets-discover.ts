/**
 * secrets-discover.ts — Read-only keychain inventory vs secrets-policy.json5.
 *
 * Metadata only: parses `security dump-keychain` attributes (service/account)
 * and never reads secret values or writes to the keychain. Safe to run any time.
 */

import { $ } from "bun";
import { homeDir, secretsPolicyPath } from "./paths.ts";
import { getAllPolicyEntries, isStale, loadSecretsPolicy } from "./secrets-policy.ts";
import type { SecretPolicyEntry } from "./secrets-types.ts";

export interface DiscoveredSecretName {
  name: string;
  present: boolean;
  /** Rotation state from policy; null when the secret is not in the keychain. */
  rotation: "stale" | "untracked" | "ok" | null;
}

export interface DiscoveredService {
  service: string;
  present: number;
  missing: number;
  names: DiscoveredSecretName[];
}

export interface UnregisteredNamespace {
  namespace: string;
  services: string[];
  items: number;
}

export interface SecretsDiscoverReport {
  backend: "keychain" | "unsupported";
  totalItems: number;
  totalServices: number;
  registered: DiscoveredService[];
  registeredPresent: number;
  registeredMissing: number;
  unregistered: UnregisteredNamespace[];
  warnings: string[];
}

/** Parse `security dump-keychain` output into service → account names (metadata only). */
export function parseKeychainDump(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  // Each item block starts with `keychain: "..."`; attributes live inside it.
  for (const block of text.split(/^keychain: /m).slice(1)) {
    const svc = /"svce"<blob>="([^"]*)"/.exec(block)?.[1];
    if (!svc) continue;
    const acct = /"acct"<blob>="([^"]*)"/.exec(block)?.[1] ?? "";
    const accounts = map.get(svc) ?? [];
    accounts.push(acct);
    map.set(svc, accounts);
  }
  return map;
}

/** Namespace bucket for sprawl reporting: reverse-domain prefix or first label. */
export function namespaceOf(service: string): string {
  const parts = service.split(".");
  if (parts[0] === "com" && parts.length > 1) return `${parts[0]}.${parts[1]}`;
  return service.split("-")[0] ?? service;
}

/** Build the presence matrix + sprawl report from policy entries and keychain metadata. */
export function buildDiscoverReport(
  entries: Array<{ service: string; name: string; entry: SecretPolicyEntry }>,
  dump: Map<string, string[]>,
  options: { now?: Date; unsupported?: boolean } = {}
): SecretsDiscoverReport {
  const now = options.now ?? new Date();
  const byService = new Map<string, DiscoveredService>();
  let registeredPresent = 0;
  let registeredMissing = 0;

  for (const { service, name, entry } of entries) {
    const present = (dump.get(service) ?? []).includes(name);
    if (present) registeredPresent++;
    else registeredMissing++;
    let rotation: DiscoveredSecretName["rotation"] = null;
    if (present) {
      if (entry.lastRotated === null) rotation = "untracked";
      else rotation = isStale(entry, now).stale ? "stale" : "ok";
    }
    const row = byService.get(service) ?? { service, present: 0, missing: 0, names: [] };
    if (present) row.present++;
    else row.missing++;
    row.names.push({ name, present, rotation });
    byService.set(service, row);
  }

  const registeredServices = new Set(entries.map((e) => e.service));
  const sprawl = new Map<string, { services: Set<string>; items: number }>();
  let totalItems = 0;
  for (const [service, accounts] of dump) {
    totalItems += accounts.length;
    if (registeredServices.has(service)) continue;
    const ns = namespaceOf(service);
    const bucket = sprawl.get(ns) ?? { services: new Set<string>(), items: 0 };
    bucket.services.add(service);
    bucket.items += accounts.length;
    sprawl.set(ns, bucket);
  }

  const unregistered: UnregisteredNamespace[] = [...sprawl.entries()]
    .map(([namespace, bucket]) => ({
      namespace,
      services: [...bucket.services].sort(),
      items: bucket.items,
    }))
    .sort((a, b) => b.items - a.items);

  return {
    backend: options.unsupported ? "unsupported" : "keychain",
    totalItems,
    totalServices: dump.size,
    registered: [...byService.values()].sort((a, b) => a.service.localeCompare(b.service)),
    registeredPresent,
    registeredMissing,
    unregistered,
    warnings: options.unsupported
      ? ["keychain dump is macOS-only; registered presence reflects this platform only"]
      : [],
  };
}

/** Dump login-keychain metadata (no secret values). macOS only. */
export async function dumpKeychainMetadata(home: string = homeDir()): Promise<string> {
  if (process.platform !== "darwin") return "";
  const keychain = `${home}/Library/Keychains/login.keychain-db`;
  const result = await $`security dump-keychain ${keychain}`.nothrow().quiet();
  if (result.exitCode !== 0) return "";
  return result.stdout.toString();
}

/** Full read-only discovery: policy presence matrix + unregistered sprawl. */
export async function discoverSecrets(
  projectRoot: string,
  options: { home?: string; now?: Date } = {}
): Promise<SecretsDiscoverReport> {
  const policy = await loadSecretsPolicy(secretsPolicyPath(projectRoot));
  const entries = getAllPolicyEntries(policy);
  const dumpText = await dumpKeychainMetadata(options.home);
  const unsupported = process.platform !== "darwin" || dumpText.length === 0;
  return buildDiscoverReport(entries, parseKeychainDump(dumpText), {
    now: options.now,
    unsupported,
  });
}
