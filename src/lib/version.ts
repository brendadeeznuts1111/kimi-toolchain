/**
 * src/lib/version.ts
 *
 * Canonical version module — single source of truth for all toolchain
 * version information. Derives toolchain version from package.json.
 *
 * Bun-native I/O, atomic manifest writes, SHA-256 integrity, version gating.
 */

import { dirname, join } from "path";
import { buildInfo } from "./build-info.ts";
import { $ } from "bun";
import { makeDir, movePath, pathExists, readText } from "./bun-io.ts";
import { manifestPath } from "./paths.ts";

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_VERSION = "0.0.0" as const;
const DEFAULT_NAME = "kimi-toolchain" as const;

/** Path to the desktop install manifest */
export const MANIFEST_PATH = manifestPath();

// Resolve version synchronously at module load to avoid top-level await TDZ
// for consumers (e.g. test describe callbacks) and keep exports constants.
const pkgPath = join(import.meta.dir, "..", "..", "package.json");
let _version: string = DEFAULT_VERSION;
let _name: string = DEFAULT_NAME;
try {
  const pkg = JSON.parse(readText(pkgPath)) as { version?: unknown; name?: unknown };
  if (typeof pkg.version === "string") _version = pkg.version;
  if (typeof pkg.name === "string") _name = pkg.name;
} catch {
  // package.json missing in installed runtime; fall through to manifest.
}
if (_version === DEFAULT_VERSION && pathExists(MANIFEST_PATH)) {
  try {
    const manifest = JSON.parse(readText(MANIFEST_PATH)) as { toolchainVersion?: unknown };
    if (typeof manifest.toolchainVersion === "string") _version = manifest.toolchainVersion;
  } catch {
    // ignore malformed/missing manifest
  }
}

/** Toolchain version from package.json or compile-time define (e.g. "0.1.0") */
export const TOOLCHAIN_VERSION =
  typeof KIMI_BUILD_VERSION === "string" && KIMI_BUILD_VERSION.length > 0
    ? KIMI_BUILD_VERSION
    : _version;

/** Toolchain package name */
export const TOOLCHAIN_NAME = _name;

/** MCP bridge version — unified with toolchain version */
export const MCP_BRIDGE_VERSION = TOOLCHAIN_VERSION;

/** Build timestamp (ISO 8601) when compiled with build-time defines. */
export const BUILD_TIME =
  typeof KIMI_BUILD_TIME === "string" && KIMI_BUILD_TIME.length > 0 ? KIMI_BUILD_TIME : null;

/** Git commit hash — from macros at bundle time, or define constant at dev time. */
export const GIT_COMMIT = buildInfo.gitHash !== "unknown" ? buildInfo.gitHash : (
  typeof KIMI_GIT_COMMIT === "string" && KIMI_GIT_COMMIT.length > 0 ? KIMI_GIT_COMMIT : null
);

/** Build channel baked in at compile time (e.g. "release"). */
export const BUILD_CHANNEL =
  typeof KIMI_BUILD_CHANNEL === "string" && KIMI_BUILD_CHANNEL.length > 0
    ? KIMI_BUILD_CHANNEL
    : null;

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
// All version comparisons use Bun.semver.order / Bun.semver.satisfies directly.
// @see https://bun.com/docs/runtime/semver

/** Structured version matrix for diagnostics and API responses. */
export interface VersionInfo {
  toolchain: string;
  name: string;
  mcpBridge: string;
  desktop: string | null;
  gitHead: string | null;
  dirty: boolean;
  manifestPath: string;
  buildTime: string | null;
  gitCommit: string | null;
  buildChannel: string | null;
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
    buildTime: BUILD_TIME,
    gitCommit: GIT_COMMIT,
    buildChannel: BUILD_CHANNEL,
  };
}

/** Format version matrix as Bun inspect table for CLI output. */
export function formatVersionTable(info: VersionInfo): string {
  const table = Bun.inspect.table as (rows: object[], options?: { headers?: boolean }) => string;
  return table(
    [
      { Component: "Toolchain", Version: info.toolchain },
      { Component: "MCP Bridge", Version: info.mcpBridge },
      { Component: "Desktop", Version: info.desktop ?? "not installed" },
      { Component: "Git HEAD", Version: info.gitHead ?? "n/a" },
      { Component: "Working Tree", Version: info.dirty ? "dirty" : "clean" },
      { Component: "Build Time", Version: info.buildTime ?? "n/a" },
      { Component: "Build Commit", Version: info.gitCommit ?? "n/a" },
      { Component: "Build Channel", Version: info.buildChannel ?? "source" },
    ],
    { headers: true }
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
export function isToolchainManifest(val: unknown): val is ToolchainManifest {
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
  const path = manifestPath();
  if (!pathExists(path)) return null;
  const parsed = await Bun.file(path).json();
  return isToolchainManifest(parsed) ? parsed : null;
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
  makeDir(dirname(path), { recursive: true });

  const tmp = `${path}.tmp.${Bun.randomUUIDv7()}`;
  const payload = JSON.stringify(manifest, null, 2) + "\n";

  await Bun.write(tmp, payload);
  movePath(tmp, path);
}
