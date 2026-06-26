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
    "patches-dir",
    "public-path",
    "root",
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
    "latest",
    "otp",
    "os",
    "package",
    "tolerate-republish",
    "commit",
    "yes",
    "install",
    "i",
    "audit-level",
    "cpu",
    "analyze",
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
    "interactive",
    "shell",
    "unhandled-rejections",
    "zero-fill-buffers",
    "no-env-file",
    "eval",
    "experimental-http2-fetch",
    "experimental-http3-fetch",
    "experimental-stream-iter",
    "fetch-preconnect",
    "redis-preconnect",
    "sql-preconnect",
    "server-components",
    "cron-period",
    "cron-title",
    "feature",
    "recursive",
    "if-present",
    "prefer-latest",
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
    "help",
    "console-depth",
    "debug-no-minify",
    "debug-dump-server-files",
    "elide-lines",
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
    "max-http-header-size",
    "dns-result-order",
    "user-agent",
    "use-bundled-ca",
    "use-openssl-ca",
    "use-system-ca",
  ]),
  compile: new Set([
    "compile",
    "compile-autoload-bunfig",
    "compile-autoload-dotenv",
    "compile-autoload-package-json",
    "compile-autoload-tsconfig",
    "compile-exec-argv",
    "compile-executable-path",
    "no-compile-autoload-bunfig",
    "no-compile-autoload-dotenv",
    "no-compile-autoload-package-json",
    "no-compile-autoload-tsconfig",
    "bytecode",
    "no-bundle",
    "minify-identifiers",
    "minify-syntax",
    "minify-whitespace",
    "drop",
    "keep-names",
    "banner",
    "footer",
    "define",
    "metafile",
    "metafile-md",
    "emit-dce-annotations",
    "ignore-dce-annotations",
    "allow-unresolved",
    "reject-unresolved",
    "no-addons",
    "no-macros",
    "minimal",
    "css-chunking",
    "gzip-level",
    "env",
    "production",
  ]),
  test: new Set([
    "bail",
    "test-name-pattern",
    "test-worker",
    "pass-with-no-tests",
    "rerun-each",
    "randomize",
    "seed",
    "shard",
    "todo",
    "only",
    "retry",
    "update-snapshots",
    "dots",
    "title",
    "ignore",
    "path-ignore-patterns",
    "reporter",
    "reporter-outfile",
    "isolate",
    "concurrent",
    "max-concurrency",
    "parallel-delay",
    "changed",
  ]),
  jsx: new Set([
    "jsx-factory",
    "jsx-fragment",
    "jsx-import-source",
    "jsx-runtime",
    "jsx-side-effects",
    "react",
    "react-compiler",
    "react-fast-refresh",
  ]),
  profiling: new Set([
    "cpu-prof",
    "cpu-prof-dir",
    "cpu-prof-interval",
    "cpu-prof-md",
    "cpu-prof-name",
    "heap-prof",
    "heap-prof-dir",
    "heap-prof-md",
    "heap-prof-name",
    "expose-gc",
  ]),
  windows: new Set([
    "windows-copyright",
    "windows-description",
    "windows-hide-console",
    "windows-icon",
    "windows-publisher",
    "windows-title",
    "windows-version",
  ]),
  resolution: new Set([
    "extension-order",
    "preserve-symlinks",
    "preserve-symlinks-main",
    "import",
    "require",
  ]),
  output: new Set([
    "json",
    "print",
  ]),
} as const;

export type FlagCategory = keyof typeof FLAG_CATEGORIES | "uncategorized";

/**
 * Command-specific taxonomy overrides.
 *
 * The same flag name can mean different things depending on the command.
 * This map resolves ambiguous flags to command-local categories.
 * Flags not listed here fall back to their global categories.
 */
export const COMMAND_SPECIFIC_OVERRIDES: Record<string, Record<string, FlagCategory[]>> = {
  build: {
    production: ["compile"],
    env: ["compile"],
    format: ["compile"],
    target: ["compile"],
    packages: ["compile"],
    sourcemap: ["compile"],
    conditions: ["compile"],
    "main-fields": ["compile"],
  },
  install: {
    analyze: ["pm"],
    production: ["pm"],
  },
  add: {
    analyze: ["pm"],
    production: ["pm"],
  },
  remove: {
    production: ["pm"],
  },
  update: {
    production: ["pm"],
  },
  outdated: {
    production: ["pm"],
  },
  link: {
    production: ["pm"],
  },
  unlink: {
    production: ["pm"],
  },
  publish: {
    production: ["pm"],
  },
  patch: {
    production: ["pm"],
  },
  info: {
    production: ["pm"],
  },
  test: {
    changed: ["test"],
    concurrent: ["test"],
    "max-concurrency": ["test"],
    isolate: ["test"],
    "parallel-delay": ["test"],
  },
};

function globalCategories(flag: string): FlagCategory[] {
  const categories: FlagCategory[] = [];
  for (const [cat, flags] of Object.entries(FLAG_CATEGORIES)) {
    if (flags.has(flag)) categories.push(cat as FlagCategory);
  }
  return categories.length ? categories : ["uncategorized"];
}

/**
 * Return the global (name-based) categories for a flag.
 */
export function classifyFlag(flag: string): FlagCategory[] {
  return globalCategories(flag);
}

/**
 * Return the command-local categories for a flag.
 * Falls back to global categories when no override exists.
 */
export function classifyFlagForCommand(flag: string, command: string): FlagCategory[] {
  const override = COMMAND_SPECIFIC_OVERRIDES[command]?.[flag];
  return override ? override : globalCategories(flag);
}

/**
 * Validate the taxonomy for obvious structural issues:
 * - no empty category names
 * - no empty flag names
 * - no flag names containing whitespace
 * - no empty category sets
 * - command overrides reference only known categories
 * - command overrides do not introduce uncategorized flags
 */
const KNOWN_CATEGORIES = new Set([...Object.keys(FLAG_CATEGORIES), "uncategorized"]);

export function findStructuralIssues(): {
  kind: string;
  category?: string;
  flag?: string;
  command?: string;
}[] {
  const issues: { kind: string; category?: string; flag?: string; command?: string }[] = [];
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
  for (const [command, overrides] of Object.entries(COMMAND_SPECIFIC_OVERRIDES)) {
    for (const [flag, categories] of Object.entries(overrides)) {
      if (categories.length === 0) {
        issues.push({ kind: "empty-command-override", command, flag });
      }
      for (const cat of categories) {
        if (!KNOWN_CATEGORIES.has(cat)) {
          issues.push({ kind: "unknown-command-override-category", command, flag, category: cat });
        }
        if (cat === "uncategorized") {
          issues.push({ kind: "command-override-uncategorized", command, flag });
        }
      }
    }
  }
  return issues;
}
