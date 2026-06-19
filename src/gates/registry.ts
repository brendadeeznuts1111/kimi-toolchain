/**
 * Built-in doctor gate registry and dependency closure resolution.
 *
 * `resolveGateClosure(name)` returns transitive `dependsOn` in execution order.
 * CLI passes `closure.gates` to `runGatesWithDependencies` — no GraphNode adapter.
 */
import type { Gate } from "./types.ts";
import { topologicalSort } from "./runner.ts";
import { bunfigPolicyGateDefinition } from "./bunfig-policy.ts";
import { cardProbeGateDefinition } from "./card-probe.ts";
import { modelDriftGateDefinition } from "./model-drift.ts";
import { perfGateDefinition } from "./perf-gate.ts";
import { strategyPerformanceGateDefinition } from "./strategy-performance.ts";
import { tlsComplianceGateDefinition } from "./tls-compliance.ts";
import { emailI18nGateDefinition } from "./email-i18n.ts";
import { urlI18nGateDefinition } from "./url-i18n.ts";

const gates = new Map<string, Gate>();

/** Built-in gate definitions — extend by adding modules and entries here. */
export function listBuiltinGateDefinitions(): Gate[] {
  return [
    bunfigPolicyGateDefinition,
    perfGateDefinition,
    tlsComplianceGateDefinition,
    urlI18nGateDefinition,
    emailI18nGateDefinition,
    cardProbeGateDefinition,
    strategyPerformanceGateDefinition,
    modelDriftGateDefinition,
  ];
}

export function registerGate(gate: Gate): void {
  gates.set(gate.name, gate);
}

export function getGate(name: string): Gate | undefined {
  ensureDiscovered();
  return gates.get(name);
}

export function listGates(): string[] {
  ensureDiscovered();
  return [...gates.keys()].sort();
}

/** Collect a gate and its transitive dependencies (dependency-first order). */
export function resolveGateClosure(name: string): { gates: Gate[]; missing: string[] } {
  ensureDiscovered();
  const missing: string[] = [];
  const order: Gate[] = [];
  const seen = new Set<string>();

  function visit(gateName: string): void {
    if (seen.has(gateName)) return;
    const gate = gates.get(gateName);
    if (!gate) {
      if (!missing.includes(gateName)) missing.push(gateName);
      return;
    }
    for (const dep of gate.dependsOn ?? []) {
      visit(dep);
    }
    seen.add(gateName);
    order.push(gate);
  }

  visit(name);
  return { gates: order, missing };
}

/**
 * Expand an input gate array with registry definitions for missing `dependsOn` targets.
 * Input gates take precedence over built-ins with the same name.
 */
export function autoResolveGateDependencies(inputGates: Gate[]): {
  gates: Gate[];
  autoResolved: string[];
} {
  ensureDiscovered();
  const inputByName = new Map(inputGates.map((gate) => [gate.name, gate]));
  const autoResolved: string[] = [];
  const order: Gate[] = [];
  const seen = new Set<string>();

  function visit(gateName: string): void {
    if (seen.has(gateName)) return;

    const gate = inputByName.get(gateName) ?? gates.get(gateName);
    if (!gate) return;

    for (const dep of gate.dependsOn ?? []) {
      visit(dep);
    }

    seen.add(gateName);
    order.push(gate);

    if (!inputByName.has(gateName)) {
      autoResolved.push(gateName);
    }
  }

  for (const inputGate of inputGates) {
    visit(inputGate.name);
  }

  return { gates: order, autoResolved };
}

export const gateRegistry = {
  get: getGate,
  list: listGates,
  register: registerGate,
};

let discovered = false;

/** Idempotent — registers all built-in gates once. */
export function discoverGates(): void {
  for (const gate of listBuiltinGateDefinitions()) {
    if (!gates.has(gate.name)) registerGate(gate);
  }
  discovered = true;
}

function ensureDiscovered(): void {
  if (!discovered) discoverGates();
}

discoverGates();
