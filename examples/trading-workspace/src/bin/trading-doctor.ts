#!/usr/bin/env bun
/**
 * Trading artifact loop — run L1/L2 gates with dependency order and lineage.
 *
 * Usage:
 *   bun run src/bin/trading-doctor.ts --all --save-artifact
 *   bun run src/bin/trading-doctor.ts --gate model-drift --save-artifact
 *   bun run src/bin/trading-doctor.ts --gate model-drift --gate-graph
 *   bun run src/bin/trading-doctor.ts --gate model-drift --gate-graph --json
 */

import { join } from "path";
import {
  discoverGates,
  listBuiltinGateDefinitions,
  resolveGateClosure,
} from "../trading/gates/registry.ts";
import {
  formatGateResults,
  generateGateGraph,
  runGatesWithDependencies,
} from "../trading/gates/runner.ts";

const argv = Bun.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const SAVE_ARTIFACT = argv.includes("--save-artifact");
const GATE_GRAPH = argv.includes("--gate-graph") || argv.includes("--graph");
const RUN_ALL = argv.includes("--all");
const STATUS = argv.includes("--status");

const PROJECT_ROOT = join(import.meta.dir, "../..");

function parseGate(): string | null {
  const idx = argv.indexOf("--gate");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1]!;
  const flag = argv.find((a) => a.startsWith("--gate="));
  if (flag) return flag.slice("--gate=".length);
  return null;
}

function emitJson(payload: unknown): void {
  console.log(JSON.stringify(payload));
}

async function main(): Promise<number> {
  discoverGates();
  const gateName = parseGate();

  if (STATUS) {
    const repoRoot = PROJECT_ROOT.includes("kimi-toolchain")
      ? PROJECT_ROOT.split("kimi-toolchain")[0] + "kimi-toolchain"
      : PROJECT_ROOT;
    const { probeTradingWorkspace } = await import("../../../../src/lib/examples-showcase.ts");
    const probe = probeTradingWorkspace(repoRoot);
    if (JSON_OUT) {
      emitJson({
        schemaVersion: 1,
        tool: "trading-doctor",
        mode: "status",
        projectRoot: PROJECT_ROOT,
        ...probe,
      });
    } else {
      console.log(`trading-workspace: ${probe.gateCount} gates · ${probe.artifactCount} artifacts`);
      for (const row of probe.gates) {
        console.log(`  ${row.gate}: ${row.count}${row.latest ? ` (latest ${row.latest})` : ""}`);
      }
      if (probe.lastRunId) console.log(`  last run: ${probe.lastRunId}`);
    }
    return probe.ok ? 0 : 1;
  }

  if (GATE_GRAPH) {
    const target = gateName ?? "model-drift";
    const closure = resolveGateClosure(target);
    if (closure.missing.length > 0) {
      console.error(`Unknown gate dependencies: ${closure.missing.join(", ")}`);
      return 1;
    }
    const mermaid = generateGateGraph(closure.gates);
    if (JSON_OUT) {
      emitJson({
        schemaVersion: 1,
        tool: "trading-doctor",
        mode: "gate-graph",
        gate: target,
        projectRoot: PROJECT_ROOT,
        gates: closure.gates.map((g) => ({
          name: g.name,
          dependsOn: g.dependsOn ?? [],
        })),
        mermaid,
      });
    } else {
      console.log(mermaid);
    }
    return 0;
  }

  const gates = RUN_ALL
    ? listBuiltinGateDefinitions()
    : gateName
      ? resolveGateClosure(gateName).gates
      : null;

  if (!gates || gates.length === 0) {
    console.error(
      "Usage: trading-doctor --all | --gate <name> [--save-artifact] [--gate-graph] [--json]"
    );
    return 1;
  }

  if (gateName && !RUN_ALL) {
    const closure = resolveGateClosure(gateName);
    if (closure.missing.length > 0) {
      console.error(`Unknown gate: ${closure.missing.join(", ")}`);
      return 1;
    }
  }

  const { results, order, graphArtifactPath } = await runGatesWithDependencies(gates, {
    projectRoot: PROJECT_ROOT,
    saveArtifact: SAVE_ARTIFACT,
    failFast: false,
  });

  const failed = results.some((r) => r.status === "fail" || r.status === "blocked");

  if (JSON_OUT) {
    emitJson({
      schemaVersion: 1,
      tool: "trading-doctor",
      mode: "gate-run",
      projectRoot: PROJECT_ROOT,
      order,
      results,
      graphArtifactPath,
      saveArtifact: SAVE_ARTIFACT,
    });
    return failed ? 1 : 0;
  }

  for (const entry of results) {
    const gate = gates.find((g) => g.name === entry.gate);
    if (gate?.format && entry.detail) {
      for (const line of gate.format(entry.detail)) console.log(line);
    } else {
      console.log(`${entry.status}: ${entry.gate}${entry.reason ? ` — ${entry.reason}` : ""}`);
    }
    if (entry.artifactPath) console.log(`       └─ artifact: ${entry.artifactPath}`);
  }

  console.log(formatGateResults(results));
  if (graphArtifactPath) console.log(`gate-graph → ${graphArtifactPath}`);

  return failed ? 1 : 0;
}

if (import.meta.main) {
  const code = await main();
  process.exit(code);
}
