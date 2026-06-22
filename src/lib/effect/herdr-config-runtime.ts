/**
 * Herdr merged-config runtime boundary — Effect.runPromise is allowed here.
 */

import { Effect, Exit } from "effect";
import {
  DxConfigLive,
  getAgentContext,
  getMergedConfig,
  summarizeDxConfigCause,
  type DxConfigError,
  type DxConfigErrorSummary,
} from "./dx-config.ts";
import type { DxConfigDocument } from "../dx-config-merge.ts";
import type { AgentContext } from "../dx-config-agents.ts";

export async function runMergedHerdrConfig(
  projectRoot: string,
  home?: string
): Promise<Exit.Exit<DxConfigDocument, DxConfigError>> {
  return Effect.runPromiseExit(
    getMergedConfig(projectRoot).pipe(Effect.provide(DxConfigLive(home)))
  );
}

const EMPTY_AGENT_CONTEXT: AgentContext = {
  firstRead: [],
  bootstrap: [],
  prePush: [],
  handoff: [],
  avoid: [],
};

export async function runAgentContext(
  projectRoot: string
): Promise<{ agentContext: AgentContext; configErrors: DxConfigErrorSummary[] }> {
  const exit = await Effect.runPromiseExit(
    getAgentContext(projectRoot).pipe(Effect.provide(DxConfigLive()))
  );
  if (Exit.isSuccess(exit)) {
    return { agentContext: exit.value, configErrors: [] };
  }
  return {
    agentContext: EMPTY_AGENT_CONTEXT,
    configErrors: summarizeDxConfigCause(exit.cause),
  };
}
