#!/usr/bin/env bun
/**
 * Enforce test file naming, describe conventions, and Bun-native test practices.
 *
 * Naming rules:
 * - test files use {stem}.{unit|integration|smoke|db|router}.test.ts

 * - *.unit.test.ts stem maps to a source module (src/lib, src/lib/effect, src/bin, types)
 * - Top-level describe("…") uses kebab-case and starts with the file stem
 *   (grandfathered files listed in LEGACY_DESCRIBE_EXEMPT)
 *
 * Convention rules (exempt test/helpers.ts):
 * - No node:fs / fs sync imports
 * - No process.env — use Bun.env or withEnv()
 * - No console.log = / console.error = — use captureConsole helpers
 * - No duplicate REPO_ROOT — import from test/helpers.ts
 * - No mkdtempSync / readFileSync / writeFileSync
 */

import { parseArgs } from "util";
import { basename, join } from "path";
import { pathExists, readTextAsync } from "../src/lib/bun-io.ts";
import { UNIT_TEST_FILES } from "../src/lib/test-gates.ts";

const REPO_ROOT = join(import.meta.dir, "..");

/** Unit test stems that intentionally target a non-default source path. */
const UNIT_STEM_SOURCE: Record<string, string> = {
  lib: "src/lib/utils.ts",
  "build-constants": "types/build-constants.d.ts",
  "path-alignment": "src/lib/workspace-health.ts",
  "workspace-known-blockers": "src/lib/workspace-known-blockers.ts",
  sync: "src/lib/sync-hashes.ts",
  "sync-drift": "src/lib/sync-hashes.ts",
  "telemetry-schema": "src/lib/error-taxonomy.ts",
  "unified-shell-bridge": "src/bin/unified-shell-bridge.ts",
  "kimi-githooks": "src/bin/kimi-githooks.ts",
  "kimi-governance": "src/bin/kimi-governance.ts",
  "identity-matrix": "src/lib/identity-matrix.ts",
  "kimi-identity": "src/bin/kimi-identity.ts",
  "kimi-docs-aligned": "src/lib/kimi-docs-aligned.ts",
  "cloudflare-access-dashboard": "src/lib/cloudflare-access.ts",
  "scaffold-agents": "src/lib/scaffold-agents.ts",
  "lint-test-names": "scripts/lint-test-names.ts",
  "constants-registry": "src/lib/constants-registry.ts",
  "optimizer-doctor": "src/lib/constant-optimizer.ts",
  "decision-list-diff": "src/lib/decision-ledger.ts",
  "audit-effects": "src/bin/kimi-heal.ts",
  "html-reporter": "src/harness/html-reporter.ts",
  "guardian-verify": "src/guardian/verify.ts",
  "taxonomy-coverage": "src/lib/taxonomy-coverage.ts",
  "herdr-socket-saturation": "src/lib/herdr-socket-client.ts",
  "herdr-socket-saturation-subscribe": "src/lib/herdr-socket-client.ts",
  "canvas-metadata-integrity": "src/lib/canvas-metadata-integrity.gate.ts",
  "perf-gate": "src/guardian/perf-gate.ts",
  "tls-compliance": "src/guardian/tls-compliance.ts",
  "artifact-store": "src/lib/artifact-store.ts",
  "bunfig-policy-gate": "src/gates/bunfig-policy.ts",
  "gate-registry": "src/gates/registry.ts",
  "doctor-gates-runner": "src/gates/runner.ts",
  "kimi-doctor-gate": "src/bin/kimi-doctor.ts",
  "gates-trading": "src/gates/trading-metrics.ts",
  "dashboard-audit-store": "src/lib/dashboard-audit-store.ts",
  "herdr-dashboard-data": "src/lib/herdr-dashboard-data.ts",
  "herdr-dashboard-bridge": "src/lib/herdr-dashboard-bridge.ts",
  "scaffold-trading": "src/lib/scaffold-modules.ts",
  "introspection-docs": "src/lib/scaffold-agents.ts",
  "examples-dashboard-routes": "examples/dashboard/src/index.ts",
  "examples-dashboard-artifacts": "examples/dashboard/src/handlers/artifacts.ts",
  "examples-dashboard-canvas-filter": "examples/dashboard/src/handlers/canvas-cards.ts",
  "ci-pipeline": "src/lib/effect/ci-pipeline.ts",
  "ci-impact": "src/lib/ci-impact.ts",
  "agent-context-quality": "src/lib/agent-context-quality.ts",
  "kimi-dashboard-daemon": "src/bin/kimi-dashboard.ts",
  "kimi-dashboard-mcp": "src/bin/kimi-dashboard-mcp.ts",
  "email-i18n-gate": "src/gates/email-i18n.ts",
  "url-i18n-gate": "src/gates/url-i18n.ts",
};

