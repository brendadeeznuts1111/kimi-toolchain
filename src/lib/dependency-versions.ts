/**
 * dependency-versions.ts — Latest dependency versions embedded at build time.
 *
 * Uses async fetch() macros to query the npm registry at BUILD TIME.
 * The bundled output contains only static version strings — no fetch
 * calls, no network requests at runtime.
 *
 * Usage:
 *   import { dependencyVersions } from "./dependency-versions.ts";
 *   console.log(dependencyVersions.effect); // "3.16.0" (static in bundle)
 */

import { getLatestVersion } from "./npm-registry-macros.ts" with { type: "macro" };

// ── Embedded Version Strings (resolved at build time) ────────────────

export const dependencyVersions = {
  effect: getLatestVersion("effect"),
  bun: getLatestVersion("bun"),
  typescript: getLatestVersion("typescript"),
  "js-yaml": getLatestVersion("js-yaml"),
} as const;

export type DependencyVersions = typeof dependencyVersions;

// ── Formatted Output ─────────────────────────────────────────────────

/** One-line summary of all dependency versions. */
export const versionSummary = Object.entries(dependencyVersions)
  .map(([name, version]) => `${name}@${version}`)
  .join(", ");

/** Multi-line list for CLI display. */
export const versionList = Object.entries(dependencyVersions)
  .map(([name, version]) => `  ${name}: ${version}`)
  .join("\n");
