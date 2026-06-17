/**
 * Effect service for DX config resolution.
 *
 * Other domains depend on this service instead of reading TOML directly.
 */

import { join } from "path";
import { Context, Effect, Layer } from "effect";
import { homeDir } from "../paths.ts";
import {
  getAgentContext,
  loadConfigFile,
  mergeConfigs,
  type AgentContext,
  type DxConfigDocument,
  type DxConfigMergeOptions,
} from "../dx-config.ts";
import { ConfigReadError } from "../dx-config-errors.ts";

export interface DxConfigService {
  readonly loadGlobal: () => Effect.Effect<Record<string, unknown>, ConfigReadError>;
  readonly loadProject: (
    projectRoot: string
  ) => Effect.Effect<Record<string, unknown>, ConfigReadError>;
  readonly loadMerged: (projectRoot: string) => Effect.Effect<DxConfigDocument, ConfigReadError>;
  readonly loadAgentContext: (projectRoot: string) => Effect.Effect<AgentContext, ConfigReadError>;
}

export class DxConfigResolver extends Context.Tag("DxConfigResolver")<
  DxConfigResolver,
  DxConfigService
>() {}

export const DEFAULT_MERGE_OPTIONS: DxConfigMergeOptions = {
  policies: [
    { path: "endpoints", policy: "mergeByName" },
    { path: "agents.firstRead", policy: "appendUnique" },
    { path: "agents.avoid", policy: "appendUnique" },
  ],
  defaultArrayPolicy: "replace",
};

const GLOBAL_CONFIG_PATH = join(homeDir(), ".config", "dx", "global-config.toml");

function globalConfigPath(): string {
  return Bun.env.DX_GLOBAL_CONFIG ?? GLOBAL_CONFIG_PATH;
}

function projectConfigPath(projectRoot: string): string {
  return join(projectRoot, "dx.config.toml");
}

function loadMergedEffect(projectRoot: string): Effect.Effect<DxConfigDocument, ConfigReadError> {
  return Effect.gen(function* () {
    const globalRaw = yield* Effect.catchAll(loadConfigFile(globalConfigPath()), (err) =>
      err.reason === "not_found" ? Effect.succeed({} as Record<string, unknown>) : Effect.fail(err)
    );
    const projectRaw = yield* loadConfigFile(projectConfigPath(projectRoot));
    return mergeConfigs(globalRaw, projectRaw, DEFAULT_MERGE_OPTIONS);
  });
}

export const DxConfigResolverLive = Layer.succeed(DxConfigResolver, {
  loadGlobal: () => loadConfigFile(globalConfigPath()),
  loadProject: (projectRoot) => loadConfigFile(projectConfigPath(projectRoot)),
  loadMerged: (projectRoot) => loadMergedEffect(projectRoot),
  loadAgentContext: (projectRoot) => Effect.map(loadMergedEffect(projectRoot), getAgentContext),
});