/** When the top-level describe uses a shorter module alias than the file stem. */
const DESCRIBE_STEM_ALIAS: Record<string, string> = {
  "cloudflare-access-dashboard": "cloudflare-access",
  sync: "sync-hashes",
  "telemetry-schema": "telemetry",
  "introspection-docs": "introspection",
  "trace-ledger": "trace",
  "agent-context-quality": "agent",
  "error-clustering": "error-embedding",
  "kimi-dashboard-daemon": "kimi-dashboard",
  "email-i18n-gate": "email-i18n",
  "url-i18n-gate": "url-i18n",
  "ci-impact": "ci",
  "githook-templates": "githook",
  "kimi-introspection-services": "kimi",
};

/** Allowed top-level describe prefixes for aggregate test files. */
const DESCRIBE_PREFIX_ALLOW: Record<string, string[]> = {
  "test/lib.unit.test.ts": ["lib/"],
};

/** Files allowed to keep legacy camelCase top-level describe until migrated. */
const LEGACY_DESCRIBE_EXEMPT = new Set([
  "test/build-constants.unit.test.ts",
  "test/build-constants-registry.unit.test.ts",
  "test/scaffold-agents.unit.test.ts",
  "test/tuning-set-version.unit.test.ts",
  "test/governance-check.unit.test.ts",
  "test/constants-heal.unit.test.ts",
  "test/conventional-commits.unit.test.ts",
  "test/changelog.unit.test.ts",
  "test/cloudflare-access.unit.test.ts",
  "test/decision-ledger.unit.test.ts",
  "test/decision-scoring.integration.test.ts",
  "test/kimi-fix.integration.test.ts",
  "test/cleanup-legacy.integration.test.ts",
  "test/ci-pipeline.unit.test.ts",
  "test/error-clustering.integration.test.ts",
]);

const FILENAME_PATTERN =
  /^test\/(?:effect\/|smoke\/|guardian\/)?[a-z0-9]+(?:-[a-z0-9]+)*\.(?:unit|integration|smoke|db|router)\.test\.ts$/;

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function resolveUnitSource(root: string, rel: string, stem: string): string {
  if (UNIT_STEM_SOURCE[stem]) return UNIT_STEM_SOURCE[stem];
  const candidates = rel.startsWith("test/effect/")
    ? [`src/lib/effect/${stem}.ts`, `src/lib/${stem}.ts`]
    : [`src/lib/${stem}.ts`];
  for (const candidate of candidates) {
    if (pathExists(join(root, candidate))) return candidate;
  }
  return candidates[candidates.length - 1]!;
}

function parseStem(rel: string): string | null {
  const name = basename(rel);
  const match = name.match(/^(.+)\.(unit|integration|smoke|db|router)\.test\.ts$/);
  return match?.[1] ?? null;
}

