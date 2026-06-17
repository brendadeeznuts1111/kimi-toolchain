import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { join } from "path";
import {
  getAgentContext,
  getSection,
  loadConfigFile,
  mergeConfigs,
  type DxConfigDocument,
} from "../src/lib/dx-config.ts";
import { DxConfigResolver, DxConfigResolverLive } from "../src/lib/effect/dx-config-service.ts";
import { testTempDir } from "./helpers.ts";

async function writeToml(dir: string, name: string, content: string): Promise<string> {
  const path = join(dir, name);
  await Bun.write(path, content);
  return path;
}

function runWithTestGlobal(globalPath: string) {
  const previous = Bun.env.DX_GLOBAL_CONFIG;
  Bun.env.DX_GLOBAL_CONFIG = globalPath;
  function restore() {
    if (previous === undefined) delete Bun.env.DX_GLOBAL_CONFIG;
    else Bun.env.DX_GLOBAL_CONFIG = previous;
  }
  return { restore };
}

describe("dx-config", () => {
  test("loadConfigFile parses TOML", async () => {
    const dir = testTempDir("dx-config-load-");
    const path = await writeToml(dir, "config.toml", 'name = "test"\n[key]\nvalue = 1\n');
    const result = await Effect.runPromise(loadConfigFile(path));
    expect(result.name).toBe("test");
    expect((result.key as Record<string, unknown>).value).toBe(1);
  });

  test("loadConfigFile fails with ConfigReadError when missing", async () => {
    const result = await Effect.runPromiseExit(loadConfigFile("/nonexistent/path.toml"));
    expect(result._tag).toBe("Failure");
  });

  test("mergeConfigs scalar override", () => {
    const merged = mergeConfigs({ name: "global", mode: "production" }, { name: "project" });
    expect(merged.raw.name).toBe("project");
    expect(merged.raw.mode).toBe("production");
  });

  test("mergeConfigs default array policy is replace", () => {
    const merged = mergeConfigs({ items: ["a", "b"] }, { items: ["c"] });
    expect(merged.raw.items).toEqual(["c"]);
  });

  test("mergeConfigs endpoints merge by name", () => {
    const merged = mergeConfigs(
      {
        endpoints: [
          { name: "shared", url: "https://global.example.com" },
          { name: "legacy", url: "https://legacy.example.com" },
        ],
      },
      {
        endpoints: [
          { name: "shared", url: "https://project.example.com" },
          { name: "new", url: "https://new.example.com" },
        ],
      },
      {
        policies: [{ path: "endpoints", policy: "mergeByName" }],
      }
    );
    const endpoints = merged.raw.endpoints as Array<Record<string, string>>;
    expect(endpoints).toHaveLength(3);
    expect(endpoints.find((e) => e.name === "shared")?.url).toBe("https://project.example.com");
    expect(endpoints.find((e) => e.name === "new")).toBeDefined();
    expect(endpoints.find((e) => e.name === "legacy")).toBeDefined();
  });

  test("mergeConfigs agents.firstRead appends uniquely", () => {
    const merged = mergeConfigs(
      { agents: { firstRead: ["global.md", "shared.md"] } },
      { agents: { firstRead: ["project.md", "shared.md"] } },
      {
        policies: [{ path: "agents.firstRead", policy: "appendUnique" }],
      }
    );
    expect((merged.raw.agents as Record<string, unknown>).firstRead).toEqual([
      "global.md",
      "shared.md",
      "project.md",
    ]);
  });

  test("getAgentContext parses agent fields", () => {
    const doc: DxConfigDocument = {
      raw: {
        agents: {
          firstRead: ["AGENTS.md"],
          bootstrap: ["dx setup"],
          iterate: "bun run check:fast",
          prePush: ["bun run check"],
          handoff: ["bun run sync"],
          avoid: ["docker"],
          skills: { herdr: { pinned: true } },
        },
      },
      global: {},
      project: {},
    };
    const ctx = getAgentContext(doc);
    expect(ctx.firstRead).toEqual(["AGENTS.md"]);
    expect(ctx.bootstrap).toEqual(["dx setup"]);
    expect(ctx.iterate).toBe("bun run check:fast");
    expect(ctx.prePush).toEqual(["bun run check"]);
    expect(ctx.handoff).toEqual(["bun run sync"]);
    expect(ctx.avoid).toEqual(["docker"]);
    expect(ctx.skills).toEqual({ herdr: { pinned: true } });
  });

  test("getSection returns typed slice", () => {
    const doc: DxConfigDocument = {
      raw: { endpoints: [{ name: "api", url: "https://api.example.com" }] },
      global: {},
      project: {},
    };
    const endpoints = getSection<Array<Record<string, string>>>(doc, "endpoints");
    expect(endpoints).toHaveLength(1);
    expect(endpoints?.[0]?.name).toBe("api");
  });

  test("DxConfigResolverLive loads merged config", async () => {
    const globalDir = testTempDir("dx-config-global-");
    const projectDir = testTempDir("dx-config-project-");
    const globalPath = await writeToml(globalDir, "global-config.toml", 'scope = "global"\n');
    await writeToml(projectDir, "dx.config.toml", 'scope = "project"\nname = "test"\n');

    const { restore } = runWithTestGlobal(globalPath);
    try {
      const result = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const resolver = yield* DxConfigResolver;
            return yield* resolver.loadMerged(projectDir);
          }),
          DxConfigResolverLive
        )
      );
      expect(result.raw.scope).toBe("project");
      expect(result.raw.name).toBe("test");
      expect(result.global.scope).toBe("global");
      expect(result.project.name).toBe("test");
    } finally {
      restore();
    }
  });

  test("DxConfigResolverLive returns agent context", async () => {
    const projectDir = testTempDir("dx-config-agent-");
    await writeToml(
      projectDir,
      "dx.config.toml",
      '[agents]\nfirstRead = ["AGENTS.md"]\niterate = "bun run check:fast"\n'
    );

    const { restore } = runWithTestGlobal("/nonexistent/global-config.toml");
    try {
      const ctx = await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const resolver = yield* DxConfigResolver;
            return yield* resolver.loadAgentContext(projectDir);
          }),
          DxConfigResolverLive
        )
      );
      expect(ctx.firstRead).toEqual(["AGENTS.md"]);
      expect(ctx.iterate).toBe("bun run check:fast");
      expect(ctx.bootstrap).toEqual([]);
    } finally {
      restore();
    }
  });
});
