import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { join } from "path";
import { extractAgentsNextSteps, getAgentContext } from "../src/lib/dx-config-agents.ts";
import { mergeDxConfigDocuments } from "../src/lib/dx-config-merge.ts";
import { loadMergedConfigDocument, readTomlDocument } from "../src/lib/dx-config-parse.ts";
import { DxConfig, DxConfigLive } from "../src/lib/effect/dx-config.ts";
import { testTempDir, withIsolatedHome } from "./helpers.ts";

async function writeToml(dir: string, name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await Bun.write(path, content);
  return path;
}

async function setupDxConfig(home: string) {
  const globalDir = join(home, ".config", "dx");
  await Bun.write(
    join(globalDir, "global-config.toml"),
    'scope = "global"\n[runtime]\ncontainers = "none"\n'
  );
  const projectDir = testTempDir("dx-config-project-");
  await writeToml(projectDir, "dx.config.toml", 'scope = "project"\nname = "test"\n');
  return { projectDir };
}

describe("dx-config", () => {
  describe("merge", () => {
    test("scalar values: project overrides global", () => {
      const merged = mergeDxConfigDocuments({ name: "global", mode: "prod" }, { name: "project" });
      expect(merged.name).toBe("project");
      expect(merged.mode).toBe("prod");
    });

    test("nested objects: deep merge", () => {
      const merged = mergeDxConfigDocuments(
        { runtime: { bunVersion: "1.3.14", containers: "none" } },
        { runtime: { bunVersion: "1.4.0" } }
      );
      expect(merged.runtime).toEqual({ bunVersion: "1.4.0", containers: "none" });
    });

    test("primitive arrays: project replaces global when non-empty", () => {
      const merged = mergeDxConfigDocuments({ items: ["a", "b"] }, { items: ["c"] });
      expect(merged.items).toEqual(["c"]);
    });

    test("array-of-tables: union global first, then project", () => {
      const merged = mergeDxConfigDocuments(
        { endpoints: [{ name: "shared" }, { name: "legacy" }] },
        { endpoints: [{ name: "project" }] }
      );
      expect(merged.endpoints).toEqual([
        { name: "shared" },
        { name: "legacy" },
        { name: "project" },
      ]);
    });
  });

  describe("agents", () => {
    test("getAgentContext reads all agent fields", () => {
      const ctx = getAgentContext({
        agents: {
          firstRead: ["AGENTS.md"],
          bootstrap: ["dx setup"],
          iterate: "bun run check:fast",
          fullValidation: "bun run check",
          prePush: ["bun run check:fast"],
          handoff: ["bun run sync"],
          avoid: ["docker"],
          skills: { herdr: { pinned: true } },
        },
      });
      expect(ctx.firstRead).toEqual(["AGENTS.md"]);
      expect(ctx.bootstrap).toEqual(["dx setup"]);
      expect(ctx.iterate).toBe("bun run check:fast");
      expect(ctx.fullValidation).toBe("bun run check");
      expect(ctx.prePush).toEqual(["bun run check:fast"]);
      expect(ctx.handoff).toEqual(["bun run sync"]);
      expect(ctx.avoid).toEqual(["docker"]);
      expect(ctx.skills).toEqual({ herdr: { pinned: true } });
    });

    test("extractAgentsNextSteps deduplicates commands", () => {
      const steps = extractAgentsNextSteps({
        agents: {
          iterate: "bun run check:fast",
          handoff: ["bun run sync", "bun run check:fast"],
          prePush: ["bun run check", "kimi-guardian check"],
        },
      });
      expect(steps).toEqual([
        "bun run check:fast",
        "bun run sync",
        "bun run check",
        "kimi-guardian check",
      ]);
    });
  });

  describe("parse", () => {
    test("readTomlDocument parses TOML", async () => {
      const dir = testTempDir("dx-config-parse-");
      const path = await writeToml(dir, "config.toml", 'name = "test"\n[key]\nvalue = 1\n');
      const doc = await readTomlDocument(path);
      expect(doc.name).toBe("test");
      expect((doc.key as Record<string, unknown>).value).toBe(1);
    });

    test("loadMergedConfigDocument merges global and project", async () => {
      await withIsolatedHome(async (home) => {
        const { projectDir } = await setupDxConfig(home);
        const meta = await loadMergedConfigDocument(projectDir, home);
        expect(meta.document.scope).toBe("project");
        expect(meta.document.name).toBe("test");
        expect(meta.document.runtime).toEqual({ containers: "none" });
        expect(meta.globalPath).toBe(join(home, ".config", "dx", "global-config.toml"));
        expect(meta.projectPath).toBe(join(projectDir, "dx.config.toml"));
      });
    });
  });

  describe("effect-service", () => {
    test("DxConfig service returns merged config", async () => {
      await withIsolatedHome(async (home) => {
        const projectDir = testTempDir("dx-config-service-");
        await Bun.write(join(home, ".config", "dx", "global-config.toml"), 'scope = "global"\n');
        await writeToml(
          projectDir,
          "dx.config.toml",
          'name = "kimi-toolchain"\n[agents]\niterate = "bun run check:fast"\n'
        );

        const doc = await Effect.runPromise(
          Effect.provide(
            Effect.gen(function* () {
              const resolver = yield* DxConfig;
              return yield* resolver.getMergedConfig(projectDir);
            }),
            DxConfigLive()
          )
        );
        expect(doc.name).toBe("kimi-toolchain");
        expect((doc.agents as Record<string, unknown>).iterate).toBe("bun run check:fast");
      });
    });

    test("DxConfig service returns agent context", async () => {
      await withIsolatedHome(async (home) => {
        const projectDir = testTempDir("dx-config-agent-ctx-");
        await Bun.write(join(home, ".config", "dx", "global-config.toml"), 'scope = "global"\n');
        await writeToml(
          projectDir,
          "dx.config.toml",
          '[agents]\nfirstRead = ["AGENTS.md"]\niterate = "bun run check:fast"\n'
        );

        const ctx = await Effect.runPromise(
          Effect.provide(
            Effect.gen(function* () {
              const resolver = yield* DxConfig;
              return yield* resolver.getAgentContext(projectDir);
            }),
            DxConfigLive()
          )
        );
        expect(ctx.firstRead).toEqual(["AGENTS.md"]);
        expect(ctx.iterate).toBe("bun run check:fast");
      });
    });
  });
});
