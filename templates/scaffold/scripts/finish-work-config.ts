import { pathExists, readText } from "./lib/bun-io.ts";
import { join } from "node:path";
import { TOML } from "bun";

export type FinishWorkGateSource = "finishWork" | "agents.prePush" | "default";

export interface FinishWorkFollowUp {
  command: string;
}

export interface FinishWorkConfig {
  gates: string[];
  source: FinishWorkGateSource;
  followUp: FinishWorkFollowUp | null;
}

/** Slim scaffold copy — no Effect dep; live repo validates via Effect Schema in src/lib/finish-work-config.ts */
/** Canonical Effect discipline gate — matches live finish-work-config.ts / dx.config.toml. */
const EFFECT_GATES_COMMAND = "kimi-doctor --effect-gates";

const DEFAULT_GATES = ["bun run check:fast", EFFECT_GATES_COMMAND];

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function resolveFollowUp(finishWork: Record<string, unknown> | null): FinishWorkFollowUp | null {
  const followUp =
    finishWork?.followUp && typeof finishWork.followUp === "object"
      ? (finishWork.followUp as Record<string, unknown>)
      : null;
  const command = typeof followUp?.command === "string" ? followUp.command.trim() : "";
  return command ? { command } : null;
}

export function resolveFinishWorkGates(doc: Record<string, unknown>): FinishWorkConfig {
  const finishWork =
    doc.finishWork && typeof doc.finishWork === "object"
      ? (doc.finishWork as Record<string, unknown>)
      : null;
  const finishGates = stringArray(finishWork?.gates);
  if (finishGates.length) {
    return {
      gates: finishGates,
      source: "finishWork",
      followUp: resolveFollowUp(finishWork),
    };
  }

  const agents =
    doc.agents && typeof doc.agents === "object" ? (doc.agents as Record<string, unknown>) : null;
  const prePush = stringArray(agents?.prePush);
  if (prePush.length) {
    return { gates: prePush, source: "agents.prePush", followUp: null };
  }

  return { gates: DEFAULT_GATES, source: "default", followUp: null };
}

export function loadFinishWorkConfig(projectRoot: string): FinishWorkConfig {
  const path = join(projectRoot, "dx.config.toml");
  if (!pathExists(path)) {
    return { gates: DEFAULT_GATES, source: "default", followUp: null };
  }
  const doc = TOML.parse(readText(path)) as Record<string, unknown>;
  return resolveFinishWorkGates(doc);
}
