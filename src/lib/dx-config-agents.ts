/**
 * [agents] slice from a merged DX config document.
 */

import type { DxConfigDocument } from "./dx-config-merge.ts";

/** Extract suggested next-step commands from `[agents]` (iterate, handoff, prePush). */
export function extractAgentsNextSteps(document: DxConfigDocument): string[] {
  const agents =
    document.agents && typeof document.agents === "object"
      ? (document.agents as Record<string, unknown>)
      : null;
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
