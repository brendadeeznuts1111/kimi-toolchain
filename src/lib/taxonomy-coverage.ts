/**
 * Audit error-taxonomy categories for boundConstants coverage.
 */

import { existsSync } from "fs";
import { join } from "path";
import { loadRepoDefineMap } from "./build-constants-registry.ts";
import { loadTaxonomy, type TaxonomyCategory } from "./error-taxonomy.ts";

export interface TaxonomyCoverageRow {
  taxonomyId: string;
  status: "ok" | "warn";
  boundCount: number;
  suggestion?: string;
  message: string;
}

const TAXONOMY_CONSTANT_HINTS: Record<string, string> = {
  hook_timeout: "KIMI_HOOK_VERIFIER_MAX_CYCLES",
  timeout_hang: "KIMI_HOOK_VERIFIER_MAX_CYCLES",
  network_timeout: "KIMI_NETWORK_TIMEOUT_MS",
  network_partition: "KIMI_NETWORK_TIMEOUT_MS",
  constants_drift: "KIMI_TUNING_SET_VERSION",
  lockfile_issue: "KIMI_HOOK_VERIFIER_MAX_CYCLES",
  memory_limit: "KIMI_GOVERNOR_MAX_PARALLEL_JOBS",
};

const SKIP_TAXONOMY_IDS = new Set(["unknown"]);

function shouldRequireBoundConstants(category: TaxonomyCategory): boolean {
  if (SKIP_TAXONOMY_IDS.has(category.id)) return false;
  if (category.expected === true) return false;
  return category.severity !== "info";
}

function suggestConstantForTaxonomy(
  taxonomyId: string,
  defineKeys: Set<string>
): string | undefined {
  const direct = TAXONOMY_CONSTANT_HINTS[taxonomyId];
  if (direct && defineKeys.has(direct)) return direct;

  const tokens = taxonomyId.split("_");
  for (const key of defineKeys) {
    const normalized = key.toLowerCase();
    if (tokens.some((token) => token.length > 3 && normalized.includes(token))) {
      return key;
    }
  }

  return TAXONOMY_CONSTANT_HINTS[taxonomyId];
}

export async function auditTaxonomyCoverage(projectRoot: string): Promise<{
  applicable: boolean;
  aligned: boolean;
  rows: TaxonomyCoverageRow[];
}> {
  const taxonomyPath = join(projectRoot, "error-taxonomy.yml");
  if (!existsSync(taxonomyPath)) {
    return { applicable: false, aligned: true, rows: [] };
  }

  const taxonomy = await loadTaxonomy(taxonomyPath);
  const defineMap = await loadRepoDefineMap(projectRoot);
  const defineKeys = new Set(defineMap.keys());
  const rows: TaxonomyCoverageRow[] = [];

  for (const category of taxonomy.categories) {
    const boundCount = category.boundConstants?.length ?? 0;
    if (!shouldRequireBoundConstants(category)) continue;

    if (boundCount > 0) {
      rows.push({
        taxonomyId: category.id,
        status: "ok",
        boundCount,
        message: `${category.id} — ${boundCount} bound constant${boundCount === 1 ? "" : "s"}`,
      });
      continue;
    }

    const suggestion = suggestConstantForTaxonomy(category.id, defineKeys);
    rows.push({
      taxonomyId: category.id,
      status: "warn",
      boundCount: 0,
      suggestion,
      message: suggestion
        ? `${category.id} — no boundConstants (suggest: ${suggestion})`
        : `${category.id} — no boundConstants`,
    });
  }

  return {
    applicable: true,
    aligned: rows.every((row) => row.status === "ok"),
    rows,
  };
}
