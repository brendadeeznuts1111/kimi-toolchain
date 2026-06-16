import { Effect } from "effect";
import type { HerdrProjectConfig, HerdrProjectTab } from "./herdr-project-config.ts";
import { resolveAgentArgv } from "./herdr-agents.ts";
import {
  applyTabLayoutEffect,
  buildIntendedTabLayouts,
  diffTabLayouts,
  exportTabLayoutEffect,
  type ExportedTabLayout,
  type LayoutDrift,
  type TabLayoutSpec,
} from "./herdr-project-layout.ts";
import { syncAgentsTabContext } from "./herdr-project-context.ts";
import {
  findWorkspaceForProject,
  herdrCliJson,
  herdrCliRun,
  parseHerdrPaneId,
  resolveHerdrPanePath,
  startHerdrAgent,
} from "./herdr-project-runner.ts";

export type ReconcileActionType =
  | "create_tab"
  | "run_tab_command"
  | "start_agent"
  | "split_shell"
  | "close_pane"
  | "close_tab"
  | "apply_layout"
  | "warn";

export interface ReconcileAction {
  type: ReconcileActionType;
  target: string;
  reason: string;
  detail?: Record<string, unknown>;
}

export interface WorkspaceTabRow {
  tabId: string;
  label: string;
  paneCount: number;
}

export interface WorkspacePaneRow {
  paneId: string;
  tabId: string;
  agent: string | null;
  isShell: boolean;
}

export interface ExpectedHerdrLayout {
  agentsTabLabel: string;
  primaryAgent: string | null;
  secondaryAgents: string[];
  shellPane: boolean;
  extraTabs: HerdrProjectTab[];
  tabLayouts: TabLayoutSpec[];
}

export interface WorkspaceLayoutSnapshot {
  workspaceId: string;
  tabs: WorkspaceTabRow[];
  panes: WorkspacePaneRow[];
}

export interface ReconcileReport {
  schemaVersion: 1;
  generatedAt: string;
  projectPath: string;
  configPath: string | null;
  workspaceId: string | null;
  dryRun: boolean;
  expected: ExpectedHerdrLayout;
  actual: WorkspaceLayoutSnapshot | null;
  layoutDrifts: LayoutDrift[];
  actions: ReconcileAction[];
  applied: ReconcileAction[];
  warnings: string[];
  drift: boolean;
}

export interface ReconcileOptions {
  apply?: boolean;
  closeOrphans?: boolean;
  fixAgents?: boolean;
  forceLayout?: boolean;
}

function normalizeLabel(label: string | undefined): string {
  return String(label || "")
    .trim()
    .toLowerCase();
}

export function buildExpectedLayout(config: HerdrProjectConfig): ExpectedHerdrLayout {
  const tabLayouts = buildIntendedTabLayouts(config);
  const agentsTabLabel = config.agentsTab?.label || "agents";
  return {
    agentsTabLabel,
    primaryAgent: config.primaryAgent,
    secondaryAgents: [...(config.secondaryAgents || [])],
    shellPane: config.shellPane !== false,
    extraTabs: [...(config.tabs || [])],
    tabLayouts,
  };
}

function layoutDriftActions(drifts: LayoutDrift[]): ReconcileAction[] {
  return drifts.map((drift) => ({
    type: "apply_layout" as const,
    target: drift.tabLabel,
    reason: drift.reason,
    detail: {
      tabId: drift.tabId,
      destructive: Boolean(drift.tabId),
      requiresForceLayout: true,
    },
  }));
}

function isAgentPane(agent: string | null | undefined): boolean {
  return typeof agent === "string" && agent.length > 0;
}

