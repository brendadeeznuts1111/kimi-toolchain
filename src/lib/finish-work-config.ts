import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TOML } from "bun";
import { Data, Schema } from "effect";

export type FinishWorkGateSource = "finishWork" | "agents.prePush" | "default";

export interface FinishWorkConfig {
  gates: string[];
  source: FinishWorkGateSource;
}

/** Canonical Effect discipline gate — same in scaffold templates and live dx.config.toml. */
export const EFFECT_GATES_COMMAND = "kimi-doctor --effect-gates";

const DEFAULT_GATES = ["bun run check:fast", EFFECT_GATES_COMMAND];

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));

export const FinishWorkDxConfigSchema = Schema.Struct({
  finishWork: Schema.optional(
    Schema.Struct({
      gates: Schema.optional(Schema.Array(NonEmptyString)),
    })
  ),
  agents: Schema.optional(
    Schema.Struct({
      prePush: Schema.optional(Schema.Array(NonEmptyString)),
    })
  ),
});

export type FinishWorkDxConfig = Schema.Schema.Type<typeof FinishWorkDxConfigSchema>;

export class FinishWorkConfigParseError extends Data.TaggedError("FinishWorkConfigParseError")<{
  path: string;
  message: string;
}> {}

export function decodeFinishWorkDxConfig(doc: unknown): FinishWorkDxConfig {
  try {
    return Schema.decodeUnknownSync(FinishWorkDxConfigSchema)(doc);
  } catch (cause) {
    throw new FinishWorkConfigParseError({
      path: "dx.config.toml",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function nonEmptyStrings(values: readonly string[] | undefined): string[] {
  return values?.filter((item) => item.length > 0) ?? [];
}

export function resolveFinishWorkGates(decoded: FinishWorkDxConfig): FinishWorkConfig {
  const finishGates = nonEmptyStrings(decoded.finishWork?.gates);
  if (finishGates.length > 0) {
    return { gates: finishGates, source: "finishWork" };
  }

  const prePush = nonEmptyStrings(decoded.agents?.prePush);
  if (prePush.length > 0) {
    return { gates: prePush, source: "agents.prePush" };
  }

  return { gates: DEFAULT_GATES, source: "default" };
}

export function resolveFinishWorkGatesFromUnknown(doc: unknown): FinishWorkConfig {
  return resolveFinishWorkGates(decodeFinishWorkDxConfig(doc));
}

export function loadFinishWorkConfig(projectRoot: string): FinishWorkConfig {
  const path = join(projectRoot, "dx.config.toml");
  if (!existsSync(path)) {
    return { gates: DEFAULT_GATES, source: "default" };
  }

  let doc: unknown;
  try {
    doc = TOML.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new FinishWorkConfigParseError({
      path,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }

  return resolveFinishWorkGatesFromUnknown(doc);
}
