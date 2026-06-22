/**
 * Feature flags registry lint — constants ↔ docs parity + env usage coverage.
 */

import { join } from "path";
import { pathExists, readText } from "./bun-io.ts";
import {
  BUNDLE_FEATURE_KEYS,
  ENV_ESCAPE_FLAG_KEYS,
  ENV_OPT_IN_FLAG_KEYS,
  FEATURE_FLAG_DEFINITIONS,
  FEATURE_FLAG_REGISTRY_DOC,
  type FeatureFlagId,
} from "./feature-flags-constants.ts";

export interface FeatureFlagLintIssue {
  severity: "error" | "warn";
  message: string;
}

const REGISTRY_ID_RE = /^\|\s*`([a-z][a-z0-9-]*)`\s*\|/;

function parseRegistryIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  for (const line of markdown.split("\n")) {
    const match = line.match(REGISTRY_ID_RE);
    if (match) ids.add(match[1]!);
  }
  return ids;
}

async function scanEnvFlagLiterals(repoRoot: string): Promise<Set<string>> {
  const found = new Set<string>();
  const glob = new Bun.Glob("**/*.{ts,tsx,js,md}");
  const roots = ["src", "scripts", "test", "examples", "skills"];

  for (const root of roots) {
    const base = join(repoRoot, root);
    if (!pathExists(base)) continue;
    for await (const rel of glob.scan({ cwd: base, onlyFiles: true })) {
      const text = readText(join(base, rel));
      for (const match of text.matchAll(/\b(KIMI_SKIP_[A-Z0-9_]+|KIMI_PERF_INSTALL)\b/g)) {
        found.add(match[1]!);
      }
    }
  }
  return found;
}

export async function lintFeatureFlagsRegistry(repoRoot: string): Promise<FeatureFlagLintIssue[]> {
  const issues: FeatureFlagLintIssue[] = [];
  const registryPath = join(repoRoot, FEATURE_FLAG_REGISTRY_DOC);

  if (!pathExists(registryPath)) {
    issues.push({
      severity: "error",
      message: `missing registry doc: ${FEATURE_FLAG_REGISTRY_DOC}`,
    });
    return issues;
  }

  const registryIds = parseRegistryIds(readText(registryPath));
  const constantIds = new Set<FeatureFlagId>(
    FEATURE_FLAG_DEFINITIONS.map((def) => def.id as FeatureFlagId)
  );

  for (const id of constantIds) {
    if (!registryIds.has(id)) {
      issues.push({
        severity: "error",
        message: `registry missing flag id \`${id}\` — add row to ${FEATURE_FLAG_REGISTRY_DOC}`,
      });
    }
  }

  for (const id of registryIds) {
    if (!constantIds.has(id as FeatureFlagId)) {
      issues.push({
        severity: "error",
        message: `registry orphan id \`${id}\` — remove row or add to feature-flags-constants.ts`,
      });
    }
  }

  const registeredEnvKeys = new Set<string>(
    FEATURE_FLAG_DEFINITIONS.filter((d) => d.kind !== "bundle").map((d) => d.key)
  );
  const usedEnvKeys = await scanEnvFlagLiterals(repoRoot);

  for (const key of usedEnvKeys) {
    if (!registeredEnvKeys.has(key)) {
      issues.push({
        severity: "error",
        message: `env flag \`${key}\` used in repo but missing from FEATURE_FLAG_DEFINITIONS`,
      });
    }
  }

  for (const key of ENV_ESCAPE_FLAG_KEYS) {
    if (!usedEnvKeys.has(key) && key !== "KIMI_SKIP_GOVERNANCE_PREFLIGHT") {
      issues.push({
        severity: "warn",
        message: `escape hatch \`${key}\` registered but not referenced in src/scripts/test yet`,
      });
    }
  }

  const bundleKeysFromDefs = FEATURE_FLAG_DEFINITIONS.filter((d) => d.kind === "bundle").map(
    (d) => d.key
  );
  if (bundleKeysFromDefs.join() !== [...BUNDLE_FEATURE_KEYS].join()) {
    issues.push({
      severity: "error",
      message: "BUNDLE_FEATURE_KEYS out of sync with FEATURE_FLAG_DEFINITIONS bundle rows",
    });
  }

  const escapeKeysFromDefs = FEATURE_FLAG_DEFINITIONS.filter((d) => d.kind === "env-escape").map(
    (d) => d.key
  );
  if (escapeKeysFromDefs.join() !== [...ENV_ESCAPE_FLAG_KEYS].join()) {
    issues.push({
      severity: "error",
      message: "ENV_ESCAPE_FLAG_KEYS out of sync with FEATURE_FLAG_DEFINITIONS escape rows",
    });
  }

  const optInKeysFromDefs = FEATURE_FLAG_DEFINITIONS.filter((d) => d.kind === "env-opt-in").map(
    (d) => d.key
  );
  if (optInKeysFromDefs.join() !== [...ENV_OPT_IN_FLAG_KEYS].join()) {
    issues.push({
      severity: "error",
      message: "ENV_OPT_IN_FLAG_KEYS out of sync with FEATURE_FLAG_DEFINITIONS opt-in rows",
    });
  }

  return issues;
}
