/**
 * Doctor gate dependency runner — topological execution and graph output.
 *
 * Distinct from `src/lib/gate-runner.ts` (CI shell gates: format, lint, tsc).
 */
import { ArtifactStore } from "../lib/artifact-store.ts";
import type { Gate, GateArtifact, GateResult, GateRunOptions, GateStatus } from "./types.ts";

export interface GateRunResult {
  gate: string;
  status: GateStatus | "blocked";
  reason?: string;
  dependsOn: string[];
  artifactPath?: string;
  /** Full gate payload for formatters and JSON consumers. */
  detail?: GateResult;
}

export interface DependencyRunOutcome {
  results: GateRunResult[];
  order: string[];
  graphArtifactPath?: string;
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

/** Cycle detection via Tarjan SCC. Returns gate names in cycles, or empty. */
export function detectCycle(gates: Gate[]): string[] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let time = 0;
  const cycles: string[][] = [];

  function strongconnect(name: string): void {
    index.set(name, time);
    lowlink.set(name, time);
    time++;
    stack.push(name);
    onStack.add(name);

    const gate = gates.find((g) => g.name === name);
    for (const dep of gate?.dependsOn ?? []) {
      if (!index.has(dep)) {
        strongconnect(dep);
        lowlink.set(name, Math.min(lowlink.get(name)!, lowlink.get(dep)!));
      } else if (onStack.has(dep)) {
        lowlink.set(name, Math.min(lowlink.get(name)!, index.get(dep)!));
      }
    }

    if (lowlink.get(name) === index.get(name)) {
      const cycle: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        cycle.push(w);
      } while (w !== name);
      if (cycle.length > 1) cycles.push(cycle);
    }
  }

  for (const gate of gates) {
    if (!index.has(gate.name)) strongconnect(gate.name);
  }

  return cycles.flat();
}

export interface DependencyRunnerOptions extends GateRunOptions {
  /** Stop after the first blocked or failed gate. */
  failFast?: boolean;
}

function buildGetArtifact(
  runResults: Map<string, GateResult>,
  store: ArtifactStore | null
): (gateName: string) => Promise<GateArtifact | null> {
  return async (gateName: string): Promise<GateArtifact | null> => {
    const inRun = runResults.get(gateName);
    if (inRun) {
      return {
        gate: gateName,
        path: inRun.artifactPath,
        relativePath:
          inRun.artifactPath && store ? store.relativePath(inRun.artifactPath) : undefined,
        payload: inRun,
      };
    }
    if (!store) return null;
    const latest = await store.getLatest(gateName);
    if (!latest) return null;
    return {
      gate: gateName,
      path: latest.path,
      relativePath: latest.relativePath,
      payload: latest.payload,
    };
  };
}

/** Run gates in dependency order, propagating failures. */
export async function runGatesWithDependencies(
  gates: Gate[],
  opts: DependencyRunnerOptions = {}
): Promise<DependencyRunOutcome> {
  const order = topologicalSort(gates);
  const runResults = new Map<string, GateResult>();
  const output: GateRunResult[] = [];
  const store = opts.projectRoot ? new ArtifactStore(opts.projectRoot) : null;
  const getArtifact = buildGetArtifact(runResults, store);

  for (const gate of order) {
    const deps = gate.dependsOn ?? [];

    const failedDeps = deps.filter((dep) => runResults.get(dep)?.status === "fail");
    if (failedDeps.length > 0) {
      output.push({
        gate: gate.name,
        status: "blocked",
        reason: `blocked by: ${failedDeps.join(", ")}`,
        dependsOn: deps,
      });
      if (opts.failFast) break;
      continue;
    }

    const result = await gate.run({
      projectRoot: opts.projectRoot,
      saveArtifact: opts.saveArtifact,
      getArtifact,
    });
    runResults.set(gate.name, result);

    output.push({
      gate: gate.name,
      status: result.status,
      reason: result.reason,
      dependsOn: deps,
      artifactPath: result.artifactPath,
      detail: result,
    });

    if (opts.failFast && result.status === "fail") break;
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

  return {
    results: output,
    order: order.map((g) => g.name),
    graphArtifactPath,
  };
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

/** Format gate run results as a Bun.inspect.table-friendly array. */
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
