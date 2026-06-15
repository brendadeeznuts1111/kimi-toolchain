/**
 * Effect ConstantsRegistry — live bunfig reads with test overrides.
 *
 * Compile-time `KIMI_*` globals still come from bunfig [define]; this registry
 * provides runtime/test access without leaking overrides outside Effect.provide.
 */

import { Context, Effect, Layer } from "effect";
import { loadRepoDefineMap } from "./build-constants-registry.ts";

export type ConstantValue = string | number | boolean;

export interface ConstantsRegistryService {
  readonly get: (key: string) => Effect.Effect<ConstantValue | undefined>;
  readonly getAll: () => Effect.Effect<Record<string, ConstantValue>>;
  readonly has: (key: string) => Effect.Effect<boolean>;
}

export class ConstantsRegistry extends Context.Tag("@kimi/ConstantsRegistry")<
  ConstantsRegistry,
  ConstantsRegistryService
>() {}

function serviceFromValues(values: Record<string, ConstantValue>): ConstantsRegistryService {
  return {
    get: (key) => Effect.succeed(values[key]),
    getAll: () => Effect.succeed({ ...values }),
    has: (key) => Effect.succeed(Object.hasOwn(values, key)),
  };
}

async function loadLiveValues(projectRoot: string): Promise<Record<string, ConstantValue>> {
  const map = await loadRepoDefineMap(projectRoot);
  return Object.fromEntries([...map.entries()].map(([key, entry]) => [key, entry.value]));
}

/** Live layer — reads current bunfig.toml [define] values at layer construction. */
export function ConstantsRegistryLive(projectRoot: string) {
  return Layer.effect(
    ConstantsRegistry,
    Effect.promise(async () => serviceFromValues(await loadLiveValues(projectRoot)))
  );
}

/** Test layer — merges overrides atop live bunfig values (overrides win). */
export function TestConstants(projectRoot: string, overrides: Record<string, ConstantValue> = {}) {
  return Layer.effect(
    ConstantsRegistry,
    Effect.promise(async () => {
      const base = await loadLiveValues(projectRoot);
      return serviceFromValues({ ...base, ...overrides });
    })
  );
}

/** Read a constant through the registry (defaults to live bunfig-backed layer). */
export function getConstant(
  key: string,
  projectRoot: string
): Effect.Effect<ConstantValue | undefined, never, ConstantsRegistry> {
  return Effect.gen(function* () {
    const registry = yield* ConstantsRegistry;
    return yield* registry.get(key);
  }).pipe(Effect.provide(ConstantsRegistryLive(projectRoot)));
}
