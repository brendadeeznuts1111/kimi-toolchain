/**
 * Herdr merged-config runtime boundary — Effect.runPromise is allowed here.
 */

import { Effect, Exit } from "effect";
import { DxConfigLive, getAgentContext, getMergedConfig, type DxConfigError } from "./dx-config.ts";
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

export async function runAgentContext(
  projectRoot: string
): Promise<Exit.Exit<AgentContext, DxConfigError>> {
  return Effect.runPromiseExit(getAgentContext(projectRoot).pipe(Effect.provide(DxConfigLive())));
}
