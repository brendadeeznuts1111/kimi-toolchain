import { describe, expect, test } from "bun:test";
import {
  buildAgentsTabLayoutTree,
  buildExtraTabLayoutTree,
  buildIntendedTabLayouts,
  layoutTreesEqual,
  normalizeLayoutNode,
  type LayoutNode,
} from "../src/lib/herdr-project-layout.ts";
import type { HerdrProjectConfig } from "../src/lib/herdr-project-config.ts";

const projectPath = "/tmp/demo";

describe("herdr-project-layout", () => {
  test("agents tab panes inherit artifact identity env", () => {
    const prev = {
      KIMI_CODE_SESSION: Bun.env.KIMI_CODE_SESSION,
      HERDR_PANE_ID: Bun.env.HERDR_PANE_ID,
      KIMI_RUN_ID: Bun.env.KIMI_RUN_ID,
    };
    Bun.env.KIMI_CODE_SESSION = "wd_layout_session";
    Bun.env.HERDR_PANE_ID = "pane_layout_parent";
    Bun.env.KIMI_RUN_ID = "run_layout_parent";
    try {
      const root = buildAgentsTabLayoutTree(
        {
          label: "agents",
          panes: [{ role: "primary", agent: "kimi" }],
        },
        projectPath
      );
      expect(root.type).toBe("pane");
      if (root.type !== "pane") return;
      expect(root.env).toMatchObject({
        HERDR_ROLE: "primary",
        KIMI_CODE_SESSION: "wd_layout_session",
        HERDR_PANE_ID: "pane_layout_parent",
        KIMI_PARENT_RUN_ID: "run_layout_parent",
      });
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete Bun.env[key];
        else Bun.env[key] = value;
      }
    }
  });

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
          label: "shell",
          cwd: projectPath,
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

  test("normalizeLayoutNode compares label and command without env", () => {
    const withEnv = normalizeLayoutNode(
      {
        type: "pane",
        label: "kimi",
        cwd: projectPath,
        command: ["/Users/me/.bun/bin/kimi"],
        env: { HERDR_ROLE: "primary" },
      },
      projectPath
    );
    const exported = normalizeLayoutNode(
      {
        type: "pane",
        label: "kimi",
        cwd: projectPath,
        command: ["/usr/bin/kimi"],
      },
      projectPath
    );

    expect(withEnv).toEqual(exported);
    expect(withEnv.command).toBe("kimi");
    expect(withEnv.label).toBe("kimi");
  });

  test("grok --role test tab defers command in layout tree for post-apply agent start", () => {
    const root = buildExtraTabLayoutTree(
      {
        label: "test",
        command: "grok --role test-agent --cwd . -- bun run scripts/test-agent.ts --watch",
      },
      projectPath
    );
    expect(root.type).toBe("pane");
    if (root.type !== "pane") return;
    expect(root.label).toBe("test-agent");
    expect(root.command).toBeUndefined();
  });

  test("grok --role tab layout converges after agent rename", () => {
    const root = buildExtraTabLayoutTree(
      {
        label: "test",
        command: "grok --role test-agent --cwd . -- bun run scripts/test-agent.ts --watch",
      },
      projectPath
    );
    const actual = { type: "pane" as const, label: "test-agent", cwd: projectPath };
    expect(layoutTreesEqual(root, actual, projectPath)).toBe(true);
  });

  test("tab commands keep an interactive shell after one-shot tab boot", () => {
    const config: HerdrProjectConfig = {
      schemaVersion: 1,
      enabled: true,
      workspaceLabel: "demo",
      primaryAgent: "kimi",
      secondaryAgents: [],
      shellPane: false,
      shellSplit: "right",
      bootstrap: [],
      session: "",
      agentsTab: null,
      tabs: [{ label: "shell", command: "git status -sb; herdr-quickref" }],
      sourcePath: "dx.config.toml",
      projectPath,
    };
    const layouts = buildIntendedTabLayouts(config);
    const root = layouts.find((row) => row.tabLabel === "shell")?.root;
    expect(root?.type).toBe("pane");
    if (root?.type !== "pane") return;
    expect(root.command?.[2]).toContain('exec "${SHELL:-/bin/bash}" -l');
  });

  test("layoutTreesEqual matches intended tree to layout.export shape", () => {
    const intended = buildAgentsTabLayoutTree(
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
    const exported = {
      type: "split",
      direction: "right",
      ratio: 0.6,
      first: {
        type: "split",
        direction: "right",
        ratio: 0.6,
        first: {
          type: "pane",
          pane_id: "wB:p1",
          label: "kimi",
          cwd: projectPath,
          command: ["/Users/nolarose/.kimi-code/bin/kimi"],
        },
        second: {
          type: "pane",
          pane_id: "wB:p2",
          label: "shell",
          cwd: projectPath,
        },
      },
      second: {
        type: "pane",
        pane_id: "wB:p3",
        label: "codex",
        cwd: projectPath,
        command: ["/opt/homebrew/bin/codex"],
      },
    } as LayoutNode;

    expect(layoutTreesEqual(intended, exported, projectPath)).toBe(true);
  });
});
