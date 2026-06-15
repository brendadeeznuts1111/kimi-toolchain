/**
 * Auto-healing for bunfig [define] constants via golden template diff + repair.
 */

import { existsSync } from "fs";
import { join } from "path";
import {
  loadRepoDefineMap,
  parseBunfigDefines,
  TUNING_SET_VERSION_KEY,
  type DefineEntry,
} from "./build-constants-registry.ts";
import { logDecision, updateDecisionOutcome } from "./decision-ledger.ts";
import { ensureProcessTrace } from "./effect/trace-context.ts";
import { constantsGoldenPath } from "./paths.ts";
import { ensureDir } from "./utils.ts";

export const GOLDEN_SCHEMA_VERSION = 1;

export interface GoldenConstant {
  defineDomain: string;
  rawValue: string;
  value: string | number | boolean;
}

export interface ConstantsGolden {
  schemaVersion: number;
  tuningSetVersion: string;
  capturedAt: string;
  constants: Record<string, GoldenConstant>;
}

export interface InvalidConstant {
  key: string;
  expected: string | number | boolean;
  actual: string | number | boolean;
}

export interface ConstantRepairDiff {
  missingKeys: string[];
  invalidKeys: InvalidConstant[];
}

export interface ConstantRepairPlan {
  goldenPath: string;
  goldenVersion: string;
  diff: ConstantRepairDiff;
  repairCount: number;
  canRepair: boolean;
}

export interface ConstantRepairResult {
  applied: boolean;
  dryRun: boolean;
  plan: ConstantRepairPlan;
  decisionId?: string;
  repairedBunfig?: string;
  detail: string;
}

const DEFINE_KEY = /^([A-Z][A-Z0-9_]*) = /;

export async function captureConstantsGolden(projectRoot: string): Promise<ConstantsGolden> {
  const defines = parseBunfigDefines(await Bun.file(join(projectRoot, "bunfig.toml")).text());
  const constants: Record<string, GoldenConstant> = {};

  for (const define of defines) {
    constants[define.key] = {
      defineDomain: define.defineDomain,
      rawValue: define.rawValue,
      value: define.value,
    };
  }

  const tuning = constants[TUNING_SET_VERSION_KEY]?.value;
  return {
    schemaVersion: GOLDEN_SCHEMA_VERSION,
    tuningSetVersion: typeof tuning === "string" ? tuning : "0.0.0",
    capturedAt: new Date().toISOString(),
    constants,
  };
}

export async function writeConstantsGolden(
  projectRoot: string,
  golden?: ConstantsGolden
): Promise<ConstantsGolden> {
  const snapshot = golden ?? (await captureConstantsGolden(projectRoot));
  const path = constantsGoldenPath(projectRoot);
  ensureDir(join(projectRoot, ".kimi", "var"));
  await Bun.write(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

export async function loadConstantsGolden(projectRoot: string): Promise<ConstantsGolden | null> {
  const path = constantsGoldenPath(projectRoot);
  if (!existsSync(path)) return null;
  try {
    return (await Bun.file(path).json()) as ConstantsGolden;
  } catch {
    return null;
  }
}

export function diffAgainstGolden(
  current: Map<string, DefineEntry>,
  golden: ConstantsGolden
): ConstantRepairDiff {
  const missingKeys: string[] = [];
  const invalidKeys: InvalidConstant[] = [];

  for (const [key, goldenEntry] of Object.entries(golden.constants)) {
    const live = current.get(key);
    if (!live) {
      missingKeys.push(key);
      continue;
    }
    if (live.value !== goldenEntry.value) {
      invalidKeys.push({
        key,
        expected: goldenEntry.value,
        actual: live.value,
      });
    }
  }

  missingKeys.sort();
  invalidKeys.sort((a, b) => a.key.localeCompare(b.key));
  return { missingKeys, invalidKeys };
}

export async function buildConstantRepairPlan(projectRoot: string): Promise<ConstantRepairPlan> {
  const goldenPath = constantsGoldenPath(projectRoot);
  const golden = await loadConstantsGolden(projectRoot);
  if (!golden) {
    return {
      goldenPath,
      goldenVersion: "missing",
      diff: { missingKeys: [], invalidKeys: [] },
      repairCount: 0,
      canRepair: false,
    };
  }

  const current = await loadRepoDefineMap(projectRoot);
  const diff = diffAgainstGolden(current, golden);
  const repairCount = diff.missingKeys.length + diff.invalidKeys.length;

  return {
    goldenPath,
    goldenVersion: golden.tuningSetVersion,
    diff,
    repairCount,
    canRepair: repairCount > 0,
  };
}

export function applyDefineRepairs(
  bunfigText: string,
  golden: ConstantsGolden,
  diff: ConstantRepairDiff
): string {
  const lines = bunfigText.split("\n");
  let defineStart = -1;
  let defineEnd = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "[define]") {
      defineStart = i;
      continue;
    }
    if (defineStart >= 0 && line.startsWith("[") && line.endsWith("]")) {
      defineEnd = i;
      break;
    }
  }

  if (defineStart < 0) {
    const goldenLines = Object.entries(golden.constants).flatMap(([key, entry]) => [
      `# define-domain:${entry.defineDomain}`,
      `${key} = ${entry.rawValue}`,
    ]);
    return `${bunfigText.trim()}\n\n[define]\n${goldenLines.join("\n")}\n`;
  }

  for (const invalid of diff.invalidKeys) {
    const goldenEntry = golden.constants[invalid.key];
    if (!goldenEntry) continue;
    for (let i = defineStart + 1; i < defineEnd; i++) {
      const keyMatch = lines[i]!.match(DEFINE_KEY);
      if (keyMatch?.[1] === invalid.key) {
        lines[i] = `${invalid.key} = ${goldenEntry.rawValue}`;
        break;
      }
    }
  }

  const insertLines: string[] = [];
  let lastDomain: string | null = null;
  for (const key of diff.missingKeys) {
    const entry = golden.constants[key];
    if (!entry) continue;
    if (entry.defineDomain !== lastDomain) {
      insertLines.push(`# define-domain:${entry.defineDomain}`);
      lastDomain = entry.defineDomain;
    }
    insertLines.push(`${key} = ${entry.rawValue}`);
  }

  if (insertLines.length > 0) {
    lines.splice(defineEnd, 0, ...insertLines);
  }

  return lines.join("\n");
}

