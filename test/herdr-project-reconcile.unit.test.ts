import { describe, expect, test } from "bun:test";
import {
  buildExpectedLayout,
  diffOrphanTabs,
  diffWorkspaceLayout,
  type ExpectedHerdrLayout,
  type WorkspaceLayoutSnapshot,
} from "../src/lib/herdr-project-reconcile.ts";
import { buildIntendedTabLayouts } from "../src/lib/herdr-project-layout.ts";
import type { HerdrProjectConfig } from "../src/lib/herdr-project-config.ts";

function snapshot(
  workspaceId: string,
  tabs: WorkspaceLayoutSnapshot["tabs"],
  panes: WorkspaceLayoutSnapshot["panes"]
): WorkspaceLayoutSnapshot {
  return { workspaceId, tabs, panes };
}

const toolchainExpected: ExpectedHerdrLayout = {
  agentsTabLabel: "agents",
  primaryAgent: "kimi",
  secondaryAgents: ["codex"],
  shellPane: true,
  extraTabs: [
    { label: "doctor", command: "kimi-doctor --quick" },
    { label: "shell", command: "git status -sb" },
  ],
  tabLayouts: [],
};

describe("herdr-project-reconcile", () => {
  test("buildExpectedLayout maps project config", () => {
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
      agentsTab: null,
      tabs: [{ label: "doctor", command: "kimi-doctor --quick" }],
      sourcePath: "dx.config.toml",
      projectPath: "/tmp/demo",
    };

    const expected = buildExpectedLayout(config);
    expect(expected.agentsTabLabel).toBe("agents");
    expect(expected.primaryAgent).toBe("kimi");
    expect(expected.secondaryAgents).toEqual(["codex"]);
    expect(expected.shellPane).toBe(true);
    expect(expected.extraTabs).toEqual([{ label: "doctor", command: "kimi-doctor --quick" }]);
    expect(expected.tabLayouts).toHaveLength(2);
    expect(expected.tabLayouts[0]?.tabLabel).toBe("agents");
    expect(expected.tabLayouts[1]?.tabLabel).toBe("doctor");
  });

  test("diff flags kimi-toolchain live drift shape when layout already matches", () => {
    const actions = diffWorkspaceLayout(
      { ...toolchainExpected, tabLayouts: [] },
      snapshot(
        "wB",
        [{ tabId: "wB:t1", label: "agents", paneCount: 3 }],
        [
          { paneId: "wB:p1", tabId: "wB:t1", agent: "grok", isShell: false },
          { paneId: "wB:p2", tabId: "wB:t1", agent: "kimi", isShell: false },
          { paneId: "wB:p5", tabId: "wB:t1", agent: "codex", isShell: false },
        ]
      )
    );

    expect(actions.some((row) => row.type === "create_tab" && row.target === "doctor")).toBe(true);
    expect(actions.some((row) => row.type === "create_tab" && row.target === "shell")).toBe(true);
    expect(actions.some((row) => row.type === "split_shell")).toBe(true);
    expect(actions.some((row) => row.reason.includes("primary slot wB:p1 has grok"))).toBe(true);
    expect(actions.some((row) => row.type === "close_pane" && row.target === "wB:p1")).toBe(true);
  });

  test("diff flags dx-config extra kimi and missing doctor tab", () => {
    const expected: ExpectedHerdrLayout = {
      agentsTabLabel: "agents",
      primaryAgent: "grok",
      secondaryAgents: ["claude"],
      shellPane: true,
      extraTabs: [
        { label: "doctor", command: "herdr-doctor" },
        { label: "shell", command: "git status -sb" },
      ],
      tabLayouts: [],
    };

    const actions = diffWorkspaceLayout(
      expected,
      snapshot(
        "w4",
        [
          { tabId: "w4:t1", label: "config", paneCount: 4 },
          { tabId: "w4:t3", label: "shell", paneCount: 1 },
        ],
        [
          { paneId: "w4:p1", tabId: "w4:t1", agent: "grok", isShell: false },
          { paneId: "w4:p7", tabId: "w4:t1", agent: "kimi", isShell: false },
          { paneId: "w4:p5", tabId: "w4:t1", agent: "claude", isShell: false },
          { paneId: "w4:p4", tabId: "w4:t1", agent: null, isShell: true },
          { paneId: "w4:p6", tabId: "w4:t3", agent: null, isShell: true },
        ]
      )
    );

    expect(actions.some((row) => row.type === "create_tab" && row.target === "doctor")).toBe(true);
    expect(actions.some((row) => row.type === "close_pane" && row.target === "w4:p7")).toBe(true);
    expect(actions.some((row) => row.reason.includes('labeled "config"'))).toBe(true);
    expect(actions.some((row) => row.type === "split_shell")).toBe(false);
  });

  test("diffOrphanTabs flags duplicate shell tabs and tabs outside profile", () => {
    const config: HerdrProjectConfig = {
      schemaVersion: 1,
      enabled: true,
      workspaceLabel: "kimi-toolchain",
      primaryAgent: "kimi",
      secondaryAgents: ["codex"],
      shellPane: true,
      shellSplit: "right",
      bootstrap: [],
      session: "",
      agentsTab: { label: "agents", panes: [{ role: "primary", agent: "kimi" }] },
      tabs: [
        { label: "doctor", command: "kimi-doctor --watch" },
        { label: "shell", command: "git status -sb" },
        { label: "reviewer" },
      ],
      sourcePath: "dx.config.toml",
      projectPath: "/tmp/kimi-toolchain",
    };
    const expected = buildExpectedLayout(config);
    expected.tabLayouts = buildIntendedTabLayouts(config);

    const actions = diffOrphanTabs(
      expected,
      snapshot(
        "wB",
        [
          { tabId: "wB:t1C", label: "agents", paneCount: 3 },
          { tabId: "wB:t0", label: "shell", paneCount: 1 },
          { tabId: "wB:t13", label: "shell", paneCount: 1 },
          { tabId: "wB:t15", label: "shell", paneCount: 1 },
          { tabId: "wB:t99", label: "scratch", paneCount: 1 },
        ],
        []
      )
    );

    expect(actions.filter((row) => row.type === "close_tab").map((row) => row.target)).toEqual([
      "wB:t99",
      "wB:t13",
      "wB:t15",
    ]);
  });
});
