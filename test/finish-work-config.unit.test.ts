import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadFinishWorkConfig, resolveFinishWorkGates } from "../src/lib/finish-work-config.ts";

describe("finish-work-config", () => {
  test("resolveFinishWorkGates prefers [finishWork].gates", () => {
    const config = resolveFinishWorkGates({
      finishWork: { gates: ["bun run check:fast", "bun run doctor --effect-gates"] },
      agents: { prePush: ["kimi-githooks doctor", "bun run check"] },
    });

    expect(config.source).toBe("finishWork");
    expect(config.gates).toEqual(["bun run check:fast", "bun run doctor --effect-gates"]);
  });

  test("resolveFinishWorkGates falls back to [agents].prePush", () => {
    const config = resolveFinishWorkGates({
      agents: { prePush: ["bun run check:fast", "kimi-guardian check"] },
    });

    expect(config.source).toBe("agents.prePush");
    expect(config.gates).toEqual(["bun run check:fast", "kimi-guardian check"]);
  });

  test("resolveFinishWorkGates uses defaults when config is empty", () => {
    const config = resolveFinishWorkGates({});
    expect(config.source).toBe("default");
    expect(config.gates).toEqual(["bun run check:fast", "bun run doctor --effect-gates"]);
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
});
