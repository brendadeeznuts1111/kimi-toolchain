#!/usr/bin/env bun
/**
 * Enforce distinctive, grep-friendly test file and describe naming.
 *
 * Rules:
 * - test files use {stem}.{unit|integration|smoke|db|router}.test.ts
 *   (legacy: ecosystem-health.test.ts, workspace-health.test.ts)
 * - *.unit.test.ts stem maps to a source module (src/lib, src/lib/effect, src/bin, types)
 * - Top-level describe("…") uses kebab-case and starts with the file stem
 *   (grandfathered files listed in LEGACY_DESCRIBE_EXEMPT)
 */

import { basename, join } from "path";
import { pathExists, readTextAsync } from "../src/lib/bun-io.ts";
import { UNIT_TEST_FILES } from "../src/lib/test-gates.ts";

const REPO_ROOT = join(import.meta.dir, "..");

const LEGACY_PLAIN_TEST = new Set([
  "test/ecosystem-health.test.ts",
  "test/workspace-health.test.ts",
]);

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
  "taxonomy-coverage": "src/lib/taxonomy-coverage.ts",
};

/** When the top-level describe uses a shorter module alias than the file stem. */
const DESCRIBE_STEM_ALIAS: Record<string, string> = {
  "cloudflare-access-dashboard": "cloudflare-access",
  sync: "sync-hashes",
  "telemetry-schema": "telemetry",
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
]);

const FILENAME_PATTERN =
  /^test\/(?:effect\/|smoke\/)?[a-z0-9]+(?:-[a-z0-9]+)*\.(?:unit|integration|smoke|db|router)\.test\.ts$/;

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
  if (LEGACY_PLAIN_TEST.has(rel)) return null;
  const match = name.match(/^(.+)\.(unit|integration|smoke|db|router)\.test\.ts$/);
  return match?.[1] ?? null;
}

function firstTopLevelDescribe(text: string): string | null {
  const match = text.match(/describe\s*\(\s*["'`]([^"'`]+)["'`]/);
  return match?.[1] ?? null;
}

export async function lintTestNames(root: string = REPO_ROOT): Promise<string[]> {
  const violations: string[] = [];
  const glob = new Bun.Glob("test/**/*.test.ts");

  for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
    if (!LEGACY_PLAIN_TEST.has(rel) && !FILENAME_PATTERN.test(rel)) {
      violations.push(
        `${rel}: filename must match {stem}.{unit|integration|smoke|db|router}.test.ts`
      );
      continue;
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
    if (!describeLabel || LEGACY_DESCRIBE_EXEMPT.has(rel)) continue;

    const stemForDescribe = stem ?? basename(rel, ".test.ts");
    const allowedPrefixes = DESCRIBE_PREFIX_ALLOW[rel];
    if (allowedPrefixes?.some((entry) => describeLabel.startsWith(entry))) continue;

    const prefix = describeLabel.split(/\s/)[0]!;
    if (!KEBAB.test(prefix)) {
      violations.push(
        `${rel}: top-level describe "${describeLabel}" must use kebab-case (grep-friendly)`
      );
      continue;
    }

    const expectedStem = DESCRIBE_STEM_ALIAS[stemForDescribe] ?? stemForDescribe;
    if (prefix !== expectedStem && !describeLabel.startsWith(`${expectedStem} `)) {
      violations.push(
        `${rel}: top-level describe must start with file stem "${expectedStem}" (got "${prefix}")`
      );
    }
  }

  for (const rel of UNIT_TEST_FILES) {
    if (!pathExists(join(root, rel))) {
      violations.push(`test-gates: UNIT_TEST_FILES entry missing on disk: ${rel}`);
    }
  }

  return violations;
}

async function main(): Promise<void> {
  const violations = await lintTestNames();
  if (violations.length > 0) {
    console.error("✗ Test naming violations:\n");
    for (const line of violations) {
      console.error(`  ${line}`);
    }
    process.exit(1);
  }
  console.log("lint:test-names OK");
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("lint-test-names failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
