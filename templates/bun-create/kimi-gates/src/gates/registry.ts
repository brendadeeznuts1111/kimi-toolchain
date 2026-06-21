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

export interface AutoResolveGateDependenciesResult {
  gates: Gate[];
  missing: string[];
  autoResolved: string[];
}

/**
 * Expand seed gates with missing `dependsOn` targets from `lookup` (default `getGate`).
 * Seed gate objects are preserved when names match registry entries.
 */
export function autoResolveGateDependencies(
  seeds: Gate[],
  lookup: (name: string) => Gate | undefined = getGate
): AutoResolveGateDependenciesResult {
  const byName = new Map<string, Gate>();
  const seedNames = new Set(seeds.map((g) => g.name));
  const missing: string[] = [];
  const autoResolved: string[] = [];
  const queue: string[] = [];

  for (const gate of seeds) {
    byName.set(gate.name, gate);
    queue.push(gate.name);
  }

  while (queue.length > 0) {
    const name = queue.shift()!;
    const gate = byName.get(name);
    if (!gate) continue;
    for (const dep of gate.dependsOn ?? []) {
      if (byName.has(dep)) continue;
      const resolved = lookup(dep);
      if (!resolved) {
        if (!missing.includes(dep)) missing.push(dep);
        continue;
      }
      byName.set(dep, resolved);
      if (!seedNames.has(dep) && !autoResolved.includes(dep)) {
        autoResolved.push(dep);
      }
      queue.push(dep);
    }
  }

  const order: Gate[] = [];
  const seen = new Set<string>();

  function visit(gateName: string): void {
    if (seen.has(gateName)) return;
    const gate = byName.get(gateName);
    if (!gate) return;
    for (const dep of gate.dependsOn ?? []) {
      if (byName.has(dep)) visit(dep);
    }
    seen.add(gateName);
    order.push(gate);
  }

  for (const gate of seeds) {
    visit(gate.name);
  }
  for (const gateName of byName.keys()) {
    visit(gateName);
  }

  return {
    gates: order,
    missing,
    autoResolved,
  };
}
