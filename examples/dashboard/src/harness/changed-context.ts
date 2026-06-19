import { join } from "path";
import {
  listChangedFiles,
  resolveChangedContext,
} from "../../../../src/lib/check-changed.ts";
import type { CheckOptions } from "../../../../src/lib/check-types.ts";

/** Kimi-toolchain monorepo root (parent of examples/dashboard). */
export const TOOLCHAIN_ROOT = join(import.meta.dir, "../../../..");

export async function resolvePerfChangedFiles(options: {
  changedOnly: boolean;
  base: string;
  baseExplicit?: boolean;
}): Promise<string[]> {
  if (!options.changedOnly) return [];

  const checkOpts: CheckOptions = {
    dryRun: false,
    fast: true,
    staged: false,
    verbose: false,
    timeoutMs: 0,
    changedOnly: true,
    base: options.base,
    baseExplicit: options.baseExplicit ?? false,
    failFast: false,
    jsonSummary: false,
    skipTests: false,
    watch: false,
    watchTests: false,
    cacheResults: false,
    noCache: true,
  };

  const ctx = await resolveChangedContext(TOOLCHAIN_ROOT, checkOpts);
  return ctx.changedFiles ?? [];
}

export { listChangedFiles, TOOLCHAIN_ROOT as perfRepoRoot };