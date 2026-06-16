import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverHerdrProjectConfig,
  extractHerdrProjectSection,
  isProjectOnlyHerdrProfilePath,
} from "../src/lib/herdr-project-config.ts";

describe("herdr-project-config", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `herdr-project-config-${Bun.randomUUIDv7()}`);
    mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test("isProjectOnlyHerdrProfilePath matches flat profile filenames", () => {
    expect(isProjectOnlyHerdrProfilePath(".dx/herdr.toml")).toBe(true);
    expect(isProjectOnlyHerdrProfilePath("/tmp/demo/.dx/herdr.toml")).toBe(true);
    expect(isProjectOnlyHerdrProfilePath("dx.config.toml")).toBe(false);
  });

  test("extractHerdrProjectSection reads flat .dx/herdr.toml without [herdr] wrapper", () => {
    const config = extractHerdrProjectSection(
      {
        schemaVersion: 1,
        enabled: true,
        workspaceLabel: "dx",
        shellPane: true,
        bootstrap: ["herdr-doctor"],
      },
      ".dx/herdr.toml"
    );

    expect(config).not.toBeNull();
    expect(config?.workspaceLabel).toBe("dx");
    expect(config?.shellPane).toBe(true);
    expect(config?.bootstrap).toEqual(["herdr-doctor"]);
    expect(config?.primaryAgent).toBeNull();
  });

  test("extractHerdrProjectSection ignores flat profile when disabled", () => {
    const config = extractHerdrProjectSection(
      {
        enabled: false,
        workspaceLabel: "dx",
      },
      ".dx/herdr.toml"
    );

    expect(config).toBeNull();
  });

  test("extractHerdrProjectSection still reads nested [herdr] in dx.config.toml", () => {
    const config = extractHerdrProjectSection(
      {
        schemaVersion: 1,
        name: "demo",
        herdr: {
          enabled: true,
          workspaceLabel: "demo-app",
          primaryAgent: "kimi",
          secondaryAgents: ["codex"],
        },
      },
      "dx.config.toml"
    );

    expect(config?.workspaceLabel).toBe("demo-app");
    expect(config?.primaryAgent).toBe("kimi");
    expect(config?.secondaryAgents).toEqual(["codex"]);
  });

  test("extractHerdrProjectSection parses agentsTab and syncs legacy fields", () => {
    const config = extractHerdrProjectSection(
      {
        schemaVersion: 1,
        herdr: {
          enabled: true,
          workspaceLabel: "demo-app",
          agentsTab: {
            label: "agents",
            panes: [
              { role: "primary", agent: "kimi" },
              { role: "shell", split: "right", ratio: 0.55 },
              { role: "secondary", agent: "codex", split: "right" },
            ],
          },
        },
      },
      "dx.config.toml"
    );

    expect(config?.agentsTab?.label).toBe("agents");
    expect(config?.agentsTab?.panes).toHaveLength(3);
    expect(config?.primaryAgent).toBe("kimi");
    expect(config?.secondaryAgents).toEqual(["codex"]);
    expect(config?.shellPane).toBe(true);
    expect(config?.shellSplit).toBe("right");
  });

  test("discoverHerdrProjectConfig prefers flat .dx/herdr.toml over dx.config.toml", () => {
    mkdirSync(join(projectRoot, ".dx"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".dx/herdr.toml"),
      `schemaVersion = 1
enabled = true
workspaceLabel = "dx"
shellPane = true
`
    );
    writeFileSync(
      join(projectRoot, "dx.config.toml"),
      `schemaVersion = 1
name = "ignored"

[herdr]
enabled = true
workspaceLabel = "other"
`
    );

    const config = discoverHerdrProjectConfig(projectRoot);
    expect(config?.workspaceLabel).toBe("dx");
    expect(config?.sourcePath).toEndWith(".dx/herdr.toml");
  });

  test("discoverHerdrProjectConfig returns null when only dx.config.toml lacks [herdr]", () => {
    writeFileSync(
      join(projectRoot, "dx.config.toml"),
      `schemaVersion = 1
name = "no-herdr"
`
    );

    expect(discoverHerdrProjectConfig(projectRoot)).toBeNull();
  });
});
