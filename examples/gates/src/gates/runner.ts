/**
 * Doctor gate dependency runner — topological execution and graph output.
 */

import type { Gate, GateResult, GateRunOptions } from "./types.ts";
import { ArtifactStore } from "../lib/artifact-store.ts";

export interface GateRunResult {
  gate: string;
  status: string;
  reason?: string;
  dependsOn: string[];
  artifactPath?: string;
  detail?: GateResult;
}

export interface DependencyRunOutcome {
  results: GateRunResult[];
  order: string[];
  graphArtifactPath?: string;
}

export interface DependencyRunnerOptions extends GateRunOptions {
  /** Stop after the first blocked or failed gate. */
  failFast?: boolean;
  /** Invoked when a gate fails or is blocked by a failed dependency. */
  onFailure?: (result: GateRunResult) => void | Promise<void>;
}

/** Topological sort (Kahn's algorithm). Returns gates in execution order. */
export function topologicalSort(gates: Gate[]): Gate[] {
  const index = new Map<string, Gate>();
  const inDegree = new Map<string, number>();
  for (const gate of gates) {
    index.set(gate.name, gate);
    inDegree.set(gate.name, 0);
  }
  for (const gate of gates) {
    for (const dep of gate.dependsOn ?? []) {
      if (index.has(dep)) {
        inDegree.set(gate.name, (inDegree.get(gate.name) ?? 0) + 1);
      }
    }
  }

  const queue: Gate[] = [];
  for (const gate of gates) {
    if ((inDegree.get(gate.name) ?? 0) === 0) queue.push(gate);
  }

  const sorted: Gate[] = [];
  while (queue.length > 0) {
    const gate = queue.shift()!;
    sorted.push(gate);
    for (const other of gates) {
      if ((other.dependsOn ?? []).includes(gate.name)) {
        const deg = (inDegree.get(other.name) ?? 1) - 1;
        inDegree.set(other.name, deg);
        if (deg === 0) queue.push(other);
      }
    }
  }

  for (const gate of gates) {
    if (!sorted.includes(gate)) sorted.push(gate);
  }

  return sorted;
}

/** Group gates into topological levels (same depth → same wave). */
export function groupGatesIntoExecutionLevels(gates: Gate[]): Gate[][] {
  const index = new Map(gates.map((gate) => [gate.name, gate]));
  const memo = new Map<string, number>();

  function depth(name: string, visiting = new Set<string>()): number {
    const cached = memo.get(name);
    if (cached !== undefined) return cached;
    if (visiting.has(name)) return 0;
    visiting.add(name);
    const gate = index.get(name);
    const deps = gate?.dependsOn ?? [];
    const level =
      deps.length === 0
        ? 0
        : 1 + Math.max(...deps.map((dep) => (index.has(dep) ? depth(dep, visiting) : 0)));
    visiting.delete(name);
    memo.set(name, level);
    return level;
  }

  const levels: Gate[][] = [];
  for (const gate of topologicalSort(gates)) {
    const level = depth(gate.name);
    if (!levels[level]) levels[level] = [];
    levels[level].push(gate);
  }
  return levels;
}

/** Generate a Mermaid graph from gate definitions. */
export function generateGateGraph(gates: Gate[]): string {
  const lines = ["graph TD"];
  for (const gate of gates) {
    const deps = gate.dependsOn ?? [];
    if (deps.length === 0) {
      lines.push(`  ${gate.name}[${gate.name}]`);
    }
    for (const dep of deps) {
      lines.push(`  ${dep}[${dep}] --> ${gate.name}[${gate.name}]`);
    }
  }
  return lines.join("\n");
}

/** Format gate run results as a table. */
export function formatGateResults(results: GateRunResult[]): string {
  const icon = (s: string) =>
    s === "pass" ? "✓" : s === "warn" ? "!" : s === "blocked" ? "⊘" : "✗";
  const rows = results.map((r) => ({
    gate: r.gate,
    status: `${icon(r.status)} ${r.status}`,
    reason: r.reason ?? (r.status === "pass" ? "" : "—"),
  }));
  return Bun.inspect.table(rows, { colors: true });
}

/** Run gates in dependency order, propagating failures. */
export async function runGatesWithDependencies(
  gates: Gate[],
  opts: DependencyRunnerOptions = {}
): Promise<DependencyRunOutcome> {
  const order = topologicalSort(gates);
  const levels = groupGatesIntoExecutionLevels(gates);
  const runResults = new Map<string, GateResult>();
  const output: GateRunResult[] = [];
  const store = opts.projectRoot ? new ArtifactStore(`${opts.projectRoot}/var/artifacts`) : null;
  let stopEarly = false;

  async function notifyFailure(run: GateRunResult): Promise<void> {
    if (opts.onFailure && (run.status === "fail" || run.status === "blocked")) {
      await opts.onFailure(run);
    }
  }

  async function executeGate(gate: Gate): Promise<void> {
    const deps = gate.dependsOn ?? [];
    const failedDeps = deps.filter((dep) => runResults.get(dep)?.status === "fail");
    if (failedDeps.length > 0) {
      const blocked: GateRunResult = {
        gate: gate.name,
        status: "blocked",
        reason: `blocked by: ${failedDeps.join(", ")}`,
        dependsOn: deps,
      };
      output.push(blocked);
      await notifyFailure(blocked);
      if (opts.failFast) stopEarly = true;
      return;
    }

    let result = await gate.run({
      projectRoot: opts.projectRoot,
      saveArtifact: false,
    });

    if (opts.saveArtifact && store) {
      const artifactPath = await store.save(gate.name, result, gate.level);
      result = { ...result, artifactPath };
    }

    runResults.set(gate.name, result);
    const run: GateRunResult = {
      gate: gate.name,
      status: result.status,
      reason: result.reason,
      dependsOn: deps,
      artifactPath: result.artifactPath,
      detail: result,
    };
    output.push(run);

    if (result.status === "fail") await notifyFailure(run);
    if (opts.failFast && result.status === "fail") stopEarly = true;
  }

  for (const level of levels) {
    if (stopEarly) break;
    const sequential = level.filter((gate) => gate.parallel !== true);
    const parallel = level.filter((gate) => gate.parallel === true);

    for (const gate of sequential) {
      await executeGate(gate);
      if (stopEarly) break;
    }
    if (stopEarly) break;

    if (parallel.length > 0) {
      await Promise.all(parallel.map((gate) => executeGate(gate)));
    }
  }

  let graphArtifactPath: string | undefined;
  if (opts.saveArtifact && store && gates.length > 1) {
    const mermaid = generateGateGraph(gates);
    graphArtifactPath = await store.save("gate-graph", {
      schemaVersion: 1,
      mode: "gate-graph",
      order: order.map((g) => g.name),
      results: output,
      mermaid,
      timestamp: new Date().toISOString(),
    });
  }

  return { results: output, order: order.map((g) => g.name), graphArtifactPath };
}