export async function repairConstants(options: {
  projectRoot: string;
  dryRun?: boolean;
  traceId?: string;
}): Promise<ConstantRepairResult> {
  const plan = await buildConstantRepairPlan(options.projectRoot);
  if (!plan.canRepair) {
    if (plan.goldenVersion === "missing") {
      return {
        applied: false,
        dryRun: !!options.dryRun,
        plan,
        detail: "golden template missing — run: kimi-heal constants snapshot",
      };
    }
    return {
      applied: false,
      dryRun: !!options.dryRun,
      plan,
      detail: "bunfig.toml [define] matches golden template",
    };
  }

  const golden = (await loadConstantsGolden(options.projectRoot))!;
  const bunfigPath = join(options.projectRoot, "bunfig.toml");
  const bunfigText = await Bun.file(bunfigPath).text();
  const repairedBunfig = applyDefineRepairs(bunfigText, golden, plan.diff);
  const restoredKeys = [...plan.diff.missingKeys, ...plan.diff.invalidKeys.map((item) => item.key)];
  const traceId = options.traceId ?? ensureProcessTrace().traceId;

  if (options.dryRun) {
    return {
      applied: false,
      dryRun: true,
      plan,
      repairedBunfig,
      detail: `dry-run: would restore ${restoredKeys.length} key(s): ${restoredKeys.join(", ")}`,
    };
  }

  await Bun.write(bunfigPath, repairedBunfig);
  const decision = await logDecision(
    {
      action: "config-change",
      trigger: { traceId },
      metadata: {
        type: "constant-repair",
        playbookId: "constant-repair",
        goldenVersion: golden.tuningSetVersion,
        restoredKeys,
        diff: plan.diff,
      },
      rationaleOverride: {
        summary: `Restored ${restoredKeys.length} define constant(s) from golden v${golden.tuningSetVersion}`,
        fullReasoning: `Compared bunfig.toml [define] against ${plan.goldenPath} and restored missing or drifted keys: ${restoredKeys.join(", ")}.`,
        evidence: [
          {
            type: "contractDiff",
            detail: `goldenVersion=${golden.tuningSetVersion}; restored=${restoredKeys.join(",")}`,
          },
        ],
      },
      outcome: { result: "success", verifiedAt: new Date().toISOString() },
    },
    { projectRoot: options.projectRoot }
  );

  await updateDecisionOutcome(
    decision.decisionId,
    {
      result: "success",
      verifiedAt: new Date().toISOString(),
      proof: {
        type: "drift-resolved",
        detail: "bunfig.toml [define] realigned to golden template",
      },
    },
    { projectRoot: options.projectRoot }
  );

  return {
    applied: true,
    dryRun: false,
    plan,
    decisionId: decision.decisionId,
    repairedBunfig,
    detail: `restored ${restoredKeys.length} key(s); decision ${decision.decisionId}`,
  };
}
