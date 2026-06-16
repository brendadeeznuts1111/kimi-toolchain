import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TOML } from "bun";

export type FinishWorkGateSource = "finishWork" | "agents.prePush" | "default";

export interface FinishWorkConfig {
  gates: string[];
  source: FinishWorkGateSource;
}

/** Canonical Effect discipline gate — matches live finish-work-config.ts / dx.config.toml. */
const EFFECT_GATES_COMMAND = "kimi-doctor --effect-gates";

const DEFAULT_GATES = ["bun run check:fast", EFFECT_GATES_COMMAND];

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function resolveFinishWorkGates(doc: Record<string, unknown>): FinishWorkConfig {
  const finishWork =
    doc.finishWork && typeof doc.finishWork === "object"
      ? (doc.finishWork as Record<string, unknown>)
      : null;
  const finishGates = stringArray(finishWork?.gates);
  if (finishGates.length) {
    return { gates: finishGates, source: "finishWork" };
  }

  const agents =
    doc.agents && typeof doc.agents === "object" ? (doc.agents as Record<string, unknown>) : null;
  const prePush = stringArray(agents?.prePush);
  if (prePush.length) {
    return { gates: prePush, source: "agents.prePush" };
  }

  return { gates: DEFAULT_GATES, source: "default" };
}

export function loadFinishWorkConfig(projectRoot: string): FinishWorkConfig {
  const path = join(projectRoot, "dx.config.toml");
  if (!existsSync(path)) {
    return { gates: DEFAULT_GATES, source: "default" };
  }
  const doc = TOML.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  return resolveFinishWorkGates(doc);
}
