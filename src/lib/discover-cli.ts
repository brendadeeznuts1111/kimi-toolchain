/**
 * Shared CLI entry for unified discovery (constants, dx, or both).
 */

import { writeStdoutLine } from "./cli-contract.ts";
import { formatDiscoverCliCompletion } from "./discover-cli-completion.ts";
import {
  DISCOVER_CLI_FLAG_LOOKUP,
  DISCOVER_CLI_KNOWN_FLAGS,
  DISCOVER_CLI_META_SPECS,
  DISCOVER_CLI_SPECS,
  DISCOVER_COMPLETION_SHELLS,
  DISCOVER_COMPLETE_VALUE_KINDS,
  type DiscoverCliOptionSpec,
  type DiscoverCompleteValuesKind,
  type DiscoverShell,
} from "./discover-cli-specs.ts";
import {
  discoverConstants,
  filterConstantsReport,
  type DiscoverConstantsFilters,
} from "./discover-constants.ts";

export {
  DISCOVER_CLI_META_SPECS,
  DISCOVER_CLI_SPECS,
  type DiscoverCliOptionKind,
} from "./discover-cli-specs.ts";
export type { DiscoverCliOptionSpec } from "./discover-cli-specs.ts";
import { formatDiscoverOutput, printLines, writeJson } from "./discover-format.ts";
import { discoverUnified, type DiscoverLayer, type DiscoverUnifiedReport } from "./discover.ts";

export interface DiscoverCliArgs {
  json: boolean;
  deep: boolean;
  probe: boolean;
  layers: DiscoverLayer;
  root: string;
  domain?: string;
  key?: string;
  noUsages: boolean;
  orphansOnly: boolean;
}

export class DiscoverCliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = "DiscoverCliError";
    this.exitCode = exitCode;
  }
}

/** Thrown when --help is requested; handled by {@link runDiscoverCliEntry}. */
export class DiscoverCliHelp extends Error {
  readonly text: string;

  constructor(text: string, invocation = "bun run discover") {
    super(`help requested for ${invocation}`);
    this.name = "DiscoverCliHelp";
    this.text = text;
  }
}

function suggestFlag(unknown: string, candidates: readonly string[]): string | undefined {
  function distance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i]![0] = i;
    for (let j = 0; j <= n; j++) dp[0]![j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i]![j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1]![j - 1]!
            : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
      }
    }
    return dp[m]![n]!;
  }

  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = distance(unknown, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  const threshold = Math.max(1, Math.floor(unknown.length / 2));
  return bestScore <= threshold ? best : undefined;
}

function formatFlagColumn(spec: DiscoverCliOptionSpec): string {
  const flags = spec.flags.join(", ");
  return spec.kind === "value" ? `${flags} <${spec.valueLabel ?? "value"}>` : flags;
}

function formatMetaFlagColumn(spec: (typeof DISCOVER_CLI_META_SPECS)[number]): string {
  return `${spec.flags[0]} <${spec.valueLabel}>`;
}

export function formatDiscoverCliHelp(invocation = "bun run discover"): string {
  const columns = [
    ...DISCOVER_CLI_SPECS.map((spec) => formatFlagColumn(spec)),
    ...DISCOVER_CLI_META_SPECS.map((spec) => formatMetaFlagColumn(spec)),
  ];
  const width = Math.max(...columns.map((column) => column.length));
  const optionLines = DISCOVER_CLI_SPECS.map((spec) => {
    const column = formatFlagColumn(spec).padEnd(width + 2);
    return `  ${column}${spec.description}`;
  });
  const metaLines = DISCOVER_CLI_META_SPECS.map((spec) => {
    const column = formatMetaFlagColumn(spec).padEnd(width + 2);
    return `  ${column}${spec.description}`;
  });

  return [
    `Usage: ${invocation} [options]`,
    "",
    "Examples:",
    `  ${invocation}`,
    `  ${invocation} --deep`,
    `  ${invocation} --constants --domain effect-benchmark`,
    `  ${invocation} --dx --probe`,
    "",
    "Options:",
    ...optionLines,
    ...metaLines,
    "",
    "Shell integration:",
    `  ${invocation} --completion bash > ~/.bun/completions/discover.bash`,
    `  ${invocation} --completion zsh  > ~/.zsh/completions/_discover`,
  ].join("\n");
}

function extractFlagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("-") ? value : undefined;
}

export type DiscoverEarlyRequest =
  | { kind: "completion"; shell: DiscoverShell }
  | { kind: "complete-values"; valueKind: DiscoverCompleteValuesKind; root: string }
  | { kind: "run" };

export function parseDiscoverEarlyRequest(
  argv: readonly string[],
  defaultRoot: string
): DiscoverEarlyRequest {
  const completion = extractFlagValue(argv, "--completion");
  if (completion !== undefined) {
    if (!DISCOVER_COMPLETION_SHELLS.includes(completion as DiscoverShell)) {
      throw new DiscoverCliError(
        `--completion requires ${DISCOVER_COMPLETION_SHELLS.join(" or ")}`
      );
    }
    return { kind: "completion", shell: completion as DiscoverShell };
  }

  const completeValues = extractFlagValue(argv, "--complete-values");
  if (completeValues !== undefined) {
    if (!DISCOVER_COMPLETE_VALUE_KINDS.includes(completeValues as DiscoverCompleteValuesKind)) {
      throw new DiscoverCliError(
        `--complete-values requires ${DISCOVER_COMPLETE_VALUE_KINDS.join(" or ")}`
      );
    }
    return {
      kind: "complete-values",
      valueKind: completeValues as DiscoverCompleteValuesKind,
      root: extractFlagValue(argv, "--root") ?? defaultRoot,
    };
  }

  return { kind: "run" };
}

