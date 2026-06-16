import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  EFFECT_GATES_COMMAND,
  FinishWorkConfigParseError,
  loadFinishWorkConfig,
  resolveFinishWorkGatesFromUnknown,
} from "../src/lib/finish-work-config.ts";

describe("finish-work-config", () => {
  test("resolveFinishWorkGates prefers [finishWork].gates", () => {
    const config = resolveFinishWorkGatesFromUnknown({
      finishWork: { gates: ["bun run check:fast", EFFECT_GATES_COMMAND] },
      agents: { prePush: ["kimi-githooks doctor", "bun run check"] },
    });

    expect(config.source).toBe("finishWork");
    expect(config.gates).toEqual(["bun run check:fast", EFFECT_GATES_COMMAND]);
  });

  test("resolveFinishWorkGates falls back to [agents].prePush when finishWork.gates is empty", () => {
    const config = resolveFinishWorkGatesFromUnknown({
      finishWork: { gates: [] },
      agents: { prePush: ["bun run check:fast", "kimi-guardian check"] },
    });

    expect(config.source).toBe("agents.prePush");
    expect(config.gates).toEqual(["bun run check:fast", "kimi-guardian check"]);
  });

  test("resolveFinishWorkGates falls back to [agents].prePush", () => {
    const config = resolveFinishWorkGatesFromUnknown({
      agents: { prePush: ["bun run check:fast", "kimi-guardian check"] },
    });

    expect(config.source).toBe("agents.prePush");
    expect(config.gates).toEqual(["bun run check:fast", "kimi-guardian check"]);
  });

  test("resolveFinishWorkGates uses defaults when config is empty", () => {
    const config = resolveFinishWorkGatesFromUnknown({});
    expect(config.source).toBe("default");
    expect(config.gates).toEqual(["bun run check:fast", EFFECT_GATES_COMMAND]);
  });

  test("resolveFinishWorkConfig reads [finishWork.followUp]", () => {
    const config = resolveFinishWorkGatesFromUnknown({
      finishWork: {
        gates: ["bun run check:fast"],
        followUp: { command: "kimi-doctor --effect-floor" },
      },
    });

    expect(config.followUp).toEqual({ command: "kimi-doctor --effect-floor" });
  });

  test("finish-work followUp step name for effect-floor command", () => {
    const command = "kimi-doctor --effect-floor";
    const first = command.trim().split(/\s+/)[0] ?? "follow-up";
    const step = first.includes("doctor") ? "effect-floor" : first.replace(/^kimi-/, "");
    expect(step).toBe("effect-floor");
  });

  test("loadFinishWorkConfig reads dx.config.toml", () => {
    const root = join(tmpdir(), `finish-work-config-${Bun.randomUUIDv7()}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "dx.config.toml"),
      `[finishWork]
gates = ["bun run check:fast"]
`
    );

    try {
      const config = loadFinishWorkConfig(root);
      expect(config.source).toBe("finishWork");
      expect(config.gates).toEqual(["bun run check:fast"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("resolveFinishWorkGatesFromUnknown rejects invalid finishWork.gates", () => {
    try {
      resolveFinishWorkGatesFromUnknown(
        { finishWork: { gates: "not-an-array" } },
        "/tmp/demo/dx.config.toml"
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FinishWorkConfigParseError);
      expect((error as FinishWorkConfigParseError).path).toBe("/tmp/demo/dx.config.toml");
    }
  });

  test("resolveFinishWorkGatesFromUnknown rejects empty gate strings", () => {
    expect(() =>
      resolveFinishWorkGatesFromUnknown({ finishWork: { gates: ["", "bun run check:fast"] } })
    ).toThrow(FinishWorkConfigParseError);
  });

  test("loadFinishWorkConfig rejects invalid TOML", () => {
    const root = join(tmpdir(), `finish-work-config-${Bun.randomUUIDv7()}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "dx.config.toml"), "finishWork = [\n");

    try {
      expect(() => loadFinishWorkConfig(root)).toThrow(FinishWorkConfigParseError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
