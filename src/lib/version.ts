/**
 * src/lib/version.ts
 *
 * Canonical version module — single source of truth for all toolchain
 * version information. Derives toolchain version from package.json.
 */

import { makeDir } from "./bun-io.ts";
import { dirname, join } from "path";
import { $ } from "bun";
import { manifestPath } from "./paths.ts";
import { safeParse } from "./utils.ts";

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_VERSION = "0.0.0";
const DEFAULT_NAME = "kimi-toolchain";

/** Path to the desktop install manifest */
export const MANIFEST_PATH = manifestPath();

// ── Version resolution ─────────────────────────────────────────────────

async function resolveVersion(): Promise<{ version: string; name: string }> {
  // Try repo package.json first (when running from the repo)
  const pkgPath = join(import.meta.dir, "..", "..", "package.json");
  const pkg = await safeFileJson<{ version?: unknown; name?: unknown }>(pkgPath);
  if (pkg) {
    const version = typeof pkg.version === "string" ? pkg.version : DEFAULT_VERSION;
    const name = typeof pkg.name === "string" ? pkg.name : DEFAULT_NAME;
    return { version, name };
  }

  // Fall back to manifest (when running from desktop install)
  const manifest = await safeFileJson<{ toolchainVersion?: unknown }>(MANIFEST_PATH);
  if (manifest) {
    const version =
      typeof manifest.toolchainVersion === "string" ? manifest.toolchainVersion : DEFAULT_VERSION;
    return { version, name: DEFAULT_NAME };
  }

  return { version: DEFAULT_VERSION, name: DEFAULT_NAME };
}

/** Read a JSON file safely, returning null on any failure. */
async function safeFileJson<T>(path: string): Promise<T | null> {
  try {
    const text = await Bun.file(path).text();
    return safeParse<T>(text, null as T);
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
    return safeParse(text, null, isToolchainManifest);
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