export async function listDiscoverCompleteValues(
  kind: DiscoverCompleteValuesKind,
  root: string
): Promise<string[]> {
  const report = await discoverConstants(root, { includeUsages: false });
  if (kind === "domain") {
    return [...new Set(report.constants.map((entry) => entry.domain))].sort();
  }
  return report.constants.map((entry) => entry.key).sort();
}

function resolveLayers(constants: boolean, dx: boolean): DiscoverLayer {
  return constants && !dx ? "constants" : dx && !constants ? "dx" : "all";
}

export function parseDiscoverCliArgs(
  argv: readonly string[],
  defaultRoot: string,
  invocation = "bun run discover"
): DiscoverCliArgs {
  const state = {
    json: false,
    deep: false,
    probe: false,
    constants: false,
    dx: false,
    root: defaultRoot,
    domain: undefined as string | undefined,
    key: undefined as string | undefined,
    noUsages: false,
    orphansOnly: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("-")) {
      throw new DiscoverCliError(`unexpected argument "${arg}" (discovery accepts flags only)`);
    }

    const spec = DISCOVER_CLI_FLAG_LOOKUP.get(arg);
    if (!spec) {
      const hint = suggestFlag(arg, DISCOVER_CLI_KNOWN_FLAGS);
      throw new DiscoverCliError(`unknown flag ${arg}${hint ? ` (did you mean ${hint}?)` : ""}`);
    }

    if (spec.kind === "help") {
      throw new DiscoverCliHelp(formatDiscoverCliHelp(invocation), invocation);
    }

    if (spec.kind === "boolean") {
      switch (spec.key) {
        case "constants":
          state.constants = true;
          break;
        case "dx":
          state.dx = true;
          break;
        case "json":
          state.json = true;
          break;
        case "deep":
          state.deep = true;
          break;
        case "probe":
          state.probe = true;
          break;
        case "noUsages":
          state.noUsages = true;
          break;
        case "orphansOnly":
          state.orphansOnly = true;
          break;
        default:
          throw new DiscoverCliError(`internal error: unhandled boolean flag ${arg}`);
      }
      continue;
    }

    const value = argv[++i];
    if (!value || value.startsWith("-")) {
      const label = spec.valueLabel ?? "a value";
      throw new DiscoverCliError(
        `${arg} requires ${label}${value ? `; got flag ${value} instead` : ""}`
      );
    }

    if (spec.key === "root") state.root = value;
    else if (spec.key === "domain") state.domain = value;
    else if (spec.key === "key") state.key = value;
  }

  const args: DiscoverCliArgs = {
    json: state.json,
    deep: state.deep,
    probe: state.probe,
    layers: resolveLayers(state.constants, state.dx),
    root: state.root,
    domain: state.domain,
    key: state.key,
    noUsages: state.noUsages,
    orphansOnly: state.orphansOnly,
  };

  const constantsFilters = Boolean(args.domain || args.key || args.orphansOnly || args.noUsages);
  if (args.layers === "dx" && constantsFilters) {
    throw new DiscoverCliError(
      "constants filters (--domain, --key, --orphans, --no-usages) require the constants layer; omit --dx or add --constants"
    );
  }
  if (args.layers === "constants" && args.probe) {
    process.stderr.write(
      "discover: note: --probe applies to the dx layer only (ignored with --constants)\n"
    );
  }
  return args;
}

function jsonPayload(report: DiscoverUnifiedReport, layers: DiscoverLayer): unknown {
  if (layers === "constants") return report.constants;
  if (layers === "dx") return report.dx;
  return report;
}

export async function runDiscoverCliEntry(
  argv: readonly string[],
  defaultRoot: string,
  invocation = "bun run discover"
): Promise<void> {
  const early = parseDiscoverEarlyRequest(argv, defaultRoot);

  if (early.kind === "completion") {
    process.stdout.write(formatDiscoverCliCompletion(early.shell, DISCOVER_CLI_SPECS, invocation));
    return;
  }

  if (early.kind === "complete-values") {
    const values = await listDiscoverCompleteValues(early.valueKind, early.root);
    if (values.length > 0) process.stdout.write(`${values.join("\n")}\n`);
    return;
  }

  let args: DiscoverCliArgs;
  try {
    args = parseDiscoverCliArgs(argv, defaultRoot, invocation);
  } catch (err) {
    if (err instanceof DiscoverCliHelp) {
      await writeStdoutLine(err.text);
      return;
    }
    throw err;
  }

  await runDiscoverCli(args);
}

export async function runDiscoverCli(args: DiscoverCliArgs): Promise<void> {
  const filters: DiscoverConstantsFilters = {
    domain: args.domain,
    key: args.key,
    orphansOnly: args.orphansOnly,
  };
  const hasConstantsFilters = Boolean(args.domain || args.key || args.orphansOnly);

  try {
    let report = await discoverUnified(args.root, {
      layers: args.layers,
      constants: { includeUsages: !args.noUsages },
      dx: { evaluateProbes: args.probe, probeEndpoints: args.probe },
    });

    if (args.layers !== "dx" && hasConstantsFilters && report.constants) {
      const constants = filterConstantsReport(report.constants, filters);
      report = {
        ...report,
        constants,
        health: { ...report.health, constants: constants.healthScore },
      };
    }

    if (args.json) {
      await writeJson(jsonPayload(report, args.layers));
      return;
    }

    await printLines(formatDiscoverOutput(report, { deep: args.deep, layers: args.layers }));
  } catch (err) {
    if (err instanceof DiscoverCliError) throw err;
    const detail = err instanceof Error ? err.message : Bun.inspect(err);
    throw new DiscoverCliError(`discovery run failed: ${detail}`, 1);
  }
}
