/**
 * resolve-dev-secrets.ts — Resolve policy secrets before spawning child processes.
 */
import { secretsPolicyPath } from "./paths.ts";
import { getAllPolicyEntries, loadSecretsPolicy } from "./secrets-policy.ts";
import { readSecretFromEnv, secretEnvCandidates } from "./secrets-env.ts";
import { allowsEnvFallback } from "./secrets-storage.ts";
import { Effect } from "effect";
import { SecretsManager } from "./secrets-manager.ts";
import { resolveProjectRoot } from "./utils.ts";

/**
 * Per-project-root memoization. The previous single-slot `resolveOnce` cache
 * returned the wrong result when `ensureDevSecretsResolved()` was called with
 * different `projectRoot` values in the same process (e.g. tests, or a
 * long-lived guardian watching multiple projects). Keying by the resolved root
 * preserves the memoization benefit while avoiding cross-project contamination.
 *
 * `resetDevSecretsResolveCache(root?)` drops a specific root's entry (or all
 * entries when called with no argument) so tests can isolate between cases.
 */
const resolveCache = new Map<string, Promise<Record<string, boolean>>>();

export async function resolveDevSecrets(projectRoot?: string): Promise<Record<string, boolean>> {
  const root = projectRoot ?? (await resolveProjectRoot(Bun.cwd));
  const manager = new SecretsManager({ projectRoot: root, onWarn: () => {} });
  const rows = await Effect.runPromise(manager.list());
  const status: Record<string, boolean> = {};
  for (const row of rows) status[`${row.key.service}/${row.key.name}`] = row.present;

  try {
    const policy = await loadSecretsPolicy(secretsPolicyPath(root));
    for (const { service, name, entry } of getAllPolicyEntries(policy)) {
      if (!allowsEnvFallback(entry)) continue;
      const value = readSecretFromEnv(service, name);
      if (!value) continue;
      for (const envKey of secretEnvCandidates(service, name)) {
        if (!Bun.env[envKey]?.trim()) Bun.env[envKey] = value;
      }
    }
  } catch {
    // no policy — probe only
  }
  return status;
}

export async function ensureDevSecretsResolved(projectRoot?: string): Promise<void> {
  const root = projectRoot ?? (await resolveProjectRoot(Bun.cwd));
  let pending = resolveCache.get(root);
  if (!pending) {
    pending = resolveDevSecrets(root);
    resolveCache.set(root, pending);
  }
  await pending;
}

export function resetDevSecretsResolveCache(projectRoot?: string): void {
  if (projectRoot !== undefined) {
    resolveCache.delete(projectRoot);
  } else {
    resolveCache.clear();
  }
}