function paneSortKey(paneId: string): number {
  const match = paneId.match(/:p(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function listWorkspaceTabs(session: string, workspaceId: string): WorkspaceTabRow[] {
  const listed = herdrCliJson(session, ["tab", "list", "--workspace", workspaceId]);
  if (!listed.ok) return [];
  const rows = (listed.json?.result?.tabs || []) as Array<{
    tab_id?: string;
    label?: string;
    pane_count?: number;
  }>;
  return rows
    .filter((row) => typeof row.tab_id === "string")
    .map((row) => ({
      tabId: row.tab_id!,
      label: String(row.label || ""),
      paneCount: typeof row.pane_count === "number" ? row.pane_count : 0,
    }));
}

export function captureWorkspaceLayout(
  session: string,
  workspaceId: string
): WorkspaceLayoutSnapshot {
  const panes = herdrCliJson(session, ["pane", "list"]);
  const rows = panes.ok
    ? ((panes.json?.result?.panes || []) as Array<{
        pane_id?: string;
        tab_id?: string;
        workspace_id?: string;
        agent?: string;
      }>)
    : [];

  return {
    workspaceId,
    tabs: listWorkspaceTabs(session, workspaceId),
    panes: rows
      .filter((row) => row.pane_id && row.tab_id)
      .filter(
        (row) => row.workspace_id === workspaceId || row.tab_id?.startsWith(`${workspaceId}:`)
      )
      .map((row) => ({
        paneId: row.pane_id!,
        tabId: row.tab_id!,
        agent: isAgentPane(row.agent) ? row.agent! : null,
        isShell: !isAgentPane(row.agent),
      })),
  };
}

function resolveAgentsTab(
  expected: ExpectedHerdrLayout,
  snapshot: WorkspaceLayoutSnapshot
): WorkspaceTabRow | null {
  const extraLabels = new Set(
    expected.extraTabs.map((tab) => normalizeLabel(tab.label)).filter(Boolean)
  );
  const byAgentsLabel = snapshot.tabs.find(
    (tab) => normalizeLabel(tab.label) === normalizeLabel(expected.agentsTabLabel)
  );
  if (byAgentsLabel) return byAgentsLabel;

  const nonExtra = snapshot.tabs.filter((tab) => !extraLabels.has(normalizeLabel(tab.label)));
  if (nonExtra.length === 1) return nonExtra[0] ?? null;
  if (nonExtra.length > 1) {
    return [...nonExtra].sort(
      (a, b) => paneSortKey(`${a.tabId}:p1`) - paneSortKey(`${b.tabId}:p1`)
    )[0];
  }
  return snapshot.tabs[0] ?? null;
}

function panesForTab(snapshot: WorkspaceLayoutSnapshot, tabId: string): WorkspacePaneRow[] {
  return snapshot.panes
    .filter((pane) => pane.tabId === tabId)
    .sort((a, b) => paneSortKey(a.paneId) - paneSortKey(b.paneId));
}

function expectedAgentSet(expected: ExpectedHerdrLayout): Set<string> {
  const names = new Set<string>();
  if (expected.primaryAgent) names.add(expected.primaryAgent);
  for (const agent of expected.secondaryAgents) names.add(agent);
  return names;
}

export function diffWorkspaceLayout(
  expected: ExpectedHerdrLayout,
  snapshot: WorkspaceLayoutSnapshot
): ReconcileAction[] {
  const actions: ReconcileAction[] = [];
  const agentsTab = resolveAgentsTab(expected, snapshot);

  if (!agentsTab) {
    actions.push({
      type: "warn",
      target: snapshot.workspaceId,
      reason: "no agents tab found in workspace",
    });
    return actions;
  }

  const agentsPanes = panesForTab(snapshot, agentsTab.tabId);
  const agentsPresent = new Set(
    agentsPanes.map((pane) => pane.agent).filter((agent): agent is string => Boolean(agent))
  );
  const expectedAgents = expectedAgentSet(expected);

  if (normalizeLabel(agentsTab.label) !== normalizeLabel(expected.agentsTabLabel)) {
    actions.push({
      type: "warn",
      target: agentsTab.tabId,
      reason: `agents tab labeled "${agentsTab.label}", expected "${expected.agentsTabLabel}"`,
      detail: { actualLabel: agentsTab.label, expectedLabel: expected.agentsTabLabel },
    });
  }

  if (expected.primaryAgent) {
    if (!agentsPresent.has(expected.primaryAgent)) {
      actions.push({
        type: "start_agent",
        target: expected.primaryAgent,
        reason: `missing primary agent ${expected.primaryAgent} on agents tab`,
        detail: { role: "primary", tabId: agentsTab.tabId },
      });
    }

    const primarySlot = agentsPanes[0];
    if (
      primarySlot?.agent &&
      primarySlot.agent !== expected.primaryAgent &&
      agentsPresent.has(expected.primaryAgent)
    ) {
      actions.push({
        type: "warn",
        target: primarySlot.paneId,
        reason: `primary slot ${primarySlot.paneId} has ${primarySlot.agent}, expected ${expected.primaryAgent}`,
        detail: {
          role: "primary_slot",
          actualAgent: primarySlot.agent,
          expectedAgent: expected.primaryAgent,
        },
      });
    } else if (primarySlot?.agent && primarySlot.agent !== expected.primaryAgent) {
      actions.push({
        type: "warn",
        target: primarySlot.paneId,
        reason: `primary slot ${primarySlot.paneId} has ${primarySlot.agent}, expected ${expected.primaryAgent}`,
        detail: {
          role: "primary_slot",
          actualAgent: primarySlot.agent,
          expectedAgent: expected.primaryAgent,
          fixAgents: true,
        },
      });
    }
  }

  for (const agent of expected.secondaryAgents) {
    if (!agentsPresent.has(agent)) {
      actions.push({
        type: "start_agent",
        target: agent,
        reason: `missing secondary agent ${agent}`,
        detail: { role: "secondary", tabId: agentsTab.tabId },
      });
    }
  }

  if (expected.shellPane && !agentsPanes.some((pane) => pane.isShell)) {
    actions.push({
      type: "split_shell",
      target: agentsPanes[0]?.paneId || agentsTab.tabId,
      reason: "missing shell pane on agents tab",
      detail: { tabId: agentsTab.tabId },
    });
  }

  for (const pane of agentsPanes) {
    if (pane.agent && !expectedAgents.has(pane.agent)) {
      actions.push({
        type: "close_pane",
        target: pane.paneId,
        reason: `extra agent ${pane.agent} not in project profile`,
        detail: { agent: pane.agent, tabId: agentsTab.tabId, orphan: true },
      });
    }
  }

  for (const tab of expected.extraTabs) {
    const label = tab.label || "";
    const normalized = normalizeLabel(label);
    if (!normalized) continue;

    const actual = snapshot.tabs.find((row) => normalizeLabel(row.label) === normalized);
    if (!actual) {
      actions.push({
        type: "create_tab",
        target: label,
        reason: `missing tab ${label}`,
        detail: { command: tab.command || null },
      });
    }
  }

  return actions;
}

/** Tabs not in the profile, or duplicate labels (e.g. three "shell" tabs). */
export function diffOrphanTabs(
  expected: ExpectedHerdrLayout,
  snapshot: WorkspaceLayoutSnapshot
): ReconcileAction[] {
  const intended = new Set(expected.tabLayouts.map((spec) => normalizeLabel(spec.tabLabel)));
  const actions: ReconcileAction[] = [];
  const byLabel = new Map<string, WorkspaceTabRow[]>();

  for (const tab of snapshot.tabs) {
    const key = normalizeLabel(tab.label);
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key)!.push(tab);
  }

  for (const tab of snapshot.tabs) {
    if (!intended.has(normalizeLabel(tab.label))) {
      actions.push({
        type: "close_tab",
        target: tab.tabId,
        reason: `orphan tab "${tab.label}" not in project profile`,
        detail: { label: tab.label, orphan: true },
      });
    }
  }

  for (const [, tabs] of byLabel) {
    if (tabs.length <= 1) continue;
    const label = normalizeLabel(tabs[0]!.label);
    if (!intended.has(label)) continue;
    const sorted = [...tabs].sort(
      (a, b) => paneSortKey(`${a.tabId}:p1`) - paneSortKey(`${b.tabId}:p1`)
    );
    for (const duplicate of sorted.slice(1)) {
      actions.push({
        type: "close_tab",
        target: duplicate.tabId,
        reason: `duplicate tab "${duplicate.label}" (${duplicate.tabId})`,
        detail: { label: duplicate.label, duplicate: true },
      });
    }
  }

  return actions;
}

function mergeReconcileActions(
  expected: ExpectedHerdrLayout,
  snapshot: WorkspaceLayoutSnapshot,
  layoutDrifts: LayoutDrift[]
): ReconcileAction[] {
  const structural = diffWorkspaceLayout(expected, snapshot);
  const orphanTabs = diffOrphanTabs(expected, snapshot);
  const driftLabels = new Set(layoutDrifts.map((row) => normalizeLabel(row.tabLabel)));

  const createFromStructural = structural.filter(
    (action) =>
      action.type === "create_tab" && !driftLabels.has(normalizeLabel(String(action.target)))
  );
  const otherStructural = structural.filter((action) => action.type !== "create_tab");

  if (layoutDrifts.length) {
    const layoutActions = layoutDriftActions(layoutDrifts).map((action) => {
      const drift = layoutDrifts.find((row) => row.tabLabel === action.target);
      return {
        ...action,
        detail: {
          ...action.detail,
          tabId: drift?.tabId || null,
          layout: expected.tabLayouts.find((row) => row.tabLabel === action.target),
        },
      };
    });
    return [...orphanTabs, ...otherStructural, ...createFromStructural, ...layoutActions];
  }

  return [...orphanTabs, ...structural];
}

function shellQuote(value: string) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function paneRun(config: HerdrProjectConfig, paneId: string, command: string) {
  let payload = command;
  const path = resolveHerdrPanePath();
  if (path) {
    const escapedPath = path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    payload = `export PATH="${escapedPath}"; ${command}`;
  }
  return herdrCliRun(config.session, ["pane", "run", paneId, `sh -lc ${shellQuote(payload)}`]);
}

function createTab(config: HerdrProjectConfig, workspaceId: string, label: string) {
  return herdrCliJson(config.session, [
    "tab",
    "create",
    "--workspace",
    workspaceId,
    "--no-focus",
    "--label",
    label,
  ]);
}

function closePane(config: HerdrProjectConfig, paneId: string) {
  return herdrCliRun(config.session, ["pane", "close", paneId]);
}

function closeTab(config: HerdrProjectConfig, tabId: string) {
  return herdrCliRun(config.session, ["tab", "close", tabId]);
}

function splitShellPane(config: HerdrProjectConfig, paneId: string, direction: string) {
  return herdrCliJson(config.session, [
    "pane",
    "split",
    paneId,
    "--direction",
    direction,
    "--no-focus",
  ]);
}

function applyReconcileAction(
  config: HerdrProjectConfig,
  workspaceId: string,
  action: ReconcileAction,
  options: ReconcileOptions
): Effect.Effect<{ ok: boolean; warning?: string }, never> {
  if (action.type === "warn") {
    return Effect.succeed({ ok: false, warning: action.reason });
  }

  if (action.type === "create_tab") {
    const created = createTab(config, workspaceId, action.target);
    if (!created.ok) {
      return Effect.succeed({ ok: false, warning: created.error || "tab create failed" });
    }
    const paneId = parseHerdrPaneId(created.json, null);
    const command = action.detail?.command;
    if (paneId && typeof command === "string" && command.length) {
      const ran = paneRun(config, paneId, command);
      if (!ran.ok) {
        return Effect.succeed({ ok: false, warning: ran.output || "tab command failed" });
      }
    }
    return Effect.succeed({ ok: true });
  }

  if (action.type === "run_tab_command") {
    const command = action.detail?.command;
    if (typeof command !== "string" || !command.length) return Effect.succeed({ ok: true });
    const panes = captureWorkspaceLayout(config.session, workspaceId).panes.filter(
      (pane) => pane.tabId === action.target
    );
    const paneId = panes.sort((a, b) => paneSortKey(a.paneId) - paneSortKey(b.paneId))[0]?.paneId;
    if (!paneId) {
      return Effect.succeed({ ok: false, warning: `no pane for tab ${action.target}` });
    }
    const ran = paneRun(config, paneId, command);
    return Effect.succeed(
      ran.ok ? { ok: true } : { ok: false, warning: ran.output || "tab command failed" }
    );
  }

  if (action.type === "start_agent") {
    const argv = resolveAgentArgv(action.target);
    const role = action.detail?.role;
    const started = startHerdrAgent(config, action.target, argv, {
      workspaceId,
      split: role === "secondary" ? "right" : undefined,
    });
    if (!started.ok) {
      return Effect.succeed({ ok: false, warning: started.error || "agent start failed" });
    }
    const pane = config.agentsTab?.panes?.find(
      (row) => row.agent === action.target && row.context?.trim()
    );
    if (pane) {
      const contextSync = syncAgentsTabContext(config, [pane], workspaceId);
      const warning = contextSync.warnings[0];
      if (warning) return Effect.succeed({ ok: true, warning });
    }
    return Effect.succeed({ ok: true });
  }

  if (action.type === "split_shell") {
    const paneId = String(action.target);
    const split = splitShellPane(config, paneId, config.shellSplit || "right");
    return Effect.succeed(
      split.ok ? { ok: true } : { ok: false, warning: split.error || "shell split failed" }
    );
  }

  if (action.type === "close_pane") {
    if (!options.closeOrphans) {
      return Effect.succeed({
        ok: false,
        warning: "skipped close_pane (pass --close-orphans)",
      });
    }
    const closed = closePane(config, action.target);
    return Effect.succeed(
      closed.ok ? { ok: true } : { ok: false, warning: closed.output || "pane close failed" }
    );
  }

  if (action.type === "close_tab") {
    if (!options.closeOrphans && !options.forceLayout) {
      return Effect.succeed({
        ok: false,
        warning: "skipped close_tab (pass --close-orphans or --force-layout)",
      });
    }
    const closed = closeTab(config, action.target);
    return Effect.succeed(
      closed.ok ? { ok: true } : { ok: false, warning: closed.output || "tab close failed" }
    );
  }

  if (action.type === "apply_layout") {
    if (!options.forceLayout) {
      return Effect.succeed({
        ok: false,
        warning: `skipped apply_layout for ${action.target} (pass --force-layout; destroys scrollback)`,
      });
    }
    const spec = (action.detail?.layout as TabLayoutSpec | undefined) || null;
    if (!spec) {
      return Effect.succeed({ ok: false, warning: `missing layout spec for ${action.target}` });
    }
    return applyLayoutAction(config, workspaceId, spec, action.detail?.tabId as string | undefined);
  }

  return Effect.succeed({ ok: false, warning: `unsupported action ${action.type}` });
}

function resolveTabIdByLabel(
  config: HerdrProjectConfig,
  workspaceId: string,
  tabLabel: string
): string | undefined {
  const normalized = tabLabel.trim().toLowerCase();
  return listWorkspaceTabs(config.session, workspaceId).find(
    (tab) => tab.label.trim().toLowerCase() === normalized
  )?.tabId;
}

function applyLayoutAction(
  config: HerdrProjectConfig,
  workspaceId: string,
  spec: TabLayoutSpec,
  tabId?: string | null
): Effect.Effect<{ ok: boolean; warning?: string }, never> {
  return Effect.gen(function* () {
    const resolvedTabId =
      tabId ?? resolveTabIdByLabel(config, workspaceId, spec.tabLabel) ?? undefined;

    const applied = yield* applyTabLayoutEffect({
      workspaceId,
      tabLabel: spec.tabLabel,
      root: spec.root,
      tabId: resolvedTabId,
      focus: false,
    });
    if (!applied.ok) return { ok: false, warning: applied.error };

    const isAgentsTab =
      spec.tabLabel.trim().toLowerCase() ===
      (config.agentsTab?.label || "agents").trim().toLowerCase();

    if (isAgentsTab && (config.bootstrap || []).length) {
      const snapshot = captureWorkspaceLayout(config.session, workspaceId);
      const shellPane = snapshot.panes.find((pane) => pane.tabId === applied.tabId && pane.isShell);
      if (shellPane) {
        const script = (config.bootstrap || []).join(" && ");
        const ran = paneRun(config, shellPane.paneId, script);
        if (!ran.ok) {
          return {
            ok: false,
            warning: ran.output || "bootstrap command failed after layout apply",
          };
        }
      }
    }

    if (
      isAgentsTab &&
      config.agentsTab?.panes?.some((pane) => pane.context?.trim() && pane.agent)
    ) {
      const contextSync = syncAgentsTabContext(config, config.agentsTab?.panes, workspaceId);
      const warning = contextSync.warnings[0];
      if (warning && contextSync.delivered.length === 0) {
        return { ok: false, warning };
      }
      if (warning) return { ok: true, warning };
    }

    return { ok: true };
  });
}

function applyLayoutDriftsSerial(
  config: HerdrProjectConfig,
  workspaceId: string,
  expected: ExpectedHerdrLayout
): Effect.Effect<{ applied: ReconcileAction[]; warnings: string[] }, never> {
  return Effect.gen(function* () {
    const applied: ReconcileAction[] = [];
    const warnings: string[] = [];
    const tabOrder = expected.tabLayouts.map((spec) => spec.tabLabel);

    while (true) {
      const drifts = yield* collectLayoutDrifts(config, workspaceId, expected);
      if (!drifts.length) break;

      const drift =
        tabOrder
          .map((label) => drifts.find((row) => row.tabLabel === label))
          .find((row): row is LayoutDrift => row != null) ?? drifts[0]!;

      const spec = expected.tabLayouts.find((row) => row.tabLabel === drift.tabLabel);
      if (!spec) {
        warnings.push(`missing layout spec for ${drift.tabLabel}`);
        break;
      }

      const result = yield* applyLayoutAction(config, workspaceId, spec, drift.tabId);
      const action: ReconcileAction = {
        type: "apply_layout",
        target: drift.tabLabel,
        reason: drift.reason,
        detail: { tabId: drift.tabId, layout: spec },
      };

      if (result.ok) {
        applied.push(action);
        continue;
      }

      warnings.push(result.warning || `apply_layout failed for ${drift.tabLabel}`);
      break;
    }

    return { applied, warnings };
  });
}

function collectLayoutDrifts(
  config: HerdrProjectConfig,
  workspaceId: string,
  expected: ExpectedHerdrLayout
): Effect.Effect<LayoutDrift[], never> {
  return Effect.gen(function* () {
    const tabs = listWorkspaceTabs(config.session, workspaceId);
    const exported = new Map<string, ExportedTabLayout | null>();

    for (const tab of tabs) {
      const result = yield* exportTabLayoutEffect(tab.tabId);
      exported.set(tab.tabId, result.ok ? result.layout : null);
    }

    return diffTabLayouts(expected.tabLayouts, tabs, exported, config.projectPath || "");
  });
}

export function reconcileHerdrProjectEffect(
  config: HerdrProjectConfig,
  options: ReconcileOptions = {}
): Effect.Effect<ReconcileReport, never> {
  return Effect.gen(function* () {
    const expected = buildExpectedLayout(config);
    const match = findWorkspaceForProject(config);
    const warnings: string[] = [];
    const applied: ReconcileAction[] = [];

    if (!match.workspaceId) {
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        projectPath: config.projectPath || "",
        configPath: config.sourcePath,
        workspaceId: null,
        dryRun: !options.apply,
        expected,
        actual: null,
        layoutDrifts: [],
        actions: [
          {
            type: "warn",
            target: config.projectPath || "",
            reason: `workspace not open (${match.reason})`,
          },
        ],
        applied,
        warnings: [`workspace not open (${match.reason})`],
        drift: true,
      };
    }

    const actual = captureWorkspaceLayout(config.session, match.workspaceId);
    const layoutDrifts = yield* collectLayoutDrifts(config, match.workspaceId, expected);

    const actions = mergeReconcileActions(expected, actual, layoutDrifts);

    const actionable = actions.filter((action) => action.type !== "warn");

    if (options.apply) {
      const closeTabActions = actions.filter((action) => action.type === "close_tab");
      const deferredLayout = actions.filter(
        (action) =>
          action.type !== "close_tab" &&
          !(layoutDrifts.length && options.forceLayout && action.type === "apply_layout")
      );

      for (const action of closeTabActions) {
        const result = yield* applyReconcileAction(config, match.workspaceId, action, options);
        if (result.ok) applied.push(action);
        else if (result.warning) warnings.push(result.warning);
      }

      if (layoutDrifts.length && options.forceLayout) {
        const serial = yield* applyLayoutDriftsSerial(config, match.workspaceId, expected);
        applied.push(...serial.applied);
        warnings.push(...serial.warnings);
      }

      for (const action of deferredLayout) {
        if (action.type === "warn") {
          if (
            action.detail?.fixAgents &&
            options.fixAgents &&
            action.detail.role === "primary_slot"
          ) {
            const closed = closePane(config, action.target);
            if (!closed.ok) {
              warnings.push(closed.output || `failed to close ${action.target}`);
              continue;
            }
            const expectedAgent = String(action.detail.expectedAgent || "");
            if (expectedAgent) {
              const argv = resolveAgentArgv(expectedAgent);
              const started = startHerdrAgent(config, expectedAgent, argv, {
                workspaceId: match.workspaceId,
              });
              if (started.ok) {
                applied.push({
                  type: "start_agent",
                  target: expectedAgent,
                  reason: `respawned primary after closing ${action.target}`,
                });
              } else {
                warnings.push(started.error || `failed to start ${expectedAgent}`);
              }
            }
          } else {
            warnings.push(action.reason);
          }
          continue;
        }

        const result = yield* applyReconcileAction(config, match.workspaceId, action, options);
        if (result.ok) applied.push(action);
        else if (result.warning) warnings.push(result.warning);
      }
    } else {
      for (const action of actions) {
        if (action.type === "warn") warnings.push(action.reason);
        if (action.type === "apply_layout") {
          warnings.push(
            `${action.reason} (pass --apply --force-layout to rebuild; scrollback will be lost)`
          );
        }
      }
    }

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      projectPath: config.projectPath || "",
      configPath: config.sourcePath,
      workspaceId: match.workspaceId,
      dryRun: !options.apply,
      expected,
      actual,
      layoutDrifts,
      actions,
      applied,
      warnings,
      drift: actionable.length > 0 || actions.some((action) => action.type === "warn"),
    };
  });
}