function firstTopLevelDescribe(text: string): string | null {
  const match = text.match(/describe\s*\(\s*["'`]([^"'`]+)["'`]/);
  return match?.[1] ?? null;
}

// ── Convention rules (ex-lint-test-conventions.ts) ───────────────────

const HELPERS = "test/helpers.ts";

interface ConventionViolation {
  file: string;
  line: number;
  ruleId: string;
  message: string;
  snippet: string;
}

const CONVENTION_RULES: Array<{
  id: string;
  pattern: RegExp;
  message: string;
  exempt?: RegExp;
}> = [
  {
    id: "node-fs-import",
    pattern: /from\s+["'](?:node:)?fs["']/,
    message: "Use Bun.file / bun-io.ts or test/helpers.ts instead of fs imports",
  },
  {
    id: "process-env",
    pattern: /\bprocess\.env\b/,
    message: "Use Bun.env or withEnv() from test/helpers.ts",
  },
  {
    id: "console-assign",
    pattern: /\bconsole\.(log|error|warn)\s*=/,
    message: "Use captureConsole / captureConsoleError / captureStdout from test/helpers.ts",
    exempt: /test\/helpers\.ts$/,
  },
  {
    id: "sync-fs-api",
    pattern: /\b(readFileSync|writeFileSync|mkdirSync|rmSync|mkdtempSync|existsSync)\s*\(/,
    message: "Use bun-io.ts helpers or test/helpers.ts",
  },
  {
    id: "spawn-rm-rf",
    pattern: /Bun\.spawnSync\(\s*\[\s*["']rm["']\s*,\s*["']-rf["']/,
    message: "Use cleanupPath() from test/helpers.ts",
  },
  {
    id: "local-repo-root",
    pattern: /const\s+REPO_ROOT\s*=\s*join\s*\(\s*import\.meta\.dir/,
    message: "Import { REPO_ROOT } from test/helpers.ts (or relative ./helpers.ts)",
    exempt: /test\/helpers\.ts$/,
  },
];

function stripStringLiterals(line: string): string {
  return line
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

function scanConventions(rel: string, text: string): ConventionViolation[] {
  if (rel === HELPERS) return [];
  const lines = text.split("\n");
  const violations: ConventionViolation[] = [];
  for (const rule of CONVENTION_RULES) {
    if (rule.exempt?.test(rel)) continue;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i] ?? "";
      if (raw.trimStart().startsWith("//")) continue;
      const line = stripStringLiterals(raw);
      if (!rule.pattern.test(line)) continue;
      violations.push({
        file: rel,
        line: i + 1,
        ruleId: rule.id,
        message: rule.message,
        snippet: raw.trim().slice(0, 120),
      });
    }
  }
  return violations;
}

export async function lintTestConventions(
  root: string = REPO_ROOT,
  onlyFiles?: string[]
): Promise<string[]> {
  const violations: string[] = [];
  if (onlyFiles !== undefined) {
    for (const rel of onlyFiles) {
      if (!rel.startsWith("test/") || !rel.endsWith(".ts")) continue;
      if (rel === HELPERS) continue;
      let text: string;
      try {
        text = await readTextAsync(join(root, rel));
      } catch {
        continue;
      }
      for (const v of scanConventions(rel, text)) {
        violations.push(`${v.file}:${v.line} [${v.ruleId}] ${v.message}\n    ${v.snippet}`);
      }
    }
    return violations;
  }
  const convGlob = new Bun.Glob("test/**/*.ts");
  for await (const rel of convGlob.scan({ cwd: root, onlyFiles: true })) {
    const text = await readTextAsync(join(root, rel));
    for (const v of scanConventions(rel, text)) {
      violations.push(`${v.file}:${v.line} [${v.ruleId}] ${v.message}\n    ${v.snippet}`);
    }
  }
  return violations;
}

// ── Test naming rules ────────────────────────────────────────────────

export async function lintTestNames(
  root: string = REPO_ROOT,
  onlyFiles?: string[]
): Promise<string[]> {
  const violations: string[] = [];
  const glob = new Bun.Glob("test/**/*.test.ts");

  const scanRel = async (rel: string): Promise<void> => {
    if (!FILENAME_PATTERN.test(rel)) {
      violations.push(
        `${rel}: filename must match {stem}.{unit|integration|smoke|db|router}.test.ts`
      );
      return;
    }

    const stem = parseStem(rel);
    if (stem && rel.endsWith(".unit.test.ts")) {
      const source = resolveUnitSource(root, rel, stem);
      if (!pathExists(join(root, source))) {
        violations.push(`${rel}: unit stem "${stem}" has no source at ${source}`);
      }
    }

    const text = await readTextAsync(join(root, rel));
    const describeLabel = firstTopLevelDescribe(text);
    if (!describeLabel || LEGACY_DESCRIBE_EXEMPT.has(rel)) return;

    const stemForDescribe = stem ?? basename(rel, ".test.ts");
    const allowedPrefixes = DESCRIBE_PREFIX_ALLOW[rel];
    if (allowedPrefixes?.some((entry) => describeLabel.startsWith(entry))) return;

    const prefix = describeLabel.split(/\s/)[0]!;
    if (!KEBAB.test(prefix)) {
      violations.push(
        `${rel}: top-level describe "${describeLabel}" must use kebab-case (grep-friendly)`
      );
      return;
    }

    const expectedStem = DESCRIBE_STEM_ALIAS[stemForDescribe] ?? stemForDescribe;
    if (prefix !== expectedStem && !describeLabel.startsWith(`${expectedStem} `)) {
      violations.push(
        `${rel}: top-level describe must start with file stem "${expectedStem}" (got "${prefix}")`
      );
    }
  };

  if (onlyFiles !== undefined) {
    for (const rel of onlyFiles) {
      if (!rel.startsWith("test/") || !rel.endsWith(".test.ts")) continue;
      await scanRel(rel);
    }
  } else {
    for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
      await scanRel(rel);
    }

    for (const rel of UNIT_TEST_FILES) {
      if (!pathExists(join(root, rel))) {
        violations.push(`test-gates: UNIT_TEST_FILES entry missing on disk: ${rel}`);
      }
    }
  }

  return violations;
}

function normalizeTargetDir(dir: string): string {
  return dir.replace(/\/+$/, "") || ".";
}

/** Collect test/*.ts paths under an optional subdirectory (e.g. test/effect/). */
export function collectLintTargetFiles(targetDir?: string): {
  targetDir: string | null;
  conventionFiles: string[];
  nameFiles: string[];
} {
  if (targetDir === undefined) {
    return { targetDir: null, conventionFiles: [], nameFiles: [] };
  }

  const norm = normalizeTargetDir(targetDir);
  const conventionFiles = [
    ...new Bun.Glob(`${norm}/**/*.ts`).scanSync({ cwd: REPO_ROOT, onlyFiles: true }),
  ];
  const nameFiles = conventionFiles.filter((rel) => rel.endsWith(".test.ts"));
  return { targetDir: norm, conventionFiles, nameFiles };
}

export function parseLintTestNamesCli(argv: string[]): {
  json: boolean;
  targetDir?: string;
} {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      json: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: true,
  });

  return {
    json: values.json ?? false,
    targetDir: positionals[0],
  };
}

async function main(): Promise<void> {
  const { json, targetDir } = parseLintTestNamesCli(Bun.argv.slice(2));
  const scoped = collectLintTargetFiles(targetDir);
  const onlyConvention = scoped.targetDir !== null ? scoped.conventionFiles : undefined;
  const onlyNames = scoped.targetDir !== null ? scoped.nameFiles : undefined;

  const [nameViolations, conventionViolations] = await Promise.all([
    lintTestNames(REPO_ROOT, onlyNames),
    lintTestConventions(REPO_ROOT, onlyConvention),
  ]);

  const ok = nameViolations.length === 0 && conventionViolations.length === 0;

  if (json) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          tool: "lint-test-names",
          ok,
          targetDir: scoped.targetDir,
          filesScanned: scoped.targetDir !== null ? scoped.conventionFiles.length : null,
          naming: { ok: nameViolations.length === 0, violations: nameViolations },
          conventions: { ok: conventionViolations.length === 0, violations: conventionViolations },
        },
        null,
        2
      )
    );
    process.exit(ok ? 0 : 1);
    return;
  }

  let exit = 0;

  if (scoped.targetDir !== null) {
    console.log(`lint scope: ${scoped.targetDir}/ (${scoped.conventionFiles.length} file(s))`);
  }

  if (nameViolations.length > 0) {
    console.error("✗ Test naming violations:\n");
    for (const line of nameViolations) console.error(`  ${line}`);
    exit = 1;
  } else {
    console.log("lint:test-names OK");
  }

  if (conventionViolations.length > 0) {
    console.error(`\ntest conventions: ${conventionViolations.length} violation(s)\n`);
    for (const line of conventionViolations) console.error(`  ${line}`);
    exit = 1;
  } else {
    console.log("test conventions: ok");
  }

  process.exit(exit);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("lint-test-names failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
