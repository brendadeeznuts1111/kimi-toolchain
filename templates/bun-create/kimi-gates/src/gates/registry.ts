/**
 * Gate registry — discover, register, and resolve gate closures.
 */

import type { Gate } from "./types.ts";

const gates = new Map<string, Gate>();

export function registerGate(gate: Gate): void {
  gates.set(gate.name, gate);
}

export function getGate(name: string): Gate | undefined {
  return gates.get(name);
}

export function listGates(): string[] {
  return [...gates.keys()].sort();
}

/** Collect a gate and its transitive dependencies (dependency-first order). */
export function resolveGateClosure(name: string): { gates: Gate[]; missing: string[] } {
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
