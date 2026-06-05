/**
 * src/lib/version.ts
 *
 * Canonical version module — single source of truth for all toolchain
 * version information. Derives toolchain version from package.json.
 */

import { join } from "path";
import { $ } from "bun";

/** Path to the desktop install manifest */
export const MANIFEST_PATH = join(Bun.env.HOME || "/tmp", ".kimi-code", "toolchain-manifest.json");

async function resolveVersion(): Promise<{ version: string; name: string }> {
  // Try repo package.json first (when running from the repo)
  const pkgPath = join(import.meta.dir, "..", "..", "package.json");
  try {
    const pkg = await Bun.file(pkgPath).json();
    return { version: pkg.version || "0.0.0", name: pkg.name || "kimi-toolchain" };
  } catch {
    // Fall back to manifest (when running from desktop install)
    try {
      const manifest = await Bun.file(MANIFEST_PATH).json();
      return { version: manifest.toolchainVersion || "0.0.0", name: "kimi-toolchain" };
    } catch {
      return { version: "0.0.0", name: "kimi-toolchain" };
    }
  }
}

const { version: TOOLCHAIN_VERSION, name: TOOLCHAIN_NAME } = await resolveVersion();

/** Toolchain version from package.json (e.g. "0.1.0") */
export { TOOLCHAIN_VERSION };

/** Toolchain package name */
export { TOOLCHAIN_NAME };

/** MCP bridge version — unified with toolchain version */
export const MCP_BRIDGE_VERSION = TOOLCHAIN_VERSION;

/** Get the installed desktop app version via `kimi --version` */
export async function getDesktopVersion(): Promise<string | null> {
  try {
    const result = await $`kimi --version`.quiet().nothrow();
    return result.stdout?.toString().trim() || null;
  } catch {
    return null;
  }
}

/** Get the current repo git HEAD short hash */
export async function getRepoHead(): Promise<string | null> {
  try {
    const result = await $`git rev-parse --short HEAD`.quiet().nothrow();
    return result.stdout?.toString().trim() || null;
  } catch {
    return null;
  }
}

/** Check if the repo has uncommitted changes */
export async function hasUncommittedChanges(): Promise<boolean> {
  try {
    const result = await $`git status --porcelain`.quiet().nothrow();
    return (result.stdout?.toString().trim().length ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Read the desktop install manifest if it exists */
export async function readManifest(): Promise<ToolchainManifest | null> {
  try {
    const text = await Bun.file(MANIFEST_PATH).text();
    return JSON.parse(text) as ToolchainManifest;
  } catch {
    return null;
  }
}

/** Desktop install manifest shape */
export interface ToolchainManifest {
  toolchainVersion: string;
  desktopVersion: string | null;
  gitHead: string | null;
  lastSyncedAt: string;
  files: string[];
}

/** Write the desktop install manifest */
export async function writeManifest(manifest: ToolchainManifest): Promise<void> {
  await Bun.write(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
}
