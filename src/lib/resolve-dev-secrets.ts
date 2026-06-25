/**
 * resolve-dev-secrets.ts — Resolve policy secrets before spawning child processes.
 */
import { Effect } from "effect";
import { secretsPolicyPath } from "./paths.ts";
import { getAllPolicyEntries, loadSecretsPolicy } from "./secrets-policy.ts";
import { readSecretFromEnv, secretEnvCandidates } from "./secrets-env.ts";
import { allowsEnvFallback } from "./secrets-storage.ts";
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
const resolveCache = new Map<string, Effect.Effect<Effect.Effect<Record<string, boolean>>>>();

function resolveRootEffect(projectRoot?: string): Effect.Effect<string, Error> {
  if (projectRoot) return Effect.succeed(projectRoot);
  return Effect.tryPromise({
    try: () => resolveProjectRoot(Bun.cwd),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
}

async function applyEnvFallbackPolicy(root: string): Promise<void> {
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
}

export function resolveDevSecretsProgram(
  projectRoot: string
): Effect.Effect<Record<string, boolean>> {
  return Effect.gen(function* () {
    const rows = yield* new SecretsManager({ projectRoot, onWarn: () => {} }).list();
    const status: Record<string, boolean> = {};
    for (const row of rows) status[`${row.key.service}/${row.key.name}`] = row.present;

    yield* Effect.tryPromise({
      try: () => applyEnvFallbackPolicy(projectRoot),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }).pipe(Effect.catchAll(() => Effect.void));

    return status;
  });
}

function cachedResolveProgram(root: string): Effect.Effect<Record<string, boolean>> {
  let wrapped = resolveCache.get(root);
  if (!wrapped) {
    wrapped = Effect.cached(resolveDevSecretsProgram(root));
    resolveCache.set(root, wrapped);
  }
  return Effect.flatten(wrapped);
}

export function resolveDevSecrets(
  projectRoot?: string
): Effect.Effect<Record<string, boolean>, Error> {
  return Effect.gen(function* () {
    const root = yield* resolveRootEffect(projectRoot);
    return yield* resolveDevSecretsProgram(root);
  });
}

export function ensureDevSecretsResolved(projectRoot?: string): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const root = yield* resolveRootEffect(projectRoot);
    yield* cachedResolveProgram(root);
  });
}

export function resetDevSecretsResolveCache(projectRoot?: string): void {
  if (projectRoot !== undefined) {
    resolveCache.delete(projectRoot);
  } else {
    resolveCache.clear();
  }
}
