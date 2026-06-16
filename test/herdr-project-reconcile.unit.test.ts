import { describe, expect, test } from "bun:test";
import {
  buildExpectedLayout,
  diffWorkspaceLayout,
  type ExpectedHerdrLayout,
  type WorkspaceLayoutSnapshot,
} from "../src/lib/herdr-project-reconcile.ts";
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
      tabs: [{ label: "doctor", command: "kimi-doctor --quick" }],
      sourcePath: "dx.config.toml",
    };

    expect(buildExpectedLayout(config)).toEqual({
      agentsTabLabel: "agents",
      primaryAgent: "kimi",
      secondaryAgents: ["codex"],
      shellPane: true,
      extraTabs: [{ label: "doctor", command: "kimi-doctor --quick" }],
    });
  });

  test("diff flags kimi-toolchain live drift shape", () => {
    const actions = diffWorkspaceLayout(
      toolchainExpected,
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
});
