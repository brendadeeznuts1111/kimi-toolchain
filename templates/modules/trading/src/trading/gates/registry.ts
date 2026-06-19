import type { Gate } from "./types.ts";
import { dataFreshnessGateDefinition } from "./data-freshness.ts";
import { modelDriftGateDefinition } from "./model-drift.ts";
import { riskLimitsGateDefinition } from "./risk-limits.ts";
import { strategyPerformanceGateDefinition } from "./strategy-performance.ts";

const gates = new Map<string, Gate>();

/** Built-in trading gate definitions for the artifact feedback loop. */
export function listBuiltinGateDefinitions(): Gate[] {
  return [
    dataFreshnessGateDefinition,
    riskLimitsGateDefinition,
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

let discovered = false;

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
