import { pathExists, readText } from "./bun-io.ts";

import { join } from "path";
import { TOML } from "bun";
import { Data, Schema } from "effect";

export type FinishWorkGateSource = "finishWork" | "agents.prePush" | "default";

export interface FinishWorkFollowUp {
  command: string;
}

export interface FinishWorkConfig {
  gates: string[];
  source: FinishWorkGateSource;
  followUp: FinishWorkFollowUp | null;
}

/** Canonical Effect discipline gate — same in scaffold templates and live dx.config.toml. */
export const EFFECT_GATES_COMMAND = "kimi-doctor --effect-gates";

/**
 * Herdr dashboard /api/meta discovery contract (requires dashboard server up).
 * Opt-in hard remote-host reachability: `kimi-doctor --dashboard-meta --strict`
 */
export const DASHBOARD_META_COMMAND = "kimi-doctor --dashboard-meta";

/**
 * Self-contained Herdr dashboard WebView smoke + /api/thumbnail probe.
 * Custom URL: `kimi-doctor --automation --url http://127.0.0.1:18412/`
 */
export const DASHBOARD_AUTOMATION_COMMAND = "kimi-doctor --automation";

const DEFAULT_GATES = ["bun run check:fast", EFFECT_GATES_COMMAND];

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));

export const FinishWorkDxConfigSchema = Schema.Struct({
  finishWork: Schema.optional(
    Schema.Struct({
      gates: Schema.optional(Schema.Array(NonEmptyString)),
      followUp: Schema.optional(
        Schema.Struct({
          command: NonEmptyString,
        })
      ),
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

export function decodeFinishWorkDxConfig(
  doc: unknown,
  path = "dx.config.toml"
): FinishWorkDxConfig {
  try {
    return Schema.decodeUnknownSync(FinishWorkDxConfigSchema)(doc);
  } catch (cause) {
    throw new FinishWorkConfigParseError({
      path,
      message: cause instanceof Error ? cause.message : Bun.inspect(cause),
    });
  }
}

function nonEmptyStrings(values: readonly string[] | undefined): string[] {
  return values?.filter((item) => item.length > 0) ?? [];
}

function resolveFollowUp(finishWork: FinishWorkDxConfig["finishWork"]): FinishWorkFollowUp | null {
  const command = finishWork?.followUp?.command?.trim();
  return command ? { command } : null;
}

export function resolveFinishWorkConfig(decoded: FinishWorkDxConfig): FinishWorkConfig {
  const finishGates = nonEmptyStrings(decoded.finishWork?.gates);
  if (finishGates.length > 0) {
    return {
      gates: finishGates,
      source: "finishWork",
      followUp: resolveFollowUp(decoded.finishWork),
    };
  }

  const prePush = nonEmptyStrings(decoded.agents?.prePush);
  if (prePush.length > 0) {
    return { gates: prePush, source: "agents.prePush", followUp: null };
  }

  return { gates: DEFAULT_GATES, source: "default", followUp: null };
}

/** @deprecated Use resolveFinishWorkConfig */
export function resolveFinishWorkGates(decoded: FinishWorkDxConfig): FinishWorkConfig {
  return resolveFinishWorkConfig(decoded);
}

export function resolveFinishWorkConfigFromUnknown(
  doc: unknown,
  path = "dx.config.toml"
): FinishWorkConfig {
  return resolveFinishWorkConfig(decodeFinishWorkDxConfig(doc, path));
}

/** @deprecated Use resolveFinishWorkConfigFromUnknown */
export function resolveFinishWorkGatesFromUnknown(
  doc: unknown,
  path = "dx.config.toml"
): FinishWorkConfig {
  return resolveFinishWorkConfigFromUnknown(doc, path);
}

export function loadFinishWorkConfig(projectRoot: string): FinishWorkConfig {
  const path = join(projectRoot, "dx.config.toml");
  if (!pathExists(path)) {
    return { gates: DEFAULT_GATES, source: "default", followUp: null };
  }

  let doc: unknown;
  try {
    doc = TOML.parse(readText(path));
  } catch (cause) {
    throw new FinishWorkConfigParseError({
      path,
      message: cause instanceof Error ? cause.message : Bun.inspect(cause),
    });
  }

  return resolveFinishWorkConfigFromUnknown(doc, path);
}
