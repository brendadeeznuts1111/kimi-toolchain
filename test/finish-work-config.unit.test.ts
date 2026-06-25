import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { testTempDir } from "./helpers.ts";
import {
  EFFECT_GATES_COMMAND,
  FinishWorkConfigParseError,
  loadFinishWorkConfig,
  resolveFinishWorkConfigFromUnknown,
} from "../src/lib/finish-work-config.ts";

describe("finish-work-config", () => {
  test("resolveFinishWorkConfigFromUnknown prefers [finishWork].gates", () => {
    const config = resolveFinishWorkConfigFromUnknown({
      finishWork: { gates: ["bun run check:fast", EFFECT_GATES_COMMAND] },
      agents: { prePush: ["kimi-githooks doctor", "bun run check"] },
    });

    expect(config.source).toBe("finishWork");
    expect(config.gates).toEqual(["bun run check:fast", EFFECT_GATES_COMMAND]);
  });

  test("resolveFinishWorkConfigFromUnknown falls back to [agents].prePush when finishWork.gates is empty", () => {
    const config = resolveFinishWorkConfigFromUnknown({
      finishWork: { gates: [] },
      agents: { prePush: ["bun run check:fast", "kimi-guardian check"] },
    });

    expect(config.source).toBe("agents.prePush");
    expect(config.gates).toEqual(["bun run check:fast", "kimi-guardian check"]);
  });

  test("resolveFinishWorkConfigFromUnknown falls back to [agents].prePush", () => {
    const config = resolveFinishWorkConfigFromUnknown({
      agents: { prePush: ["bun run check:fast", "kimi-guardian check"] },
    });

    expect(config.source).toBe("agents.prePush");
    expect(config.gates).toEqual(["bun run check:fast", "kimi-guardian check"]);
  });

  test("resolveFinishWorkConfigFromUnknown uses defaults when config is empty", () => {
    const config = resolveFinishWorkConfigFromUnknown({});
    expect(config.source).toBe("default");
    expect(config.gates).toEqual(["bun run check:fast", EFFECT_GATES_COMMAND]);
  });

  test("resolveFinishWorkConfig reads [finishWork.followUp]", () => {
    const config = resolveFinishWorkConfigFromUnknown({
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
    const root = testTempDir("finish-work-config-");
    makeDir(root, { recursive: true });
    writeText(
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
      removePath(root, { recursive: true, force: true });
    }
  });

  test("resolveFinishWorkConfigFromUnknown rejects invalid finishWork.gates", () => {
    try {
      resolveFinishWorkConfigFromUnknown(
        { finishWork: { gates: "not-an-array" } },
        "/tmp/demo/dx.config.toml"
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FinishWorkConfigParseError);
      expect((error as FinishWorkConfigParseError).path).toBe("/tmp/demo/dx.config.toml");
    }
  });

  test("resolveFinishWorkConfigFromUnknown rejects empty gate strings", () => {
    expect(() =>
      resolveFinishWorkConfigFromUnknown({ finishWork: { gates: ["", "bun run check:fast"] } })
    ).toThrow(FinishWorkConfigParseError);
  });

  test("loadFinishWorkConfig rejects invalid TOML", () => {
    const root = testTempDir("finish-work-config-");
    makeDir(root, { recursive: true });
    writeText(join(root, "dx.config.toml"), "finishWork = [\n");

    try {
      expect(() => loadFinishWorkConfig(root)).toThrow(FinishWorkConfigParseError);
    } finally {
      removePath(root, { recursive: true, force: true });
    }
  });
});
