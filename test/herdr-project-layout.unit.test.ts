import { describe, expect, test } from "bun:test";
import {
  buildAgentsTabLayoutTree,
  buildIntendedTabLayouts,
  layoutTreesEqual,
  normalizeLayoutNode,
  type LayoutNode,
} from "../src/lib/herdr-project-layout.ts";
import type { HerdrProjectConfig } from "../src/lib/herdr-project-config.ts";

const projectPath = "/tmp/demo";

describe("herdr-project-layout", () => {
  test("buildAgentsTabLayoutTree creates chained right splits", () => {
    const root = buildAgentsTabLayoutTree(
      {
        label: "agents",
        panes: [
          { role: "primary", agent: "kimi" },
          { role: "shell", split: "right", ratio: 0.55 },
          { role: "secondary", agent: "codex", split: "right" },
        ],
      },
      projectPath
    );

    expect(root.type).toBe("split");
    if (root.type !== "split") return;
    expect(root.direction).toBe("right");
    expect(root.ratio).toBe(0.6);
    expect(root.second.type).toBe("pane");
    if (root.second.type === "pane") {
      expect(root.second.env?.HERDR_ROLE).toBe("secondary");
      expect(root.second.command?.[0]).toContain("codex");
    }
    expect(root.first.type).toBe("split");
  });

  test("buildIntendedTabLayouts includes agents and extra tabs", () => {
    const config: HerdrProjectConfig = {
      schemaVersion: 1,
      enabled: true,
      workspaceLabel: "demo",
      primaryAgent: "kimi",
      secondaryAgents: ["codex"],
      shellPane: true,
      shellSplit: "right",
      bootstrap: [],
      session: "",
      agentsTab: {
        label: "agents",
        panes: [
          { role: "primary", agent: "kimi" },
          { role: "shell", split: "right" },
          { role: "secondary", agent: "codex", split: "right" },
        ],
      },
      tabs: [{ label: "doctor", command: "kimi-doctor --watch" }],
      sourcePath: "dx.config.toml",
      projectPath,
    };

    const layouts = buildIntendedTabLayouts(config);
    expect(layouts.map((row) => row.tabLabel)).toEqual(["agents", "doctor"]);
    expect(layouts[1]?.root.type).toBe("pane");
  });

  test("layoutTreesEqual ignores pane ids and normalizes cwd", () => {
    const expected = buildAgentsTabLayoutTree(
      {
        label: "agents",
        panes: [
          { role: "primary", agent: "kimi" },
          { role: "shell", split: "right" },
          { role: "secondary", agent: "codex", split: "right" },
        ],
      },
      projectPath
    );

    const actual = {
      type: "split",
      direction: "right",
      ratio: 0.6,
      first: {
        type: "split",
        direction: "right",
        ratio: 0.6,
        first: {
          type: "pane",
          pane_id: "w1:p1",
          label: "kimi",
          cwd: projectPath,
          command: ["/usr/bin/kimi"],
          env: { HERDR_ROLE: "primary" },
        },
        second: {
          type: "pane",
          pane_id: "w1:p2",
          cwd: projectPath,
          env: { HERDR_ROLE: "shell" },
        },
      },
      second: {
        type: "pane",
        pane_id: "w1:p3",
        label: "codex",
        cwd: projectPath,
        command: ["/usr/bin/codex"],
        env: { HERDR_ROLE: "secondary" },
      },
    } as LayoutNode;

    expect(layoutTreesEqual(expected, actual, projectPath)).toBe(true);
  });

  test("normalizeLayoutNode extracts role and agent", () => {
    const normalized = normalizeLayoutNode(
      {
        type: "pane",
        label: "kimi",
        cwd: projectPath,
        command: ["/Users/me/.bun/bin/kimi"],
        env: { HERDR_ROLE: "primary" },
      },
      projectPath
    );

    expect(normalized.role).toBe("primary");
    expect(normalized.agent).toBe("kimi");
  });
});
