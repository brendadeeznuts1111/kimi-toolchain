/**
 * Template-driven rationale generation for the decision ledger.
 */

import { Effect } from "effect";

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
  evidence: DecisionEvidence[];
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

export function buildDecisionRationale(context: RationaleBuildContext): DecisionRationaleBlock {
  switch (context.kind) {
    case "heal":
      return buildHealRationale(context);
    case "contract-sign":
      return buildContractRationale(context);
    case "capability-degrade":
      return buildCapabilityRationale(context);
    case "generic":
      return buildGenericRationale(context);
  }
}

export function buildDecisionRationaleEffect(
  context: RationaleBuildContext
): Effect.Effect<DecisionRationaleBlock> {
  return Effect.sync(() => buildDecisionRationale(context));
}

function buildHealRationale(context: HealRationaleContext): DecisionRationaleBlock {
  const priorCount = context.priorSuccessCount ?? 0;
  const priorIds = context.priorDecisionIds ?? [];
  const priorText =
    priorCount > 0
      ? `, and this playbook resolved the same cluster successfully ${priorCount} time(s) before${
          priorIds.length > 0 ? ` (${priorIds.join(", ")})` : ""
        }`
      : "";
  const summary = `Applied playbook ${context.playbookTitle} for cluster ${context.topTaxonomy}.`;
  const fullReasoning =
    `Applied playbook \`${context.playbookTitle}\` because error cluster \`${context.topTaxonomy}\` ` +
    `(${context.clusterId}) had ${context.clusterSize} occurrence(s) in trace \`${context.traceId}\`${priorText}.`;
  const evidence: DecisionEvidence[] = [
    { type: "cluster", clusterId: context.clusterId, detail: context.topTaxonomy },
    { type: "traceStep", traceId: context.traceId, stepIndex: 0 },
  ];
  if (priorIds.length > 0) {
    evidence.push({
      type: "playbook",
      playbookTitle: context.playbookTitle,
      detail: `prior decisions: ${priorIds.join(", ")}`,
    });
  }
  return { summary, fullReasoning, evidence };
}

function buildContractRationale(context: ContractRationaleContext): DecisionRationaleBlock {
  const drift =
    context.driftSummary ??
    (context.oldHash && context.newHash
      ? `drift detected between ${context.oldHash.slice(0, 12)} and ${context.newHash.slice(0, 12)}`
      : "contract content changed");
  const summary = `Re-signed contract ${context.contractFile}.`;
  const fullReasoning =
    `Contract \`${context.contractFile}\` was re-signed because ${drift}. ` +
    "Consumers should treat the update as a non-breaking shape extension unless validation fails.";
  const evidence: DecisionEvidence[] = [
    { type: "contractDiff", contractFile: context.contractFile },
  ];
  if (context.oldHash) evidence[0].oldHash = context.oldHash;
  if (context.newHash) evidence[0].newHash = context.newHash;
  return { summary, fullReasoning, evidence };
}

function buildCapabilityRationale(context: CapabilityRationaleContext): DecisionRationaleBlock {
  const impact = context.impactSummary ?? "No immediate impact on local workflows.";
  const summary = `Degraded capability ${context.capabilityItem}.`;
  const fullReasoning = `Service \`${context.capabilityItem}\` was downgraded because ${context.reason}. ${impact}`;
  return {
    summary,
    fullReasoning,
    evidence: [
      { type: "capability", capabilityItem: context.capabilityItem, detail: context.reason },
    ],
  };
}

function buildGenericRationale(context: GenericRationaleContext): DecisionRationaleBlock {
  return {
    summary: context.summary,
    fullReasoning: context.fullReasoning ?? context.summary,
    evidence: context.evidence ?? [],
  };
}
