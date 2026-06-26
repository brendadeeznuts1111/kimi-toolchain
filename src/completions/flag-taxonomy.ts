/**
 * Flag taxonomy for Bun CLI completion analysis.
 *
 * These categories classify flags by behavior. They are consumed by
 * src/completions/completion-matrix.ts and validated by
 * src/completions/taxonomy-validator.ts using Bun.Transpiler.
 */

export const FLAG_CATEGORIES = {
  fileIO: new Set([
    "outfile",
    "outdir",
    "outbase",
    "entry-naming",
    "chunk-naming",
    "asset-naming",
    "public-dir",
    "assets",
    "loader",
    "tsconfig-override",
    "cwd",
    "config",
    "env-file",
    "cafile",
    "cache-dir",
    "public",
    "routes",
    "app",
    "external",
    "packages",
    "target",
    "sourcemap",
    "minify",
    "splitting",
    "format",
  ]),
  pm: new Set([
    "frozen-lockfile",
    "production",
    "development",
    "dev",
    "no-save",
    "save",
    "global",
    "trust",
    "no-trust",
    "exact",
    "optional",
    "peer",
    "resolutions",
    "hoist",
    "no-hoist",
    "linker",
    "omit",
    "backend",
    "concurrent-scripts",
    "network-concurrency",
    "registry",
    "auth-type",
    "tag",
    "access",
    "dry-run",
    "no-cache",
    "prefer-offline",
    "no-verify",
    "ignore-scripts",
    "no-summary",
    "no-progress",
    "no-install",
    "save-text-lockfile",
    "lockfile-only",
    "minimum-release-age",
    "force",
    "only-missing",
    "yarn",
  ]),
  runtime: new Set([
    "watch",
    "hot",
    "preload",
    "import-meta-url",
    "smol",
    "no-deprecation",
    "throw-deprecation",
    "env-file",
    "cwd",
    "port",
    "hostname",
    "conditions",
    "main-fields",
    "extensions",
    "target",
    "format",
    "packages",
    "no-orphans",
    "no-clear-screen",
    "parallel",
    "sequential",
    "no-exit-on-error",
    "workspaces",
    "filter",
    "bun",
  ]),
  debug: new Set([
    "sourcemap",
    "inspect",
    "inspect-wait",
    "inspect-brk",
    "inspect-publish-port",
    "verbose",
    "silent",
    "quiet",
    "no-progress",
    "no-summary",
    "only-failures",
    "coverage",
    "coverage-reporter",
    "coverage-dir",
    "cpu-prof",
    "revision",
    "version",
  ]),
  network: new Set([
    "timeout",
    "prefer-offline",
    "no-cache",
    "registry",
    "cert",
    "ca",
    "cafile",
    "auth-type",
    "proxy",
    "network-concurrency",
    "no-verify",
    "tls-min-version",
    "tls-max-version",
    "no-deprecation",
  ]),
} as const;

export type FlagCategory = keyof typeof FLAG_CATEGORIES | "uncategorized";

/**
 * Validate the taxonomy for obvious structural issues:
 * - no empty category names
 * - no empty flag names
 * - no flag names containing whitespace
 * - no empty category sets
 */
export function findStructuralIssues(): {
  kind: string;
  category?: string;
  flag?: string;
}[] {
  const issues: { kind: string; category?: string; flag?: string }[] = [];
  for (const [category, flags] of Object.entries(FLAG_CATEGORIES)) {
    if (category.trim() === "") {
      issues.push({ kind: "empty-category-name" });
      continue;
    }
    if (flags.size === 0) {
      issues.push({ kind: "empty-category", category });
    }
    for (const flag of flags) {
      if (flag.trim() === "") {
        issues.push({ kind: "empty-flag-name", category });
      } else if (/\s/.test(flag)) {
        issues.push({ kind: "flag-contains-whitespace", category, flag });
      }
    }
  }
  return issues;
}
