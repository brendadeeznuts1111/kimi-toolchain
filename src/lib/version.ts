/**
 * src/lib/version.ts
 *
 * Canonical version module — single source of truth for all toolchain
 * version information. Derives toolchain version from package.json.
 *
 * Bun-native I/O, atomic manifest writes, SHA-256 integrity, version gating.
 */

import { dirname, join } from "path";
import { rename } from "node:fs/promises";
import { $ } from "bun";
import { manifestPath } from "./paths.ts";

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_VERSION = "0.0.0" as const;
const DEFAULT_NAME = "kimi-toolchain" as const;

/** Path to the desktop install manifest */
export const MANIFEST_PATH = manifestPath();

// ── Version resolution ─────────────────────────────────────────────────

let _versionCache: { version: string; name: string } | null = null;

async function resolveVersion(): Promise<{ version: string; name: string }> {
  if (_versionCache) return _versionCache;

  const pkgPath = join(import.meta.dir, "..", "..", "package.json");
  const pkg = await safeFileJson<{ version?: unknown; name?: unknown }>(pkgPath);
  if (pkg) {
    const version = typeof pkg.version === "string" ? pkg.version : DEFAULT_VERSION;
    const name = typeof pkg.name === "string" ? pkg.name : DEFAULT_NAME;
    _versionCache = { version, name };
    return _versionCache;
  }

  const manifest = await safeFileJson<{ toolchainVersion?: unknown }>(MANIFEST_PATH);
  if (manifest) {
    const version =
      typeof manifest.toolchainVersion === "string" ? manifest.toolchainVersion : DEFAULT_VERSION;
    _versionCache = { version, name: DEFAULT_NAME };
    return _versionCache;
  }

  _versionCache = { version: DEFAULT_VERSION, name: DEFAULT_NAME };
  return _versionCache;
}

/** Read a JSON file safely, returning null on any failure. */
async function safeFileJson<T>(path: string): Promise<T | null> {
  try {
    return (await Bun.file(path).json()) as T;
  } catch {
    return null;
  }
}

const { version: TOOLCHAIN_VERSION, name: TOOLCHAIN_NAME } = await resolveVersion();

/** Toolchain version from package.json (e.g. "0.1.0") */
export { TOOLCHAIN_VERSION };

/** Toolchain package name */
export { TOOLCHAIN_NAME };

/** MCP bridge version — unified with toolchain version */
export const MCP_BRIDGE_VERSION = TOOLCHAIN_VERSION;

// ── External version queries ───────────────────────────────────────────

/** Get the installed desktop app version via `kimi --version` */
export async function getDesktopVersion(): Promise<string | null> {
  if (!Bun.which("kimi")) return null;
  const result = await $`kimi --version`.quiet().nothrow();
  return result.stdout?.toString().trim() || null;
}

/** Get the current repo git HEAD short hash */
export async function getRepoHead(): Promise<string | null> {
  const result = await $`git rev-parse --short HEAD`.quiet().nothrow();
  return result.stdout?.toString().trim() || null;
}

/** Check if the repo has uncommitted changes */
export async function hasUncommittedChanges(): Promise<boolean> {
  const result = await $`git status --porcelain`.quiet().nothrow();
  return (result.stdout?.toString().trim().length ?? 0) > 0;
}

// ── Version gating & diagnostics ───────────────────────────────────────

/** Semver comparison using Bun.semver.order — handles pre-release tags correctly. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  return Bun.semver.order(a, b) as -1 | 0 | 1;
}

/** True if the running toolchain is at least `gate` version. */
export function isVersionAtLeast(gate: string): boolean {
  return compareVersions(TOOLCHAIN_VERSION, gate) >= 0;
}

/** Check if a version satisfies a semver range (e.g. ">=1.0.0 <2.0.0"). */
export function semverSatisfies(version: string, range: string): boolean {
  return Bun.semver.satisfies(version, range);
}

