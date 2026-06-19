/**
 * Gate registration — import all gate definitions and register them.
 *
 * Import this module before calling `getGate()` or `resolveGateClosure()`.
 */

import { registerGate } from "./registry.ts";
import { healthCheckGateDefinition } from "./health-check.ts";
import { dataFreshnessGateDefinition } from "./data-freshness.ts";
import { strategyCheckGateDefinition } from "./strategy-check.ts";

export function initGates(): void {
  registerGate(healthCheckGateDefinition);
  registerGate(dataFreshnessGateDefinition);
  registerGate(strategyCheckGateDefinition);
}

initGates();
