export {
  bunfigPolicyGate,
  runBunfigPolicyGate,
  formatBunfigPolicyGate,
  bunfigPolicyGateDefinition,
  type BunfigPolicyGateResult,
  type BunfigPolicyGateStatus,
  type BunfigPolicyGateSummary,
} from "./bunfig-policy.ts";

export type {
  Gate,
  GateArtifactListOptions,
  GateContext,
  GateResult,
  GateRunOptions,
  GateStatus,
} from "./types.ts";

export { runPerfGate, perfGateDefinition, type PerfGateDoctorResult } from "./perf-gate.ts";
export {
  runTlsComplianceGate,
  tlsComplianceGateDefinition,
  type TlsComplianceDoctorResult,
} from "./tls-compliance.ts";
export {
  runCardProbeGate,
  cardProbeGateDefinition,
  type CardProbeGateResult,
} from "./card-probe.ts";

/**
 * Gate lookup uses the dynamic registry in `registry.ts` — not keyed exports here.
 * CLI: `getGate(name)` or `gateRegistry.get(name)`.
 */
export {
  discoverGates,
  gateRegistry,
  getGate,
  listBuiltinGateDefinitions,
  listGates,
  registerGate,
  resolveGateClosure,
} from "./registry.ts";

export {
  detectCycle,
  findMissingGateDependencies,
  formatGateResults,
  generateGateGraph,
  planGateExecution,
  persistGateArtifact,
  runGatesWithDependencies,
  topologicalSort,
  type DependencyRunOutcome,
  type DependencyRunnerOptions,
  type GateExecutionPlan,
  type GatePlanEntry,
  type GateRunResult,
} from "./runner.ts";

export type { GateArtifact } from "./types.ts";