/** Validate that a string is a valid semver. */
export function isValidSemver(version: string): boolean {
  try {
    Bun.semver.order(version, "0.0.0");
    return true;
  } catch {
    return false;
  }
}

/** Returns true if versionA is less than versionB (safe for null inputs). */
export function versionBelow(a: string | null, b: string): boolean {
  if (!a) return true;
  return compareVersions(a, b) < 0;
}

/** Structured version matrix for diagnostics and API responses. */
export interface VersionInfo {
  toolchain: string;
  name: string;
  mcpBridge: string;
  desktop: string | null;
  gitHead: string | null;
  dirty: boolean;
  manifestPath: string;
}

/** Assemble canonical version matrix. */
export async function getVersionInfo(): Promise<VersionInfo> {
  const [desktop, gitHead, dirty] = await Promise.all([
    getDesktopVersion(),
    getRepoHead(),
    hasUncommittedChanges(),
  ]);
  return {
    toolchain: TOOLCHAIN_VERSION,
    name: TOOLCHAIN_NAME,
    mcpBridge: MCP_BRIDGE_VERSION,
    desktop,
    gitHead,
    dirty,
    manifestPath: MANIFEST_PATH,
  };
}

/** Format version matrix as Bun inspect table for CLI output. */
export function formatVersionTable(info: VersionInfo): string {
  return Bun.inspect.table(
    [
      { Component: "Toolchain", Version: info.toolchain },
      { Component: "MCP Bridge", Version: info.mcpBridge },
      { Component: "Desktop", Version: info.desktop ?? "not installed" },
      { Component: "Git HEAD", Version: info.gitHead ?? "n/a" },
      { Component: "Working Tree", Version: info.dirty ? "dirty" : "clean" },
    ],
    { headers: true },
  );
}

// ── Manifest I/O ───────────────────────────────────────────────────────

/** Desktop install manifest shape (v2 adds optional fileHashes) */
export interface ToolchainManifest {
  toolchainVersion: string;
  desktopVersion: string | null;
  gitHead: string | null;
  lastSyncedAt: string;
  files: string[];
  /** sha256 hex per sync path, e.g. "tools/kimi-doctor.ts" */
  fileHashes?: Record<string, string>;
}

/** Structured manifest validator — no external deps. */
function isToolchainManifest(val: unknown): val is ToolchainManifest {
  if (typeof val !== "object" || val === null) return false;
  const v = val as Record<string, unknown>;

  const isStr = (k: string) => typeof v[k] === "string";
  const isNullOrStr = (k: string) => v[k] === null || typeof v[k] === "string";
  const isStrArray = (k: string) =>
    Array.isArray(v[k]) && (v[k] as unknown[]).every((x) => typeof x === "string");
  const isOptStrRecord = (k: string) => {
    if (!(k in v) || v[k] === undefined) return true;
    if (typeof v[k] !== "object" || v[k] === null) return false;
    return Object.values(v[k] as Record<string, unknown>).every((x) => typeof x === "string");
  };

  return (
    isStr("toolchainVersion") &&
    isNullOrStr("desktopVersion") &&
    isNullOrStr("gitHead") &&
    isStr("lastSyncedAt") &&
    isStrArray("files") &&
    isOptStrRecord("fileHashes")
  );
}

/** Read the desktop install manifest if it exists */
export async function readManifest(): Promise<ToolchainManifest | null> {
  try {
    const parsed = await Bun.file(manifestPath()).json();
    return isToolchainManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Compute SHA-256 hex digest for a file (Bun-native). */
export async function hashFile(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(path).arrayBuffer());
  return hasher.digest("hex");
}

/** Write manifest atomically (temp + rename). */
export async function writeManifest(manifest: ToolchainManifest): Promise<void> {
  const path = manifestPath();
  await Bun.mkdir(dirname(path), { recursive: true });

  const tmp = `${path}.tmp.${Bun.randomUUIDv7()}`;
  const payload = JSON.stringify(manifest, null, 2) + "\n";

  await Bun.write(tmp, payload);
  await rename(tmp, path);
}
