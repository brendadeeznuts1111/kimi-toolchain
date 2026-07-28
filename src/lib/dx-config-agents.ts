/**
 * [agents] slice from a merged DX config document.
 */

import type { DxConfigDocument } from "./dx-config-merge.ts";

export interface SubagentEntry {
  readonly toolPath: string;
  readonly args?: string[];
  readonly timeoutMs?: number;
  readonly env?: Record<string, string | undefined>;
  readonly label?: string;
}

export interface AgentContext {
  readonly firstRead: string[];
  readonly bootstrap: string[];
  readonly iterate?: string;
  readonly fullValidation?: string;
  readonly prePush: string[];
  readonly handoff: string[];
  readonly avoid: string[];
  readonly skills?: Record<string, unknown>;
  readonly subagents?: Record<string, SubagentEntry>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value.map((s) => (s as string).trim())
    : [];
}

function readAgents(document: DxConfigDocument): Record<string, unknown> | null {
  return document.agents && typeof document.agents === "object"
    ? (document.agents as Record<string, unknown>)
    : null;
}

function readSubagentEntry(value: unknown): SubagentEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  const toolPath = readString(obj.toolPath);
  if (!toolPath) return undefined;

  const args = readStringArray(obj.args);
  const timeoutMs = typeof obj.timeoutMs === "number" ? obj.timeoutMs : undefined;
  const label = readString(obj.label);

  let env: Record<string, string | undefined> | undefined;
  if (obj.env && typeof obj.env === "object" && !Array.isArray(obj.env)) {
    env = {};
    for (const [k, v] of Object.entries(obj.env)) {
      env[k] = typeof v === "string" ? v : undefined;
    }
  }

  return { toolPath, args: args.length > 0 ? args : undefined, timeoutMs, env, label };
}

function readSubagents(value: unknown): Record<string, SubagentEntry> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const obj = value as Record<string, unknown>;
  const out: Record<string, SubagentEntry> = {};
  for (const [key, val] of Object.entries(obj)) {
    const entry = readSubagentEntry(val);
    if (entry) out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Extract the full agent context from `[agents]`. */
export function getAgentContext(document: DxConfigDocument): AgentContext {
  const agents = readAgents(document) ?? {};
  const skills =
    agents.skills && typeof agents.skills === "object" && !Array.isArray(agents.skills)
      ? (agents.skills as Record<string, unknown>)
      : undefined;

  return {
    firstRead: readStringArray(agents.firstRead),
    bootstrap: readStringArray(agents.bootstrap),
    iterate: readString(agents.iterate),
    fullValidation: readString(agents.fullValidation),
    prePush: readStringArray(agents.prePush),
    handoff: readStringArray(agents.handoff),
    avoid: readStringArray(agents.avoid),
    skills,
    subagents: readSubagents(agents.subagents),
  };
}

/** Extract suggested next-step commands from `[agents]` (iterate, handoff, prePush). */
export function extractAgentsNextSteps(document: DxConfigDocument): string[] {
  const agents = readAgents(document);
  if (!agents) return [];

  const steps: string[] = [];
  if (typeof agents.iterate === "string" && agents.iterate.trim()) {
    steps.push(agents.iterate.trim());
  }
  if (Array.isArray(agents.handoff)) {
    for (const row of agents.handoff) {
      if (typeof row === "string" && row.trim()) steps.push(row.trim());
    }
  }
  if (Array.isArray(agents.prePush)) {
    for (const row of agents.prePush.slice(0, 2)) {
      if (typeof row === "string" && row.trim()) steps.push(row.trim());
    }
  }
  return [...new Set(steps)];
}
