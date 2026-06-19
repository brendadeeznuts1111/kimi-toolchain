/**
 * toolchain-paths.ts — Universal binary resolver for toolchain + project bins.
 *
 * Supports two resolution modes:
 * 1. Global toolchain isolation (.kimi-code/bin vs system PATH) with shadow detection
 * 2. Local directory resolution using cwd (node_modules/.bin, project bins)
 *
 * Used by: kimi-bake doctor, dashboard /api/env, kimi-fix PATH validation
 */

import { homedir } from "os";
import { join } from "path";

export const USER_TOOLCHAIN_BIN = join(homedir(), ".kimi-code", "bin");
export const SYSTEM_PATH = process.env.PATH ?? "";

// ── Types ──────────────────────────────────────────────────────────

export interface BinResolution {
  name: string;
  toolchainPath: string | null;
  systemPath: string | null;
  resolved: string | null;
  shadowed: boolean;
  source: "toolchain" | "system" | "not-found";
}

export interface ToolchainHealth {
  ok: boolean;
  missing: string[];
  shadowed: BinResolution[];
  all: BinResolution[];
}

// ── Global toolchain resolution ────────────────────────────────────

/** Resolve a binary against both toolchain and system PATH. */
export function resolveBin(name: string): BinResolution {
  const toolchainPath = Bun.which(name, { PATH: USER_TOOLCHAIN_BIN });
  const systemPath = Bun.which(name, { PATH: SYSTEM_PATH });

  const shadowed = !!(toolchainPath && systemPath && toolchainPath !== systemPath);
  const resolved = toolchainPath ?? systemPath ?? null;
  const source = toolchainPath ? "toolchain" : systemPath ? "system" : "not-found";

  return { name, toolchainPath, systemPath, resolved, shadowed, source };
}

/** Resolve a binary strictly from the toolchain PATH. Throws if not found. */
export function requireToolchainBin(name: string): string {
  const path = Bun.which(name, { PATH: USER_TOOLCHAIN_BIN });
  if (!path) {
    const sysPath = Bun.which(name, { PATH: SYSTEM_PATH });
    throw new Error(
      `Toolchain binary not found: ${name}\n` +
        `Searched toolchain: ${USER_TOOLCHAIN_BIN}\n` +
        (sysPath ? `Found in system: ${sysPath}\n` : "") +
        `Install: kimi-toolchain install ${name}`
    );
  }
  return path;
}

/** Resolve multiple toolchain bins at once. */
export function resolveToolchainBins(names: string[]): BinResolution[] {
  return names.map(resolveBin);
}

/** Full toolchain health report: missing, shadowed, overall status. */
export function toolchainHealth(): ToolchainHealth {
  const required = ["kimi-fix", "kimi-new", "kimi-doctor", "kimi-heal"];
  const all = resolveToolchainBins(required);
  return {
    ok: all.every((b) => b.resolved !== null),
    missing: all.filter((b) => b.resolved === null).map((b) => b.name),
    shadowed: all.filter((b) => b.shadowed),
    all,
  };
}

// ── Directory-based resolution ─────────────────────────────────────

/**
 * Find a binary within a specific directory using cwd.
 * Falls back to system PATH if not found in the directory.
 */
export function resolveBinInDir(
  bin: string,
  dir: string,
  fallbackToPath = true
): string | null {
  const local = Bun.which(bin, { PATH: dir });
  if (local) return local;

  if (fallbackToPath) {
    return Bun.which(bin, { PATH: SYSTEM_PATH });
  }
  return null;
}

/**
 * Resolve a binary inside a project's node_modules/.bin.
 */
export function resolveProjectBin(
  bin: string,
  projectRoot: string,
  subdir = join("node_modules", ".bin")
): string | null {
  return resolveBinInDir(bin, join(projectRoot, subdir));
}
