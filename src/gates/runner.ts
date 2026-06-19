/**
 * Doctor gate dependency runner — topological execution and graph output.
 *
 * Distinct from `src/lib/gate-runner.ts` (CI shell gates: format, lint, tsc).
 */
import { type ArtifactDependencyQuery, ArtifactStore } from "../lib/artifact-store.ts";
import type {
  Gate,
  GateArtifact,
  GateArtifactListOptions,
  GateResult,
  GateRunOptions,
  GateStatus,
} from "./types.ts";
import { DEFAULT_GATE_ARTIFACT_LIMIT, GATE_LEVEL_PRUNE_MS } from "./types.ts";

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

export interface GatePlanEntry {
  name: string;
  description: string;
  dependsOn: string[];
}

export interface GateExecutionPlan {
  order: string[];
  gates: GatePlanEntry[];
}

/** Preview topological execution order without running gates. */
export function planGateExecution(gates: Gate[]): GateExecutionPlan {
  const order = topologicalSort(gates);
  return {
    order: order.map((g) => g.name),
    gates: order.map((g) => ({
      name: g.name,
      description: g.description,
      dependsOn: g.dependsOn ?? [],
    })),
  };
}

/**
 * Find `dependsOn` edges whose target gate is missing from the input array.
 * Callers should pass `resolveGateClosure(name).gates` (see `kimi-doctor --gate`).
 */
export function findMissingGateDependencies(gates: Gate[]): string[] {
  const names = new Set(gates.map((g) => g.name));
  const missing: string[] = [];
  for (const gate of gates) {
    for (const dep of gate.dependsOn ?? []) {
      if (!names.has(dep)) missing.push(`${gate.name} → ${dep}`);
    }
  }
  return missing;
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
  /** Invoked when a gate fails or is blocked by a failed dependency. */
  onFailure?: (result: GateRunResult) => void | Promise<void>;
}

async function applyGateRetention(store: ArtifactStore, gate: Gate): Promise<void> {
  const policy = gate.retentionPolicy;
  const maxAgeMs = policy?.maxAgeMs ?? GATE_LEVEL_PRUNE_MS[gate.level];
  await store.prune(gate.name, { maxAgeMs, level: gate.level });
  if (policy?.maxCount !== undefined && policy.maxCount > 0) {
    await store.pruneByCount(gate.name, { maxCount: policy.maxCount });
  }
}

function artifactPayload(result: GateResult): unknown {
  if (result.lineage) {
    const { artifactPath: _path, lineage, ...rest } = result;
    return { ...rest, lineage };
  }
  const { artifactPath: _path, ...rest } = result;
  return rest;
}

function buildGateContext(
  runResults: Map<string, GateResult>,
  store: ArtifactStore | null
): Required<Pick<GateRunOptions, "getArtifact" | "getArtifacts" | "readArtifact">> {
  const getArtifact = async (gateName: string): Promise<GateArtifact | null> => {
    const inRun = runResults.get(gateName);
    if (inRun) {
      return {
        gate: gateName,
        path: inRun.artifactPath,
        relativePath:
          inRun.artifactPath && store ? store.relativePath(inRun.artifactPath) : undefined,
        payload: artifactPayload(inRun),
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

  const getArtifacts = async (
    gateName: string,
    opts: GateArtifactListOptions = {}
  ): Promise<unknown[]> => {
    const limit =
      opts.limit !== undefined && Number.isFinite(opts.limit) && opts.limit > 0
        ? Math.floor(opts.limit)
        : DEFAULT_GATE_ARTIFACT_LIMIT;
    const payloads: unknown[] = [];
    const inRun = runResults.get(gateName);
    if (inRun) payloads.push(artifactPayload(inRun));
    if (payloads.length >= limit) return payloads.slice(0, limit);
    if (!store) return payloads.slice(0, limit);

    const inRunRelative =
      inRun?.artifactPath && store ? store.relativePath(inRun.artifactPath) : undefined;
    const listed = await store.listFiltered(gateName, {
      since: opts.since,
      limit,
    });
    for (const relativePath of listed.files.toReversed()) {
      if (relativePath === inRunRelative) continue;
      const envelope = await store.readEnvelope(relativePath);
      if (envelope) payloads.push(envelope.payload);
      if (payloads.length >= limit) break;
    }
    return payloads.slice(0, limit);
  };

  const readArtifact = async (artifactPath: string): Promise<unknown> => {
    if (!store) return null;
    const relativePath = artifactPath.startsWith(".kimi/")
      ? artifactPath
      : store.relativePath(artifactPath);
    const envelope = await store.readEnvelope(relativePath);
    return envelope?.payload ?? null;
  };

  return { getArtifact, getArtifacts, readArtifact };
}

async function resolveUpstreamArtifacts(
  deps: string[],
  runResults: Map<string, GateResult>,
  store: ArtifactStore | null
): Promise<string[]> {
  const upstreamArtifacts: string[] = [];
  for (const dep of deps) {
    const depResult = runResults.get(dep);
    if (depResult?.artifactPath) {
      upstreamArtifacts.push(
        store ? store.relativePath(depResult.artifactPath) : depResult.artifactPath
      );
      continue;
    }
    if (!store) continue;
    const latest = await store.getLatest(dep);
    if (latest?.relativePath) upstreamArtifacts.push(latest.relativePath);
  }
  return upstreamArtifacts;
}

function declarativeDependsOn(
  deps: string[],
  upstreamArtifacts: string[]
): ArtifactDependencyQuery[] {
  return deps.map((dep, index) => ({
    gate: dep,
    ...(upstreamArtifacts[index] ? { paths: [upstreamArtifacts[index]!] } : {}),
  }));
}

/** Persist gate output and attach traceable upstream paths for downstream gates. */
export async function persistGateArtifact(
  gate: Gate,
  result: GateResult,
  deps: string[],
  upstreamArtifacts: string[],
  store: ArtifactStore
): Promise<GateResult> {
  const dependsOn = declarativeDependsOn(deps, upstreamArtifacts);
  const artifactPath = await store.save(gate.name, artifactPayload(result), {
    level: gate.level,
    ...(dependsOn.length > 0 ? { dependsOn } : {}),
    ...(result.lineage ? { lineage: result.lineage } : {}),
  });
  return { ...result, artifactPath };
}

/** Run gates in dependency order, propagating failures. */
export async function runGatesWithDependencies(
  gates: Gate[],
  opts: DependencyRunnerOptions = {}
): Promise<DependencyRunOutcome> {
  const missingDeps = findMissingGateDependencies(gates);
  if (missingDeps.length > 0) {
    throw new Error(
      `Gate closure incomplete (missing dependencies in array): ${missingDeps.join(", ")}. ` +
        "Use resolveGateClosure(gateName).gates from registry.ts before calling runGatesWithDependencies."
    );
  }

  const order = topologicalSort(gates);
  const levels = groupGatesIntoExecutionLevels(gates);
  const runResults = new Map<string, GateResult>();
  const output: GateRunResult[] = [];
  const store = opts.projectRoot ? new ArtifactStore(opts.projectRoot) : null;
  const context = buildGateContext(runResults, store);
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
      getArtifact: context.getArtifact,
      getArtifacts: context.getArtifacts,
      readArtifact: context.readArtifact,
    });

    const upstreamArtifacts = await resolveUpstreamArtifacts(deps, runResults, store);
    if (deps.length > 0) {
      result.lineage = { dependencies: deps, upstreamArtifacts };
    }

    if (opts.saveArtifact && store) {
      result = await persistGateArtifact(gate, result, deps, upstreamArtifacts, store);
      await applyGateRetention(store, gate);
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
