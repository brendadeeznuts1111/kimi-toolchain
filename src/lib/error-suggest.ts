/**
 * Error suggestions enriched with bound define constants from taxonomy linkage.
 */

import { Effect } from "effect";
import { loadRepoDefineMap } from "./build-constants-registry.ts";
import { loadConstantsGolden } from "./constants-heal.ts";
import { readDecisions, type Decision } from "./decision-ledger.ts";
import { suggestForErrorIdEffect } from "./error-clustering.ts";
import {
  buildTaxonomyConstantLinks,
  findLastConstantModification,
  formatAgeShort,
} from "./taxonomy-constants.ts";

export interface BoundConstantContext {
  key: string;
  value: string | number | boolean | undefined;
  goldenStatus: "unchanged" | "drifted" | "missing-golden";
  lastModified?: { ageMs: number; decisionId: string };
}

export interface ErrorSuggestReport {
  errorId: string;
  cluster?: {
    clusterId: string;
    count: number;
    topTaxonomy: string;
    confidence: number;
  };
  boundConstants: BoundConstantContext[];
  suggestion: string;
  autoFix?: string;
  confidence: number;
}

export function formatConstantValue(value: string | number | boolean | undefined): string {
  if (value === undefined) return "(undefined)";
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}

async function resolveGoldenStatus(
  key: string,
  currentValue: string | number | boolean | undefined,
  projectRoot: string
): Promise<"unchanged" | "drifted" | "missing-golden"> {
  const golden = await loadConstantsGolden(projectRoot);
  if (!golden) return "missing-golden";
  const entry = golden.constants[key];
  if (!entry) return "missing-golden";
  if (currentValue === undefined) return "drifted";
  return currentValue === entry.value ? "unchanged" : "drifted";
}

async function resolveBoundConstants(
  keys: string[],
  projectRoot: string,
  decisions: Decision[]
): Promise<BoundConstantContext[]> {
  const contexts: BoundConstantContext[] = [];

  const defineMap = await loadRepoDefineMap(projectRoot);

  for (const key of keys) {
    const value = defineMap.get(key)?.value;
    const goldenStatus = await resolveGoldenStatus(key, value, projectRoot);
    const lastModified = findLastConstantModification(decisions, key);
    contexts.push({ key, value, goldenStatus, lastModified });
  }

  return contexts;
}

export function suggestErrorWithBoundConstantsEffect(
  errorId: string,
  options: { projectRoot: string; failurePath?: string }
): Effect.Effect<ErrorSuggestReport, never> {
  return Effect.gen(function* () {
    const base = yield* suggestForErrorIdEffect(errorId, {
      failurePath: options.failurePath,
      persist: false,
    });
    if (!base) {
      return {
        errorId,
        cluster: undefined,
        boundConstants: [],
        suggestion: "No cluster or taxonomy match found",
        autoFix: undefined,
        confidence: 0,
      };
    }

    const taxonomyId =
      base.cluster?.topTaxonomy ?? base.record?.taxonomyId ?? base.record?.categoryId;
    const links = yield* Effect.tryPromise({
      try: () => buildTaxonomyConstantLinks(options.projectRoot),
      catch: () => [] as Awaited<ReturnType<typeof buildTaxonomyConstantLinks>>,
    }).pipe(
      Effect.catchAll(() =>
        Effect.succeed([] as Awaited<ReturnType<typeof buildTaxonomyConstantLinks>>)
      )
    );
    const link = taxonomyId ? links.find((entry) => entry.taxonomyId === taxonomyId) : undefined;
    const decisions = yield* Effect.tryPromise({
      try: () => readDecisions(options.projectRoot),
      catch: () => [] as Decision[],
    }).pipe(Effect.catchAll(() => Effect.succeed([] as Decision[])));

    const boundConstants = link
      ? yield* Effect.tryPromise({
          try: () => resolveBoundConstants(link.boundConstants, options.projectRoot, decisions),
          catch: () => [] as BoundConstantContext[],
        }).pipe(Effect.catchAll(() => Effect.succeed([] as BoundConstantContext[])))
      : [];

    const suggestion =
      base.playbook?.suggestedFix ??
      base.record?.suggestion ??
      (taxonomyId
        ? `Review cluster outcomes for taxonomy ${taxonomyId}`
        : "No cluster or taxonomy match found");

    return {
      errorId,
      cluster: base.cluster
        ? {
            clusterId: base.cluster.clusterId,
            count: base.cluster.count,
            topTaxonomy: base.cluster.topTaxonomy ?? "unknown",
            confidence: base.confidence,
          }
        : undefined,
      boundConstants,
      suggestion,
      autoFix: base.playbook?.autoFix ?? base.record?.autoFix,
      confidence: base.confidence,
    };
  });
}

export function formatBoundConstantLine(ctx: BoundConstantContext): string {
  const valuePart = `${ctx.key} = ${formatConstantValue(ctx.value)}`;
  if (ctx.lastModified) {
    return `${valuePart}  (modified ${formatAgeShort(ctx.lastModified.ageMs)} via ${ctx.lastModified.decisionId})`;
  }
  if (ctx.goldenStatus === "unchanged") {
    return `${valuePart}  (unchanged since golden)`;
  }
  if (ctx.goldenStatus === "drifted") {
    return `${valuePart}  (drifted from golden)`;
  }
  return `${valuePart}  (no golden baseline)`;
}

export function formatErrorSuggestReport(report: ErrorSuggestReport): string {
  const lines: string[] = [];

  if (report.cluster) {
    lines.push(
      `Cluster: ${report.cluster.topTaxonomy} (${report.cluster.count} error${report.cluster.count === 1 ? "" : "s"})`
    );
  } else {
    lines.push(`Error: ${report.errorId} (no cluster match)`);
  }

  if (report.boundConstants.length > 0) {
    lines.push("  ├─ boundConstants:");
    for (const ctx of report.boundConstants) {
      lines.push(`  │   ${formatBoundConstantLine(ctx)}`);
    }
  }

  lines.push(`  ├─ suggestion: ${report.suggestion}`);
  if (report.autoFix) {
    lines.push(`  ├─ autoFix: ${report.autoFix}`);
  }
  lines.push(`  └─ confidence: ${report.confidence.toFixed(2)}`);

  return lines.join("\n");
}
