import type { Gate } from "./types.ts";
import { bunfigPolicyGateDefinition } from "./bunfig-policy.ts";

const gates = new Map<string, Gate>();

/** Built-in gate definitions — extended by importing additional gate modules. */
export function listBuiltinGateDefinitions(): Gate[] {
  return [bunfigPolicyGateDefinition];
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