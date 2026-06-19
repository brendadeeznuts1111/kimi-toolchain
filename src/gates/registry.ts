import type { Gate } from "./types.ts";
import { bunfigPolicyGateDefinition } from "./bunfig-policy.ts";
import { cardProbeGateDefinition } from "./card-probe.ts";
import { perfGateDefinition } from "./perf-gate.ts";
import { tlsComplianceGateDefinition } from "./tls-compliance.ts";

const gates = new Map<string, Gate>();

/** Built-in gate definitions — extend by adding modules and entries here. */
export function listBuiltinGateDefinitions(): Gate[] {
  return [
    bunfigPolicyGateDefinition,
    perfGateDefinition,
    tlsComplianceGateDefinition,
    cardProbeGateDefinition,
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
