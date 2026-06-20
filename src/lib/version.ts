/**
 * src/lib/version.ts
 *
 * Canonical version module — single source of truth for all toolchain
 * version information. Derives toolchain version from package.json.
 */

import { makeDir, pathExists, readText } from "./bun-io.ts";
import { dirname, join } from "path";
import { $ } from "bun";
import { manifestPath } from "./paths.ts";

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_VERSION = "0.0.0";
const DEFAULT_NAME = "kimi-toolchain";

/** Path to the desktop install manifest */
export const MANIFEST_PATH = manifestPath();

// ── Version resolution ─────────────────────────────────────────────────

function resolveVersion(): { version: string; name: string } {
  // Try repo package.json first (when running from the repo)
  const pkgPath = join(import.meta.dir, "..", "..", "package.json");
  if (pathExists(pkgPath)) {
    const pkg = parseJsonText<{ version?: unknown; name?: unknown }>(readText(pkgPath));
    if (pkg) {
      const version = typeof pkg.version === "string" ? pkg.version : DEFAULT_VERSION;
      const name = typeof pkg.name === "string" ? pkg.name : DEFAULT_NAME;
      return { version, name };
    }
  }

  // Fall back to manifest (when running from desktop install)
  if (pathExists(MANIFEST_PATH)) {
    const manifest = parseJsonText<{ toolchainVersion?: unknown }>(readText(MANIFEST_PATH));
    if (manifest) {
      const version =
        typeof manifest.toolchainVersion === "string" ? manifest.toolchainVersion : DEFAULT_VERSION;
      return { version, name: DEFAULT_NAME };
    }
  }

  return { version: DEFAULT_VERSION, name: DEFAULT_NAME };
}

/** Parse JSON text without pulling in utils.ts (breaks version ↔ tool-runner cycle). */
function parseJsonText<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

const { version: TOOLCHAIN_VERSION, name: TOOLCHAIN_NAME } = resolveVersion();

/** Toolchain version from package.json (e.g. "0.1.0") */
export { TOOLCHAIN_VERSION };

/** Toolchain package name */
export { TOOLCHAIN_NAME };

/** MCP bridge version — unified with toolchain version */
export const MCP_BRIDGE_VERSION = TOOLCHAIN_VERSION;

// ── External version queries ───────────────────────────────────────────

/** Get the installed desktop app version via `kimi --version` */
export async function getDesktopVersion(): Promise<string | null> {
  const result = await $`kimi --version`.quiet().nothrow();
  const out = result.stdout?.toString().trim();
  return out || null;
}

/** Get the current repo git HEAD short hash */
export async function getRepoHead(): Promise<string | null> {
  const result = await $`git rev-parse --short HEAD`.quiet().nothrow();
  const out = result.stdout?.toString().trim();
  return out || null;
}

/** Check if the repo has uncommitted changes */
export async function hasUncommittedChanges(): Promise<boolean> {
  const result = await $`git status --porcelain`.quiet().nothrow();
  const out = result.stdout?.toString().trim();
  return (out?.length ?? 0) > 0;
}

// ── Semver utilities ────────────────────────────────────────────────────

/** Compare two semver strings. Returns -1 (a < b), 0 (equal), or 1 (a > b). */
export function semverCompare(a: string, b: string): -1 | 0 | 1 {
  return Bun.semver.order(a, b) as -1 | 0 | 1;
}

/** Returns true if version satisfies the given range (e.g. ">=1.0.0 <2.0.0"). */
export function semverSatisfies(version: string, range: string): boolean {
  return Bun.semver.satisfies(version, range);
}

/** Validate that a string is a valid semver (e.g. "1.2.3", "0.18.0-canary.1"). */
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
  return semverCompare(a, b) < 0;
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

function isToolchainManifest(val: unknown): val is ToolchainManifest {
  if (typeof val !== "object" || val === null) return false;
  const v = val as Record<string, unknown>;
  return (
    typeof v.toolchainVersion === "string" &&
    (v.desktopVersion === null || typeof v.desktopVersion === "string") &&
    (v.gitHead === null || typeof v.gitHead === "string") &&
    typeof v.lastSyncedAt === "string" &&
    Array.isArray(v.files) &&
    v.files.every((f) => typeof f === "string") &&
    (v.fileHashes === undefined ||
      (typeof v.fileHashes === "object" &&
        v.fileHashes !== null &&
        Object.values(v.fileHashes).every((h) => typeof h === "string")))
  );
}

/** Read the desktop install manifest if it exists */
export async function readManifest(): Promise<ToolchainManifest | null> {
  try {
    const text = await Bun.file(manifestPath()).text();
    const parsed = parseJsonText<unknown>(text);
    return parsed !== null && isToolchainManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Write the desktop install manifest */
export async function writeManifest(manifest: ToolchainManifest): Promise<void> {
  const path = manifestPath();
  makeDir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(manifest, null, 2) + "\n");
}
