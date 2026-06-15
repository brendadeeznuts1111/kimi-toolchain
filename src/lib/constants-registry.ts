/**
 * Effect ConstantsRegistry — live bunfig reads with test overrides.
 *
 * Compile-time `KIMI_*` globals still come from bunfig [define]; this registry
 * provides runtime/test access without leaking overrides outside Effect.provide.
 */

import { Context, Effect, Layer } from "effect";
import { existsSync } from "fs";
import { join } from "path";
import { loadRepoDefineMap, parseBuildConstantsTypes } from "./build-constants-registry.ts";

export type ConstantValue = string | number | boolean;

export interface ConstantSchema {
  type: "string" | "number" | "boolean";
  min?: number;
  max?: number;
  enum?: string[];
  integer?: boolean;
}

export interface ConstantValidationIssue {
  key: string;
  value: unknown;
  schema: ConstantSchema;
  reason: string;
}

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

function schemaType(type: string): ConstantSchema["type"] {
  if (type === "number" || type === "boolean" || type === "string") return type;
  return "string";
}

function schemaFromRestrictions(type: string, restrictions?: string): ConstantSchema {
  const schema: ConstantSchema = { type: schemaType(type) };
  const text = restrictions?.toLowerCase() ?? "";

  if (schema.type === "number") {
    if (text.includes("positive integer")) {
      schema.min = 1;
      schema.integer = true;
    } else if (text.includes("positive")) {
      schema.min = 0;
    }

    const range = text.match(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/);
    if (range) {
      schema.min = Number(range[1]);
      schema.max = Number(range[2]);
    }
  }

  const enumMatch = restrictions?.match(/(?:enum|one of):\s*([A-Za-z0-9_,\s.-]+)/i);
  if (enumMatch) {
    schema.enum = enumMatch[1]!
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return schema;
}

export async function loadConstantSchemas(
  projectRoot: string
): Promise<Map<string, ConstantSchema>> {
  const typesPath = join(projectRoot, "types", "build-constants.d.ts");
  if (!existsSync(typesPath)) return new Map();

  const types = parseBuildConstantsTypes(await Bun.file(typesPath).text());
  return new Map(
    [...types.entries()].map(([key, entry]) => [
      key,
      schemaFromRestrictions(entry.type, entry.restrictions),
    ])
  );
}

export function validateConstant(
  key: string,
  value: ConstantValue,
  schema: ConstantSchema | undefined
): ConstantValidationIssue | null {
  if (!schema) return null;
  if (typeof value !== schema.type) {
    return {
      key,
      value,
      schema,
      reason: `expected ${schema.type}, got ${typeof value}`,
    };
  }
  if (schema.type === "number") {
    const numeric = value as number;
    if (!Number.isFinite(numeric)) {
      return { key, value, schema, reason: "expected finite number" };
    }
    if (schema.integer && !Number.isInteger(numeric)) {
      return { key, value, schema, reason: "expected integer" };
    }
    if (schema.min !== undefined && numeric < schema.min) {
      return { key, value, schema, reason: `expected >= ${schema.min}` };
    }
    if (schema.max !== undefined && numeric > schema.max) {
      return { key, value, schema, reason: `expected <= ${schema.max}` };
    }
  }
  if (schema.enum && !schema.enum.includes(String(value))) {
    return { key, value, schema, reason: `expected one of ${schema.enum.join(", ")}` };
  }
  return null;
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
