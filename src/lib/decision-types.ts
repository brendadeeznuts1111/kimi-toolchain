/**
 * Shared decision-ledger and rationale type definitions.
 *
 * Kept in a dedicated module so decision-rationale.ts and decision-ledger.ts can
 * share types without creating a circular import.
 */

export type AlternativeFeasibility = "low" | "medium" | "high";

export interface DecisionEvidence {
  type: "traceStep" | "error" | "contractDiff" | "cluster" | "playbook" | "capability";
  traceId?: string;
  stepIndex?: number;
  errorId?: string;
  oldHash?: string;
  newHash?: string;
  clusterId?: string;
  playbookTitle?: string;
  contractFile?: string;
  capabilityItem?: string;
  detail?: string;
}

export interface DecisionRationaleBlock {
  summary: string;
  fullReasoning: string;
  evidence?: DecisionEvidence[];
}

export type RationaleKind = "heal" | "contract-sign" | "capability-degrade" | "generic";

export interface HealRationaleContext {
  kind: "heal";
  playbookTitle: string;
  clusterId: string;
  clusterSize: number;
  topTaxonomy: string;
  traceId: string;
  priorSuccessCount?: number;
  priorDecisionIds?: string[];
}

export interface ContractRationaleContext {
  kind: "contract-sign";
  contractFile: string;
  driftSummary?: string;
  oldHash?: string;
  newHash?: string;
}

export interface CapabilityRationaleContext {
  kind: "capability-degrade";
  capabilityItem: string;
  reason: string;
  impactSummary?: string;
}

export interface GenericRationaleContext {
  kind: "generic";
  summary: string;
  fullReasoning?: string;
  evidence?: DecisionEvidence[];
}

export type RationaleBuildContext =
  | HealRationaleContext
  | ContractRationaleContext
  | CapabilityRationaleContext
  | GenericRationaleContext;
