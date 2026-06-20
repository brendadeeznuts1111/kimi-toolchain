import { describe, expect, it } from "bun:test";
import { join } from "path";
import { formatDiscoverCliCompletion } from "../src/lib/discover-cli-completion.ts";
import { DISCOVER_CLI_META_SPECS, DISCOVER_CLI_SPECS } from "../src/lib/discover-cli-specs.ts";
import {
  DiscoverCliError,
  formatDiscoverCliHelp,
  listDiscoverCompleteValues,
  parseDiscoverCliArgs,
  parseDiscoverEarlyRequest,
} from "../src/lib/discover-cli.ts";
import { filterConstantsReport } from "../src/lib/discover-constants.ts";
import { formatDiscoverOutput } from "../src/lib/discover-format.ts";
import type { DiscoverConstantsReport } from "../src/lib/discover-constants.ts";
import { parseConstantRange } from "../src/lib/discover-constants.ts";

const ROOT = join(import.meta.dir, "..");

function sampleConstantsReport(): DiscoverConstantsReport {
  const base = {
    type: "number" as const,
    range: parseConstantRange("≥ 1", "number"),
    sources: {},
    valid: true,
    validationIssues: [] as string[],
    usages: [] as string[],
    usageBreakdown: { src: [] as string[], test: [] as string[], scripts: [] as string[] },
    orphan: false,
    annotationsComplete: true,
    taxonomy: [],
    goldenDrift: false,
    seeResolved: [],
    literalDuplicateHits: [],
    suggestionMentions: [],
  };

  return {
    tuningSetVersion: "1.0.0",
    constantCount: 2,
    validCount: 2,
    invalidCount: 0,
    orphanCount: 1,
    annotationGapCount: 0,
    goldenDriftCount: 0,
    manifestStale: false,
    healthScore: 98,
    domains: [],
    alignment: { definesWithoutTypes: [], typesWithoutDefines: [] },
    constants: [
      { ...base, key: "KIMI_A", domain: "alpha", value: 1 },
      { ...base, key: "KIMI_B", domain: "beta", value: 2, orphan: true },
    ],
  };
}

describe("discover-cli", () => {
  it("should expose option specs for help generation", () => {
    expect(DISCOVER_CLI_SPECS.length).toBeGreaterThan(8);
    expect(DISCOVER_CLI_SPECS.some((spec) => spec.flags.includes("--deep"))).toBe(true);
  });

  it("should render help from the same option specs", () => {
    const help = formatDiscoverCliHelp("bun run discover");
    expect(help).toContain("Usage: bun run discover [options]");
    for (const spec of DISCOVER_CLI_SPECS) {
      expect(help).toContain(spec.description);
    }
    for (const spec of DISCOVER_CLI_META_SPECS) {
      expect(help).toContain(spec.description);
    }
    expect(help).toContain("--completion bash");
  });

  it("should parse completion requests", () => {
    expect(parseDiscoverEarlyRequest(["--completion", "bash"], ROOT)).toEqual({
      kind: "completion",
      shell: "bash",
    });
    expect(() => parseDiscoverEarlyRequest(["--completion", "fish"], ROOT)).toThrow(
      DiscoverCliError
    );
  });

  it("should emit bash and zsh completion scripts from specs", () => {
    const bash = formatDiscoverCliCompletion("bash", DISCOVER_CLI_SPECS);
    const zsh = formatDiscoverCliCompletion("zsh", DISCOVER_CLI_SPECS);
    expect(bash).toContain("complete -F _discover discover");
    expect(bash).toContain("--deep");
    expect(zsh).toContain("#compdef discover");
    expect(zsh).toContain("_discover_domains");
  });

  it("should list define domains for shell completion", async () => {
    const domains = await listDiscoverCompleteValues("domain", ROOT);
    expect(domains).toContain("effect-benchmark");
    expect(domains).toContain("governance");
  });

  it("should parse layer and filter flags", () => {
    const args = parseDiscoverCliArgs(
      ["--constants", "--domain", "effect-benchmark", "--orphans", "--no-usages"],
      ROOT
    );
    expect(args.layers).toBe("constants");
    expect(args.domain).toBe("effect-benchmark");
    expect(args.orphansOnly).toBe(true);
    expect(args.noUsages).toBe(true);
  });

  it("should reject unknown flags with a suggestion", () => {
    expect(() => parseDiscoverCliArgs(["--depp"], ROOT)).toThrow(DiscoverCliError);
    try {
      parseDiscoverCliArgs(["--depp"], ROOT);
    } catch (err) {
      expect(err).toBeInstanceOf(DiscoverCliError);
      expect((err as DiscoverCliError).message).toContain("did you mean --deep?");
      expect((err as DiscoverCliError).exitCode).toBe(2);
    }
  });

  it("should reject missing value flags", () => {
    expect(() => parseDiscoverCliArgs(["--domain"], ROOT)).toThrow(DiscoverCliError);
    try {
      parseDiscoverCliArgs(["--domain", "--deep"], ROOT);
    } catch (err) {
      expect((err as DiscoverCliError).message).toContain("--domain requires name");
    }
  });

  it("should reject constants filters with dx-only layer", () => {
    expect(() => parseDiscoverCliArgs(["--dx", "--domain", "runtime"], ROOT)).toThrow(
      DiscoverCliError
    );
  });

  it("should filter constants report by domain", () => {
    const filtered = filterConstantsReport(sampleConstantsReport(), { domain: "beta" });
    expect(filtered.constantCount).toBe(1);
    expect(filtered.constants[0]?.key).toBe("KIMI_B");
    expect(filtered.orphanCount).toBe(1);
  });

  it("should format constants-only output without unified prefixes", () => {
    const report = sampleConstantsReport();
    const lines = formatDiscoverOutput(
      {
        generatedAt: "2026-01-01T00:00:00.000Z",
        projectRoot: ROOT,
        layers: ["constants"],
        constants: report,
        crossLinks: [],
        unifiedGaps: [],
        health: { overall: 98, constants: 98, dx: 0 },
      },
      { deep: false, layers: "constants" }
    );
    expect(lines[0]).toMatch(/^health /);
    expect(lines.some((line) => line.includes("constants health"))).toBe(false);
    expect(lines.some((line) => line.includes("── Constants"))).toBe(true);
  });
});
