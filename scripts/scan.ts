#!/usr/bin/env bun
/**
 * Bun upgrade advisor — scans a project for gaps vs the toolchain's
 * canonical patterns and suggests concrete fixes.
 *
 * Usage:
 *   bun run scripts/scan.ts [path]            # scan project at path (default: .)
 *   bun run scripts/scan.ts --json            # structured output
 *   bun run scripts/scan.ts --fix             # apply fix suggestions (dry-run only)
 *
 * Detection targets (from template-matrix.md + package.json scripts):
 *   - test:parallel  (Bun >=1.3.13, all CPUs, --isolate per file)
 *   - test:shard     (CI matrix splitting)
 *   - test:fast      (unit gate)
 *   - check:fast     (format + lint + typecheck + test)
 *   - bunfig.toml    (install policy: linker, frozenLockfile, globalStore)
 *   - trustedDependencies (supply-chain trust list)
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────

interface ScanFinding {
  id: string;
  severity: "info" | "warn" | "error";
  category: "scripts" | "config" | "security" | "ci";
  title: string;
  detail: string;
  suggestedCommand: string;
  autoFixable: boolean;
}

interface ScanReport {
  schemaVersion: 1;
  tool: "bun-upgrade-advisor";
  project: string;
  timestamp: string;
  summary: {
    total: number;
    errors: number;
    warnings: number;
    infos: number;
  };
  findings: ScanFinding[];
}

// ── Canonical patterns (from template-matrix.md) ──────────────────────

const CANONICAL_SCRIPTS: Record<string, { command: string; category: string }> = {
  "test:parallel": {
    command: "bun run scripts/run-tests.ts --parallel",
    category: "ci",
  },
  "test:parallel:4": {
    command: "bun run scripts/run-tests.ts --parallel=4",
    category: "ci",
  },
  "test:shard": {
    command: "bun run scripts/run-tests.ts --shard",
    category: "ci",
  },
  "test:fast": {
    command: "bun run scripts/run-tests.ts --fast",
    category: "scripts",
  },
  "test:coverage:ci": {
    command: "bun run scripts/run-tests.ts --ci --coverage",
    category: "ci",
  },
  "check:fast": {
    command: "bun run scripts/check.ts --fast",
    category: "scripts",
  },
  check: {
    command: "bun run scripts/check.ts",
    category: "scripts",
  },
  typecheck: {
    command: "tsc --noEmit",
    category: "scripts",
  },
  format: {
    command: "oxfmt --write .",
    category: "scripts",
  },
  "format:check": {
    command: "oxfmt --check -c .oxfmtrc.json .",
    category: "scripts",
  },
  lint: {
    command: "oxlint src test scripts && bun run scripts/lint-banned-terms.ts",
    category: "scripts",
  },
};

const INSTALL_POLICY_CHECKS: Array<{
  key: string;
  expected: string;
  message: string;
}> = [
  {
    key: "linker",
    expected: "isolated",
    message: "Use isolated linker (prevents phantom dependencies)",
  },
  {
    key: "frozenLockfile",
    expected: "true",
    message: "Lock lockfile — use bun add/update, not bun install",
  },
  {
    key: "globalStore",
    expected: "true",
    message: "Enable global virtual store (~7x faster warm installs on macOS)",
  },
  {
    key: "minimumReleaseAge",
    expected: "259200",
    message: "3-day minimum release age (supply-chain cooling off)",
  },
];

// ── Scanner ────────────────────────────────────────────────────────────

function scanScripts(pkgScripts: Record<string, string>): ScanFinding[] {
  const findings: ScanFinding[] = [];

  for (const [name, canonical] of Object.entries(CANONICAL_SCRIPTS)) {
    if (!pkgScripts[name]) {
      findings.push({
        id: `missing-script-${name}`,
        severity: name.startsWith("test:parallel") || name === "test:shard" ? "info" : "warn",
        category: canonical.category as ScanFinding["category"],
        title: `Missing script: ${name}`,
        detail: `Add "${canonical.command}" to package.json scripts for ${canonical.category} coverage.`,
        suggestedCommand: `bun pkg set scripts.${name}="${canonical.command}"`,
        autoFixable: true,
      });
      continue;
    }

    // Check if the existing script uses the toolchain runner (not raw bun test)
    const current = pkgScripts[name];
    if (name.startsWith("test:") && !current.includes("scripts/run-tests.ts")) {
      findings.push({
        id: `nonstandard-test-${name}`,
        severity: "warn",
        category: "scripts",
        title: `Non-standard test runner: ${name}`,
        detail: `Script "${name}" uses "${current}" instead of the toolchain's "scripts/run-tests.ts". The toolchain runner adds --isolate, --bail, retry, and coverage bunfig handling.`,
        suggestedCommand: `bun pkg set scripts.${name}="${canonical.command}"`,
        autoFixable: true,
      });
    }
  }

  return findings;
}

function scanBunfig(projectDir: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const bunfigPath = join(projectDir, "bunfig.toml");

  if (!existsSync(bunfigPath)) {
    findings.push({
      id: "missing-bunfig",
      severity: "error",
      category: "config",
      title: "Missing bunfig.toml",
      detail: "No bunfig.toml found. Run 'kimi-fix .' to generate a hardened install policy.",
      suggestedCommand: "kimi-fix .",
      autoFixable: true,
    });
    return findings;
  }

  try {
    const content = readFileSync(bunfigPath, "utf-8");

    for (const check of INSTALL_POLICY_CHECKS) {
      // Simple regex check — handles both quoted and unquoted TOML values
      const pattern = new RegExp(`${check.key}\\s*=\\s*"?${escapeRegex(check.expected)}"?`, "i");
      if (!pattern.test(content)) {
        const current = content.match(new RegExp(`${check.key}\\s*=\\s*"?([^"\\n]+)"?`));
        findings.push({
          id: `bunfig-${check.key}`,
          severity: check.key === "globalStore" ? "info" : "warn",
          category: "config",
          title: `bunfig.toml: ${check.key} should be ${check.expected}`,
          detail: `${check.message}. Current: ${current?.[1]?.trim() ?? "unset"}.`,
          suggestedCommand: `Set ${check.key} = ${check.expected} in [install] section of bunfig.toml`,
          autoFixable: false,
        });
      }
    }
  } catch {
    findings.push({
      id: "bunfig-parse-error",
      severity: "error",
      category: "config",
      title: "Cannot parse bunfig.toml",
      detail: "bunfig.toml exists but could not be read. Check permissions and TOML syntax.",
      suggestedCommand: "bun run format",
      autoFixable: false,
    });
  }

  return findings;
}

function scanTrustedDeps(projectDir: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const pkgPath = join(projectDir, "package.json");

  if (!existsSync(pkgPath)) return findings;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (!Array.isArray(pkg.trustedDependencies)) {
      findings.push({
        id: "missing-trusted-deps",
        severity: "warn",
        category: "security",
        title: "Missing trustedDependencies in package.json",
        detail:
          "No trustedDependencies array found. Run 'kimi-guardian check' to scan for packages with lifecycle scripts that need trust.",
        suggestedCommand: "kimi-guardian check",
        autoFixable: true,
      });
    }
  } catch {
    // Can't parse package.json — skip
  }

  return findings;
}

function scanProject(projectDir: string): ScanReport {
  const pkgPath = join(projectDir, "package.json");
  const projectName = basename(resolve(projectDir));
  const findings: ScanFinding[] = [];

  let pkgScripts: Record<string, string> = {};
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      pkgScripts = pkg.scripts ?? {};
    } catch {
      findings.push({
        id: "pkg-parse-error",
        severity: "error",
        category: "scripts",
        title: "Cannot parse package.json",
        detail: "package.json exists but is not valid JSON.",
        suggestedCommand: "bun run format",
        autoFixable: false,
      });
    }
  }

  findings.push(...scanScripts(pkgScripts));
  findings.push(...scanBunfig(projectDir));
  findings.push(...scanTrustedDeps(projectDir));

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warn").length;
  const infos = findings.filter((f) => f.severity === "info").length;

  return {
    schemaVersion: 1,
    tool: "bun-upgrade-advisor",
    project: projectName,
    timestamp: new Date().toISOString(),
    summary: {
      total: findings.length,
      errors,
      warnings,
      infos,
    },
    findings,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatReport(report: ScanReport): string {
  const lines: string[] = [];
  lines.push(`\n── Bun Upgrade Advisor ── ${report.project} ──`);
  lines.push(
    `   ${report.summary.errors} errors · ${report.summary.warnings} warnings · ${report.summary.infos} info`
  );

  if (report.findings.length === 0) {
    lines.push("   ✓ Project matches toolchain patterns");
    return lines.join("\n");
  }

  const byCategory: Record<string, ScanFinding[]> = {};
  for (const f of report.findings) {
    (byCategory[f.category] ??= []).push(f);
  }

  for (const [category, items] of Object.entries(byCategory)) {
    lines.push(`\n  [${category}]`);
    for (const item of items) {
      const icon = item.severity === "error" ? "✗" : item.severity === "warn" ? "⚠" : "ℹ";
      lines.push(`    ${icon} ${item.title}`);
      lines.push(`      ${item.detail}`);
      lines.push(`      → ${item.suggestedCommand}`);
    }
  }

  lines.push(`\n  Fix: review suggestions above, then run 'kimi-fix .' for auto-repair`);
  return lines.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const fixMode = args.includes("--fix");
  const positional = args.filter((a) => !a.startsWith("--"));
  const projectDir = resolve(positional[0] ?? ".");

  if (!existsSync(projectDir)) {
    console.error(`Project directory not found: ${projectDir}`);
    process.exit(1);
  }

  const report = scanProject(projectDir);

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }

  if (fixMode) {
    console.log("\n  [fix] Dry-run mode — auto-fix not yet implemented.");
    console.log("  Run 'kimi-fix .' for comprehensive scaffold repair.");
  }

  process.exit(report.summary.errors > 0 ? 1 : 0);
}
