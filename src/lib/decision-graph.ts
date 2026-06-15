/**
 * Decision DAG reconstruction from parent decision links and trace affinity.
 */

import { readDecisionLedger, type DecisionRecord } from "./decision-ledger.ts";

export interface DecisionGraphNode {
  decisionId: string;
  parentDecisionId?: string;
  childDecisionIds: string[];
  traceId?: string;
  timestamp: string;
  action: string;
  actor: string;
  clusterId?: string;
  qualityScore?: number;
  outcome: string;
}

export interface DecisionGraphEdge {
  from: string;
  to: string;
  type: "parent" | "trace";
}

export interface DecisionGraph {
  requested: string;
  found: boolean;
  rootDecisionIds: string[];
  nodes: DecisionGraphNode[];
  edges: DecisionGraphEdge[];
}

export async function buildDecisionGraph(
  traceIdOrDecisionId: string,
  records?: readonly DecisionRecord[]
): Promise<DecisionGraph> {
  const source = records ? [...records] : await readDecisionLedger();
  const byId = new Map(source.map((record) => [record.decisionId, record]));
  const seedById = byId.get(traceIdOrDecisionId);
  const seedByTrace = source.filter(
    (record) =>
      record.traceId === traceIdOrDecisionId || record.trigger.traceId === traceIdOrDecisionId
  );
  const seeds = seedById ? [seedById] : seedByTrace;
  if (seeds.length === 0) {
    return {
      requested: traceIdOrDecisionId,
      found: false,
      rootDecisionIds: [],
      nodes: [],
      edges: [],
    };
  }

  const included = new Set<string>();
  const queue = seeds.map((record) => record.decisionId);
  while (queue.length > 0) {
    const decisionId = queue.shift()!;
    if (included.has(decisionId)) continue;
    included.add(decisionId);
    const record = byId.get(decisionId);
    if (!record) continue;
    if (record.parentDecisionId && !included.has(record.parentDecisionId)) {
      queue.push(record.parentDecisionId);
    }
    for (const child of source) {
      if (child.parentDecisionId === decisionId && !included.has(child.decisionId)) {
        queue.push(child.decisionId);
      }
    }
  }

  const traceIds = new Set<string>();
  for (const decisionId of included) {
    const record = byId.get(decisionId);
    if (!record) continue;
    if (record.traceId) traceIds.add(record.traceId);
    if (record.trigger.traceId) traceIds.add(record.trigger.traceId);
  }
  for (const record of source) {
    const traceId = record.traceId ?? record.trigger.traceId;
    if (traceId && traceIds.has(traceId)) included.add(record.decisionId);
  }

  const filtered = source
    .filter((record) => included.has(record.decisionId))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const edges: DecisionGraphEdge[] = [];
  for (const record of filtered) {
    if (record.parentDecisionId && included.has(record.parentDecisionId)) {
      edges.push({ from: record.parentDecisionId, to: record.decisionId, type: "parent" });
    }
  }

  const byTrace = new Map<string, DecisionRecord[]>();
  for (const record of filtered) {
    const traceId = record.traceId ?? record.trigger.traceId;
    if (!traceId) continue;
    const group = byTrace.get(traceId) ?? [];
    group.push(record);
    byTrace.set(traceId, group);
  }
  for (const group of byTrace.values()) {
    group.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    for (let index = 1; index < group.length; index++) {
      const from = group[index - 1]!.decisionId;
      const to = group[index]!.decisionId;
      if (!edges.some((edge) => edge.from === from && edge.to === to)) {
        edges.push({ from, to, type: "trace" });
      }
    }
  }

  const incoming = new Map<string, number>();
  for (const record of filtered) incoming.set(record.decisionId, 0);
  for (const edge of edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const rootDecisionIds = filtered
    .map((record) => record.decisionId)
    .filter((decisionId) => (incoming.get(decisionId) ?? 0) === 0);

  const childrenByParent = new Map<string, string[]>();
  for (const edge of edges.filter((edge) => edge.type === "parent")) {
    const children = childrenByParent.get(edge.from) ?? [];
    children.push(edge.to);
    childrenByParent.set(edge.from, children);
  }
  for (const [decisionId, children] of childrenByParent) {
    childrenByParent.set(
      decisionId,
      [...new Set(children)].sort((left, right) => {
        const leftRecord = byId.get(left);
        const rightRecord = byId.get(right);
        return (leftRecord?.timestamp ?? "").localeCompare(rightRecord?.timestamp ?? "");
      })
    );
  }

  const nodes: DecisionGraphNode[] = filtered.map((record) => ({
    decisionId: record.decisionId,
    parentDecisionId: record.parentDecisionId,
    childDecisionIds: childrenByParent.get(record.decisionId) ?? [],
    traceId: record.traceId ?? record.trigger.traceId,
    timestamp: record.timestamp,
    action: record.action,
    actor: record.actor,
    clusterId: record.clusterId,
    qualityScore: record.qualityScore,
    outcome: record.outcome.result,
  }));

  return {
    requested: traceIdOrDecisionId,
    found: true,
    rootDecisionIds,
    nodes,
    edges,
  };
}

export function renderDecisionGraphAscii(graph: DecisionGraph): string {
  if (!graph.found) return `decision graph ${graph.requested} not found`;
  const byId = new Map(graph.nodes.map((node) => [node.decisionId, node]));
  const byParent = new Map<string, string[]>();
  for (const edge of graph.edges.filter((edge) => edge.type === "parent")) {
    const children = byParent.get(edge.from) ?? [];
    children.push(edge.to);
    byParent.set(edge.from, children);
  }

  const lines: string[] = [`decision graph for ${graph.requested}`];
  const seen = new Set<string>();
  const roots =
    graph.rootDecisionIds.length > 0 ? graph.rootDecisionIds : graph.nodes.map((n) => n.decisionId);
  const walk = (decisionId: string, prefix: string) => {
    const node = byId.get(decisionId);
    if (!node) return;
    const score = node.qualityScore === undefined ? "" : ` score=${node.qualityScore.toFixed(2)}`;
    const cluster = node.clusterId ? ` cluster=${node.clusterId}` : "";
    const trace = node.traceId ? ` trace=${node.traceId}` : "";
    if (seen.has(decisionId)) {
      lines.push(`${prefix}↩ ${decisionId}`);
      return;
    }
    seen.add(decisionId);
    lines.push(`${prefix}${decisionId} ${node.action} [${node.outcome}]${cluster}${score}${trace}`);
    const children = (byParent.get(decisionId) ?? []).sort();
    children.forEach((child, index) => {
      const connector = index === children.length - 1 ? "└─ " : "├─ ";
      walk(child, `${prefix}${connector}`);
    });
  };

  roots.sort().forEach((root) => walk(root, ""));
  const traceEdges = graph.edges.filter((edge) => edge.type === "trace");
  if (traceEdges.length > 0) {
    lines.push("trace-links:");
    for (const edge of traceEdges) {
      lines.push(`  ${edge.from} -> ${edge.to}`);
    }
  }
  return lines.join("\n");
}
