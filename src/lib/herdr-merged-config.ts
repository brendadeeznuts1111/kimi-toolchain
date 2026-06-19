/**
 * Load merged DX project documents for Herdr orchestration (global + project).
 */

import { TOML } from "bun";
import { Effect, Exit } from "effect";
import { readText } from "./bun-io.ts";
import type { DxConfigDocument } from "./dx-config-merge.ts";
import { DxConfigLive, getMergedConfig } from "./effect/dx-config.ts";

function loadHerdrDocFromPath(configPath: string | null): Record<string, unknown> | null {
  if (!configPath) return null;
  try {
    return TOML.parse(readText(configPath)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Merged project document; falls back to single-file parse when merge fails. */
export async function loadMergedHerdrDocument(
  projectRoot: string,
  fallbackPath: string | null,
  home?: string
): Promise<DxConfigDocument | Record<string, unknown> | null> {
  const exit = await Effect.runPromiseExit(
    getMergedConfig(projectRoot).pipe(Effect.provide(DxConfigLive(home)))
  );
  if (Exit.isSuccess(exit)) return exit.value;
  return loadHerdrDocFromPath(fallbackPath);
}

/** Layer stack entry for Herdr programs that depend on merged DX config. */
export { DxConfigLive as mergedHerdrConfigLayer };
