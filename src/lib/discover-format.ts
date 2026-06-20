/**
 * Shared text formatting for discovery CLI output (constants, dx, unified).
 */

import { formatConstantRange } from "./build-constants-registry.ts";
import type { DiscoveredConstant, DiscoverConstantsReport } from "./discover-constants.ts";
import type {
  DiscoveredEndpoint,
  DiscoveredHandoffRule,
  DiscoverDxInventoryReport,
} from "./discover-dx-inventory.ts";
import type { DiscoverLayer, DiscoverUnifiedGap, DiscoverUnifiedReport } from "./discover.ts";
import { emptyToEmDash } from "./markdown-table.ts";

export const EM_DASH = "—";

export interface TextTableOptions {
  headers: readonly string[];
  rows: readonly (readonly string[])[];
  indent?: number;
  maxCellWidth?: number;
}

export interface GapListOptions {
  limit?: number;
  prefix?: string;
  showOverflow?: boolean;
}

function indentLine(line: string, indent = 0): string {
  return indent > 0 ? `${" ".repeat(indent)}${line}` : line;
}

function truncateCell(value: string, max?: number): string {
  if (!max || value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}…`;
}

export function formatHealthScore(score: number): string {
  return `${score}/100`;
}

export function formatBoolStatus(value: boolean, style: "yes-no" | "ok-fail" = "yes-no"): string {
  if (style === "ok-fail") return value ? "ok" : "FAIL";
  return value ? "yes" : "no";
}

export function formatSection(title: string): string {
  return `\n── ${title} ${"─".repeat(Math.max(0, 52 - title.length))}`;
}

export function formatKvPairs(
  pairs: Record<string, string | number | boolean | undefined>
): string {
  return Object.entries(pairs)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join("  ");
}

export function formatKvBlock(
  entries: Record<string, string | number | boolean | undefined>,
  labelWidth = 12
): string[] {
  return Object.entries(entries)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `  ${key.padEnd(labelWidth)}${value}`);
}

export function formatTextTable(options: TextTableOptions): string[] {
  const { headers, rows, indent = 0, maxCellWidth } = options;
  if (rows.length === 0) return [indentLine("(empty)", indent)];

  const cells = rows.map((row) =>
    row.map((cell) => truncateCell(String(cell ?? EM_DASH), maxCellWidth ?? undefined))
  );
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...cells.map((row) => row[index]?.length ?? 0))
  );

  const formatRow = (row: readonly string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index]!)).join("  ");

  return [
    indentLine(formatRow(headers), indent),
    indentLine(widths.map((width) => "-".repeat(width)).join("  "), indent),
    ...cells.map((row) => indentLine(formatRow(row), indent)),
  ];
}

export function formatGapList(
  gaps: readonly string[] | readonly DiscoverUnifiedGap[],
  options: GapListOptions = {}
): string[] {
  const prefix = options.prefix ?? "  - ";
  const limit = options.limit;
  const normalized = gaps.map((gap) =>
    typeof gap === "string" ? gap : `[${gap.source}] ${gap.message}`
  );
  const slice = limit === undefined ? normalized : normalized.slice(0, limit);
  const lines = slice.map((gap) => `${prefix}${gap}`);

  if (options.showOverflow !== false && limit !== undefined && normalized.length > limit) {
    lines.push(`${prefix}... +${normalized.length - limit} more`);
  }

  return lines;
}

export function formatConstantsSummary(report: DiscoverConstantsReport): string[] {
  const lines = [
    `health ${formatHealthScore(report.healthScore)}`,
    formatKvPairs({
      tuningSetVersion: report.tuningSetVersion,
      constants: report.constantCount,
      valid: report.validCount,
      invalid: report.invalidCount,
      orphans: report.orphanCount,
      annotationGaps: report.annotationGapCount,
      goldenDrift: report.goldenDriftCount,
      manifestStale: formatBoolStatus(report.manifestStale),
    }),
  ];

  if (report.alignment.definesWithoutTypes.length > 0) {
    lines.push(`definesWithoutTypes: ${report.alignment.definesWithoutTypes.join(", ")}`);
  }
  if (report.alignment.typesWithoutDefines.length > 0) {
    lines.push(`typesWithoutDefines: ${report.alignment.typesWithoutDefines.join(", ")}`);
  }
  if (report.goldenDiff && report.goldenDiff.drifted.length > 0) {
    lines.push(
      `goldenDriftKeys: ${report.goldenDiff.drifted.map((entry) => entry.key).join(", ")}`
    );
  }

  return lines;
}

export function formatConstantsDomainTable(report: DiscoverConstantsReport): string[] {
  return formatTextTable({
    headers: ["DOMAIN", "COUNT", "VALID", "ORPHANS", "TAX"],
    rows: report.domains.map((domain) => [
      domain.domain,
      String(domain.constantCount),
      String(domain.validCount),
      String(domain.orphanCount),
      String(domain.taxonomyBoundCount),
    ]),
  });
}

export function formatConstantsTable(constants: readonly DiscoveredConstant[]): string[] {
  return formatTextTable({
    headers: ["DOMAIN", "KEY", "VALUE", "RANGE", "VALID", "SRC", "TAX"],
    rows: constants.map((entry) => [
      entry.domain,
      entry.key,
      String(entry.value),
      formatConstantRange(entry.range),
      formatBoolStatus(entry.valid),
      String(entry.usageBreakdown.src.length),
      String(entry.taxonomy.length),
    ]),
    maxCellWidth: 40,
  });
}

export function formatConstantDeep(entry: DiscoveredConstant): string[] {
  const lines = [
    `\n${entry.key}  (${entry.domain})`,
    ...formatKvBlock({
      type: entry.typeExpr ?? entry.type,
      value: entry.value,
      range: formatConstantRange(entry.range),
      valid: formatBoolStatus(entry.valid),
      orphan: entry.orphan ? "yes (no src/ refs)" : "no",
      annotated: formatBoolStatus(entry.annotationsComplete),
    }),
  ];

  if (entry.validationIssues.length > 0) {
    lines.push(`  issues:      ${entry.validationIssues.join("; ")}`);
  }
  if (entry.description) lines.push(`  description: ${entry.description}`);
  if (entry.restrictions) lines.push(`  restrictions:${entry.restrictions}`);
  if (entry.sources.bunfigLine || entry.sources.typesLine) {
    lines.push(
      `  sources:     bunfig:${entry.sources.bunfigLine ?? "?"}  types:${entry.sources.typesLine ?? "?"}  raw=${entry.sources.rawValue ?? "?"}`
    );
  }
  if (entry.suggestionMentions.length > 0) {
    lines.push(`  suggestions: ${entry.suggestionMentions.join(", ")}`);
  }
  if (entry.taxonomy.length > 0) {
    lines.push("  taxonomy:");
    for (const binding of entry.taxonomy) {
      lines.push(
        `    - ${binding.id} (${binding.severity}) failures=${binding.failureCount}  ${binding.name}`
      );
    }
  }
  if (entry.lastModified) {
    lines.push(
      `  lastModified:${entry.lastModified.ageLabel}  decision=${entry.lastModified.decisionId}`
    );
  }
  if (entry.parity) {
    lines.push(
      `  parity:      ${entry.parity.id}  aligned=${formatBoolStatus(entry.parity.aligned)}${entry.parity.drift ? `  drift=${entry.parity.drift}` : ""}`
    );
  }
  if (entry.goldenValue !== undefined) {
    lines.push(
      `  golden:      ${entry.goldenValue}${entry.goldenDrift ? "  (drift from live value)" : ""}`
    );
  }
  if (entry.literalDuplicateHits.length > 0) {
    lines.push(`  literalDup:  ${entry.literalDuplicateHits.join(", ")}`);
  }
  if (entry.seeResolved.length > 0) {
    lines.push("  see:");
    for (const ref of entry.seeResolved) {
      lines.push(`    - ${ref.ref}  exists=${formatBoolStatus(ref.exists)}`);
    }
  }

  const { src, test, scripts } = entry.usageBreakdown;
  if (entry.usages.length > 0) {
    lines.push(`  usages:      src=${src.length} test=${test.length} scripts=${scripts.length}`);
    for (const usage of src.slice(0, 6)) lines.push(`    src: ${usage}`);
    for (const usage of test.slice(0, 4)) lines.push(`    test: ${usage}`);
    for (const usage of scripts.slice(0, 4)) lines.push(`    scripts: ${usage}`);
    const shown = Math.min(src.length, 6) + Math.min(test.length, 4) + Math.min(scripts.length, 4);
    if (entry.usages.length > shown) lines.push(`    ... +${entry.usages.length - shown} more`);
  } else {
    lines.push("  usages:      (none in src/test/scripts)");
  }

  return lines;
}

export function formatConstantsDeep(report: DiscoverConstantsReport): string[] {
  return [
    formatSection("Domains"),
    ...formatConstantsDomainTable(report),
    formatSection("Constants"),
    ...report.constants.flatMap((entry) => formatConstantDeep(entry)),
  ];
}

export function formatDxSummary(report: DiscoverDxInventoryReport): string[] {
  return [
    `health ${formatHealthScore(report.healthScore)}`,
    formatKvPairs({
      endpoints: report.endpointCount,
      uniqueUrls: report.uniqueUrlCount,
      duplicateGroups: report.duplicateUrlGroups,
      handoffRules: report.handoffRuleCount,
      finishWorkGates: report.finishWorkGateCount,
      remoteHosts: report.remoteHostCount,
      probes: `${report.configuredProbeCount}/${report.availableProbeCount}`,
    }),
  ];
}

export function formatDxEndpointsTable(endpoints: readonly DiscoveredEndpoint[]): string[] {
  return formatTextTable({
    headers: ["NAME", "STACK", "PORT", "PATH", "DUP"],
    rows: endpoints.map((entry) => [
      entry.name,
      entry.stack,
      emptyToEmDash(entry.port),
      emptyToEmDash(entry.pathname),
      entry.duplicateNames.length > 0 ? entry.duplicateNames.join(",") : EM_DASH,
    ]),
    maxCellWidth: 36,
  });
}

export function formatDxRulesTable(rules: readonly DiscoveredHandoffRule[]): string[] {
  return formatTextTable({
    headers: ["#", "FROM", "CONDITION", "WHEN", "TO", "REQS"],
    rows: rules.map((rule) => [
      String(rule.index),
      `${rule.fromAgent}@${rule.fromWorkspace}`,
      truncateCell(rule.condition, 36),
      rule.when.length > 0 ? String(rule.when.length) : EM_DASH,
      `${rule.toAgent}@${rule.toWorkspace}`,
      String(rule.requirements.length),
    ]),
    maxCellWidth: 36,
  });
}

export function formatDxDeep(report: DiscoverDxInventoryReport): string[] {
  const lines: string[] = [
    formatSection("Orchestrator"),
    ...formatKvBlock({
      enabled: formatBoolStatus(report.orchestrator.enabled),
      handoff: `${report.orchestrator.handoffFrom ?? EM_DASH} → ${report.orchestrator.handoffTo ?? EM_DASH}`,
      contextOnIdle: report.orchestrator.contextOnIdle,
      reviewerTab: report.orchestrator.reviewerTab,
      examplesUrl: report.orchestrator.dashboardExamplesUrl,
    }),
    formatSection("Port alignment"),
    ...formatKvBlock({
      dashboard: report.portAlignment.dashboardPort,
      doctorProbe: report.portAlignment.doctorProbePort,
      examples: report.portAlignment.examplesPorts.join(",") || EM_DASH,
      herdr: report.portAlignment.herdrPorts.join(",") || EM_DASH,
      aligned: formatBoolStatus(report.portAlignment.aligned),
    }),
    ...(report.portAlignment.notes.length > 0
      ? report.portAlignment.notes.map((note) => `  note: ${note}`)
      : []),
    formatSection("TOML tables"),
    `  ${report.registeredTomlTables.join(", ")}`,
    formatSection("Finish-work gates"),
    ...report.finishWork.gates.map((gate) => `  - ${gate}`),
  ];

  if (report.finishWork.followUp) lines.push(`  followUp: ${report.finishWork.followUp}`);

  lines.push(formatSection("Probe coverage"));
  for (const probe of report.probeCoverage) {
    const rules =
      probe.ruleIndexes.length > 0 ? `rules=${probe.ruleIndexes.join(",")}` : "not configured";
    lines.push(`  ${probe.id.padEnd(42)} [${probe.family}]  ${rules}`);
  }

  if (report.liveProbes) {
    lines.push(formatSection("Live probes"));
    for (const probe of report.liveProbes) {
      lines.push(
        `  ${formatBoolStatus(probe.ok, "ok-fail").padEnd(4)} ${probe.probeId} — ${probe.message}`
      );
    }
  }

  if (report.endpointReachability) {
    lines.push(formatSection("Endpoint reachability"));
    for (const endpoint of report.endpointReachability) {
      if (endpoint.skipped) {
        lines.push(`  skip ${endpoint.name} — ${endpoint.skipReason}`);
        continue;
      }
      lines.push(
        `  ${formatBoolStatus(endpoint.reachable, "ok-fail").padEnd(4)} ${endpoint.name} ${endpoint.statusCode ?? EM_DASH} ${endpoint.latencyMs}ms`
      );
    }
  }

  lines.push(formatSection("Handoff rules (ANDed)"));
  for (const rule of report.handoffRules) {
    lines.push(`\n  Rule ${rule.index}  line=${rule.line ?? "?"}`);
    lines.push(`    ${rule.fromAgent}@${rule.fromWorkspace} → ${rule.toAgent}@${rule.toWorkspace}`);
    lines.push(`    strategy=${rule.targetStrategy}  kind=${rule.conditionKind}`);
    for (const req of rule.requirements) lines.push(`    • ${req}`);
  }

  if (report.remoteHosts.length > 0) {
    lines.push(formatSection("Remote hosts"));
    for (const host of report.remoteHosts) {
      lines.push(
        `  ${host.name} → ${host.host}  handoffRule=${formatBoolStatus(host.hasHandoffRule)}`
      );
    }
  }

  if (report.gaps.length > 0) {
    lines.push(formatSection(`Gaps (${report.gaps.length})`));
    lines.push(...formatGapList(report.gaps));
  }

  return lines;
}

export function formatDxDefault(report: DiscoverDxInventoryReport): string[] {
  const lines = [
    formatSection("Endpoints"),
    ...formatDxEndpointsTable(report.endpoints),
    formatSection("Handoff rules"),
    ...formatDxRulesTable(report.handoffRules),
  ];

  if (report.gaps.length > 0) {
    lines.push(formatSection(`Gaps (${report.gaps.length})`));
    lines.push(...formatGapList(report.gaps, { limit: 5, showOverflow: true }));
  }

  return lines;
}

export function formatUnifiedSummary(report: DiscoverUnifiedReport): string[] {
  const lines = [
    `health overall=${formatHealthScore(report.health.overall)}  constants=${formatHealthScore(report.health.constants)}  dx=${formatHealthScore(report.health.dx)}`,
  ];

  if (report.constants)
    lines.push(...formatConstantsSummary(report.constants).map((line) => `constants ${line}`));
  if (report.dx) lines.push(...formatDxSummary(report.dx).map((line) => `dx ${line}`));
  if (report.unifiedGaps.length > 0) lines.push(`gaps ${report.unifiedGaps.length}`);

  return lines;
}

export function formatUnifiedDefault(report: DiscoverUnifiedReport): string[] {
  const lines: string[] = [...formatUnifiedSummary(report)];

  if (report.constants) {
    lines.push(formatSection("Constants"));
    lines.push(...formatConstantsTable(report.constants.constants));
  }
  if (report.dx) {
    lines.push(...formatDxDefault(report.dx));
  }
  if (report.unifiedGaps.length > 0) {
    lines.push(formatSection(`Unified gaps (${report.unifiedGaps.length})`));
    lines.push(...formatGapList(report.unifiedGaps, { limit: 8, showOverflow: true }));
  }

  return lines;
}

export function formatUnifiedDeep(report: DiscoverUnifiedReport): string[] {
  const lines: string[] = [...formatUnifiedSummary(report)];

  if (report.constants) {
    lines.push(...formatConstantsDeep(report.constants));
  }
  if (report.dx) {
    lines.push(...formatDxDeep(report.dx));
  }
  if (report.crossLinks.length > 0) {
    lines.push(formatSection(`Cross-links (${report.crossLinks.length})`));
    for (const link of report.crossLinks.slice(0, 16)) {
      lines.push(`  [${link.kind}] ${link.from} → ${link.to}`);
    }
    if (report.crossLinks.length > 16) {
      lines.push(`  ... +${report.crossLinks.length - 16} more`);
    }
  }
  if (report.unifiedGaps.length > 0) {
    lines.push(formatSection(`Unified gaps (${report.unifiedGaps.length})`));
    lines.push(...formatGapList(report.unifiedGaps));
  }

  return lines;
}

export function formatDiscoverOutput(
  report: DiscoverUnifiedReport,
  options: { deep: boolean; layers: DiscoverLayer }
): string[] {
  if (options.layers === "constants" && report.constants) {
    if (report.constants.constants.length === 0) return ["No constants matched the filter"];
    const lines = [...formatConstantsSummary(report.constants)];
    if (options.deep) return [...lines, ...formatConstantsDeep(report.constants)];
    return [
      ...lines,
      formatSection("Constants"),
      ...formatConstantsTable(report.constants.constants),
    ];
  }

  if (options.layers === "dx" && report.dx) {
    const lines = [...formatDxSummary(report.dx)];
    return [...lines, ...(options.deep ? formatDxDeep(report.dx) : formatDxDefault(report.dx))];
  }

  return options.deep ? formatUnifiedDeep(report) : formatUnifiedDefault(report);
}

export function printLines(lines: readonly string[]): void {
  for (const line of lines) console.log(line);
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
