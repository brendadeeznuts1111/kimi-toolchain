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
    expect(() =>
      resolveFinishWorkGatesFromUnknown({ finishWork: { gates: "not-an-array" } })
    ).toThrow(FinishWorkConfigParseError);
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
