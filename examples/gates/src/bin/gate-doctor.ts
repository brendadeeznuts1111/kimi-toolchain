#!/usr/bin/env bun
/**
 * gate-doctor — CLI runner for the gate tree.
 *
 * Usage:
 *   bun run src/bin/gate-doctor.ts --all --save-artifact
 *   bun run src/bin/gate-doctor.ts --gate strategy-check --save-artifact
 *   bun run src/bin/gate-doctor.ts --all --gate-graph
 *   bun run src/bin/gate-doctor.ts --status --json
 *   bun run src/bin/gate-doctor.ts --all --dry-run
 */

import {
  getGate,
  listGates,
  resolveGateClosure,
  autoResolveGateDependencies,
} from "../gates/registry.ts";
import type { Gate } from "../gates/types.ts";
import { runGatesWithDependencies, generateGateGraph, formatGateResults } from "../gates/runner.ts";
import { ArtifactStore } from "../lib/artifact-store.ts";
import "../gates/init.ts";

const args = Bun.argv.slice(2);

const all = args.includes("--all");
const gateFlag = args.indexOf("--gate");
const gateName = gateFlag >= 0 ? args[gateFlag + 1] : undefined;
const saveArtifact = args.includes("--save-artifact");
const gateGraph = args.includes("--gate-graph");
const status = args.includes("--status");
const json = args.includes("--json");
const dryRun = args.includes("--dry-run");
const failFast = args.includes("--fail-fast");

const projectRoot = process.cwd();
const artifactsDir = `${projectRoot}/var/artifacts`;

// ── Status ──────────────────────────────────────────────────────────

if (status) {
  const store = new ArtifactStore(artifactsDir);
  const gates = listGates();
  const summary = await Promise.all(
    gates.map(async (gate) => {
      const count = await store.count(gate);
      const latest = count > 0 ? await store.latest(gate) : null;
      return {
        gate,
        count,
        latest: latest ? latest.savedAt : null,
      };
    })
  );
  const payload = { ok: true, artifactsDir, summary };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Artifacts: ${artifactsDir}\n`);
    console.log(Bun.inspect.table(summary, { colors: true }));
  }
  process.exit(0);
}

// ─-- Gate graph ────────────────────────────────────────────────────

if (gateGraph) {
  const gateNames = listGates();
  if (gateNames.length === 0) {
    console.error("No gates registered.");
    process.exit(1);
  }
  const seeds = all
    ? gateNames.map(getGate).filter((g): g is Gate => g !== undefined)
    : [getGate(gateName ?? gateNames[0])].filter((g): g is Gate => g !== undefined);
  const resolved = autoResolveGateDependencies(seeds);
  const mermaid = generateGateGraph(resolved.gates);
  if (json) {
    console.log(JSON.stringify({ mermaid }, null, 2));
  } else {
    console.log(mermaid);
  }
  process.exit(0);
}

// ── Run gates ───────────────────────────────────────────────────────

let closure: { gates: Gate[]; missing: string[] };
if (all) {
  const seeds = listGates()
    .map(getGate)
    .filter((g): g is Gate => g !== undefined);
  const resolved = autoResolveGateDependencies(seeds);
  closure = { gates: resolved.gates, missing: resolved.missing };
} else {
  const targetGate = gateName;
  if (!targetGate) {
    console.error(
      "Usage: gate-doctor --all | --gate <name> [--save-artifact] [--gate-graph] [--status] [--json] [--dry-run] [--fail-fast]"
    );
    process.exit(1);
  }
  closure = resolveGateClosure(targetGate);
}
if (closure.missing.length > 0) {
  console.error(`Missing gates: ${closure.missing.join(", ")}`);
  process.exit(1);
}

if (dryRun) {
  const plan = closure.gates.map((g) => ({
    name: g.name,
    level: g.level,
    dependsOn: g.dependsOn ?? [],
    parallel: g.parallel ?? false,
  }));
  if (json) {
    console.log(JSON.stringify({ gates: plan }, null, 2));
  } else {
    console.log("Execution plan (dependency-first):");
    for (const g of plan) {
      const level = g.level === 1 ? "L1" : g.level === 2 ? "L2" : "L3";
      const deps = g.dependsOn.length > 0 ? ` ← ${g.dependsOn.join(", ")}` : "";
      console.log(`  ${g.name} (${level})${deps}${g.parallel ? " [parallel]" : ""}`);
    }
  }
  process.exit(0);
}

const outcome = await runGatesWithDependencies(closure.gates, {
  projectRoot,
  saveArtifact,
  failFast,
  onFailure: (run) => {
    if (!json) console.error(`${run.gate}: ${run.status} — ${run.reason ?? ""}`);
  },
});

if (json) {
  console.log(JSON.stringify(outcome, null, 2));
} else {
  console.log(formatGateResults(outcome.results));
  console.log(`\nOrder: ${outcome.order.join(" → ")}`);
  if (outcome.graphArtifactPath) {
    console.log(`Graph saved: ${outcome.graphArtifactPath}`);
  }
}

const failed = outcome.results.filter((r) => r.status === "fail" || r.status === "blocked");
process.exit(failed.length > 0 ? 1 : 0);
