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
  runHardcodedSecretsGate,
  hardcodedSecretsGateDefinition,
  type HardcodedSecretsGateResult,
  formatHardcodedSecretsGate,
} from "./hardcoded-secrets.ts";
export {
  runTlsComplianceGate,
  tlsComplianceGateDefinition,
  type TlsComplianceDoctorResult,
} from "./tls-compliance.ts";
export { runUrlI18nGate, urlI18nGateDefinition, type UrlI18nGateResult } from "./url-i18n.ts";
export {
  runEmailI18nGate,
  emailI18nGateDefinition,
  type EmailI18nGateResult,
} from "./email-i18n.ts";
export {
  runCardProbeGate,
  cardProbeGateDefinition,
  type CardProbeGateResult,
} from "./card-probe.ts";
export {
  runStrategyPerformanceGate,
  strategyPerformanceGateDefinition,
  type StrategyPerformanceResult,
} from "./strategy-performance.ts";
export {
  runModelDriftGate,
  modelDriftGateDefinition,
  type ModelDriftResult,
} from "./model-drift.ts";
export { computeNormalizedDrift, readPerformanceValue } from "./trading-metrics.ts";

/**
 * Gate lookup uses the dynamic registry in `registry.ts` — not keyed exports here.
 * CLI: `getGate(name)` or `gateRegistry.get(name)`.
 */
export {
  autoResolveGateDependencies,
  discoverGates,
  gateRegistry,
  getGate,
  listBuiltinGateDefinitions,
  listGates,
  registerGate,
  resolveGateClosure,
  type AutoResolveGateDependenciesResult,
} from "./registry.ts";

export {
  detectCycle,
  findMissingGateDependencies,
  formatGateResults,
  generateGateGraph,
  groupGatesIntoExecutionLevels,
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
