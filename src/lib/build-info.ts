/**
 * build-info.ts — Build metadata resolved at build time via Bun macros.
 *
 * All values in this module are resolved at BUNDLE TIME. The macro function
 * calls are replaced with static literals in the output. This means:
 *   - Zero runtime overhead (no spawnSync, no file reads in production)
 *   - Build metadata is "frozen" at build time
 *   - Smaller bundle size
 *
 * Usage:
 *   import { buildInfo } from "./build-info.ts";
 *   console.log(buildInfo.gitHash);  // "f52d9c0b" (static string in bundle)
 *
 * For the CLI (runtime, not bundled), use the macro functions directly:
 *   import { getGitHash } from "./build-info-macros.ts";
 *   const hash = getGitHash();  // runs at runtime
 */

import {
  getGitHash,
  getGitBranch,
  getBuildTime,
  getPackageVersion,
  getBunVersion,
  getPlatform,
} from "./build-info-macros.ts" with { type: "macro" };

// ── Build Metadata (all resolved at build time) ──────────────────────

export const buildInfo = {
  macroVersion: 1 as const,
  gitHash: getGitHash(),
  gitBranch: getGitBranch(),
  buildTime: getBuildTime(),
  version: getPackageVersion(),
  bunVersion: getBunVersion(),
  platform: getPlatform(),
} as const;

export type BuildInfo = typeof buildInfo;

// ── Formatted Strings ────────────────────────────────────────────────

/** One-line build summary: "v1.0.0 (f52d9c0b @ 2026-06-21T...)" */
export const buildSummary = `v${buildInfo.version} (${buildInfo.gitHash} @ ${buildInfo.buildTime})`;

/** Multi-line build banner for CLI output. */
export const buildBanner = `kimi-toolchain ${buildSummary}
  branch: ${buildInfo.gitBranch}
  bun:    ${buildInfo.bunVersion}
  platform: ${buildInfo.platform}`;
