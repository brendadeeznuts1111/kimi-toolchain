import { describe, expect, test } from "bun:test";
import {
  buildExpectedLayout,
  diffOrphanTabs,
  diffWorkspaceLayout,
  planReconcileActions,
  postLayoutTabCommandPlan,
  type ExpectedHerdrLayout,
  type WorkspaceLayoutSnapshot,
} from "../src/lib/herdr-project-reconcile.ts";
import { buildIntendedTabLayouts, diffTabLayouts } from "../src/lib/herdr-project-layout.ts";
import {
  grokRoleTabCliSequence,
  parseGrokRoleTabCommand,
  planGrokRoleTabAgent,
} from "../src/lib/herdr-role-tab.ts";
import type { HerdrProjectConfig } from "../src/lib/herdr-project-config.ts";

function snapshot(
  workspaceId: string,
  tabs: WorkspaceLayoutSnapshot["tabs"],
  panes: WorkspaceLayoutSnapshot["panes"]
): WorkspaceLayoutSnapshot {
  return { workspaceId, tabs, panes };
}

const V2_TEST_TAB_COMMAND =
  "grok --role test-agent --cwd . -- bun run scripts/test-agent.ts --watch";

const scaffoldV2ExtraTabs = [
  { label: "dev", command: "bun run dev" },
  { label: "check", command: "bun run check:fast" },
  { label: "test", command: V2_TEST_TAB_COMMAND },
  { label: "repl", command: "bun repl" },
  { label: "doctor", command: "kimi-doctor --quick" },
  { label: "shell", command: "git status -sb" },
];

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

  test("apply_layout path defers grok --role command to post-apply runTabCommand", () => {
    const config: HerdrProjectConfig = {
      schemaVersion: 2,
      enabled: true,
      workspaceLabel: "kimi-toolchain",
      primaryAgent: "kimi",
      secondaryAgents: ["codex"],
      shellPane: true,
      shellSplit: "right",
      bootstrap: [],
      session: "",
      agentsTab: { label: "agents", panes: [{ role: "primary", agent: "kimi" }] },
      tabs: [{ label: "test", command: V2_TEST_TAB_COMMAND }],
      sourcePath: "dx.config.toml",
      projectPath: "/Users/nolarose/kimi-toolchain",
    };
    const expected = buildExpectedLayout(config);
    const testLayout = expected.tabLayouts.find((row) => row.tabLabel === "test");
    expect(testLayout?.root.type).toBe("pane");
    if (testLayout?.root.type === "pane") {
      expect(testLayout.root.command).toBeUndefined();
      expect(testLayout.root.label).toBe("test-agent");
    }

    const postApply = postLayoutTabCommandPlan(expected.extraTabs, "test");
    expect(postApply?.strategy).toBe("grok_role_agent");
    expect(postApply?.command).toBe(V2_TEST_TAB_COMMAND);

    const layoutDrifts = diffTabLayouts(
      expected.tabLayouts,
      [{ tabId: "wB:t1C", label: "agents" }],
      new Map(),
      config.projectPath || ""
    );
    const testDrift = layoutDrifts.find((row) => row.tabLabel === "test");
    expect(testDrift?.reason).toContain('missing tab "test"');

    const actions = planReconcileActions(
      expected,
      snapshot("wB", [{ tabId: "wB:t1C", label: "agents", paneCount: 3 }], []),
      layoutDrifts
    );
    const applyTest = actions.find((row) => row.type === "apply_layout" && row.target === "test");
    expect(applyTest?.detail?.postApplyStrategy).toBe("grok_role_agent");
    expect(applyTest?.detail?.command).toBe(V2_TEST_TAB_COMMAND);

    const plan = planGrokRoleTabAgent(
      { ...config, projectPath: "/Users/nolarose/kimi-toolchain" },
      V2_TEST_TAB_COMMAND,
      { tabLabel: "test" }
    );
    expect(plan?.renameTo).toBe("test-agent");
  });

  test("create_tab and apply_layout grok --role paths share runTabCommand CLI sequence", () => {
    const config: HerdrProjectConfig = {
      schemaVersion: 2,
      enabled: true,
      workspaceLabel: "kimi-toolchain",
      primaryAgent: "kimi",
      secondaryAgents: ["codex"],
      shellPane: true,
      shellSplit: "right",
      bootstrap: [],
      session: "",
      agentsTab: { label: "agents", panes: [{ role: "primary", agent: "kimi" }] },
      tabs: [{ label: "test", command: V2_TEST_TAB_COMMAND }],
      sourcePath: "dx.config.toml",
      projectPath: "/Users/nolarose/kimi-toolchain",
    };
    const expected = buildExpectedLayout(config);
    const agentsSnapshot = snapshot(
      "wB",
      [{ tabId: "wB:t1C", label: "agents", paneCount: 3 }],
      [
        { paneId: "wB:p1W", tabId: "wB:t1C", agent: "kimi", isShell: false },
        { paneId: "wB:p1Y", tabId: "wB:t1C", agent: null, isShell: true },
        { paneId: "wB:p1X", tabId: "wB:t1C", agent: "codex", isShell: false },
      ]
    );

    const createTab = diffWorkspaceLayout(expected, agentsSnapshot).find(
      (row) => row.type === "create_tab" && row.target === "test"
    );
    expect(createTab?.detail?.strategy).toBe("grok_role_agent");
    expect(createTab?.detail?.command).toBe(V2_TEST_TAB_COMMAND);

    const layoutDrifts = diffTabLayouts(
      expected.tabLayouts,
      agentsSnapshot.tabs,
      new Map(),
      config.projectPath || ""
    );
    const applyLayout = planReconcileActions(expected, agentsSnapshot, layoutDrifts).find(
      (row) => row.type === "apply_layout" && row.target === "test"
    );
    expect(applyLayout?.detail?.postApplyStrategy).toBe("grok_role_agent");
    expect(applyLayout?.detail?.command).toBe(V2_TEST_TAB_COMMAND);

    const createSequence = grokRoleTabCliSequence(
      config,
      "wB",
      String(createTab?.detail?.command),
      {
        tabId: "wB:t1J",
        paneId: "wB:p24",
        tabLabel: "test",
      }
    );
    const applySequence = grokRoleTabCliSequence(
      config,
      "wB",
      String(applyLayout?.detail?.command),
      {
        tabId: "wB:t1J",
        paneId: "wB:p24",
        tabLabel: "test",
      }
    );
    expect(createSequence).toEqual(applySequence);
    expect(createSequence?.rename[3]).toBe("test-agent");
    expect(createSequence?.reportAgent).toContain("report-agent");
  });

  test("diffWorkspaceLayout marks test tab create_tab as grok_role_agent strategy", () => {
    const actions = diffWorkspaceLayout(
      {
        ...toolchainExpected,
        extraTabs: scaffoldV2ExtraTabs,
        tabLayouts: [],
      },
      snapshot(
        "wB",
        [{ tabId: "wB:t1C", label: "agents", paneCount: 3 }],
        [
          { paneId: "wB:p1W", tabId: "wB:t1C", agent: "kimi", isShell: false },
          { paneId: "wB:p1Y", tabId: "wB:t1C", agent: null, isShell: true },
          { paneId: "wB:p1X", tabId: "wB:t1C", agent: "codex", isShell: false },
        ]
      )
    );

    const testTab = actions.find((row) => row.type === "create_tab" && row.target === "test");
    expect(testTab).toBeDefined();
    expect(testTab?.detail?.strategy).toBe("grok_role_agent");
    expect(testTab?.detail?.role).toBe("test-agent");
    expect(testTab?.detail?.command).toBe(V2_TEST_TAB_COMMAND);
    expect(parseGrokRoleTabCommand(String(testTab?.detail?.command))?.role).toBe("test-agent");

    const devTab = actions.find((row) => row.type === "create_tab" && row.target === "dev");
    expect(devTab?.detail?.strategy).toBe("pane_run");
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
