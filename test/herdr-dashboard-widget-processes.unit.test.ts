import { describe, expect, test } from "bun:test";
import { buildDashboardWidgetCacheKey } from "../src/lib/herdr-dashboard-widgets.ts";
import {
  findDashboardWidgetSessionEntry,
  resolveDashboardWidgetSession,
} from "../src/lib/herdr-dashboard-widget-session.ts";
import {
  fetchDashboardProcessesWidget,
  mapPaneInfoToWidgetRow,
  parseHerdrPaneListOutput,
  PROCESSES_WIDGET_WORKSPACE_SCOPE,
} from "../src/lib/herdr-dashboard-widget-processes.ts";
import { REPO_ROOT } from "./helpers.ts";

const samplePane = {
  paneId: "1-1",
  tabId: "1-1",
  workspaceId: "wB",
  focused: true,
  agent: "kimi",
  agentStatus: "working",
  title: "agent",
  cwd: "/tmp/proj",
  isShell: false,
};

describe("herdr-dashboard-widget-processes", () => {
  test("buildDashboardWidgetCacheKey uses workspace scope star for v1", () => {
    expect(
      buildDashboardWidgetCacheKey("processes", "/proj", "", PROCESSES_WIDGET_WORKSPACE_SCOPE)
    ).toBe("processes|/proj||*");
  });

  test("resolveDashboardWidgetSession rejects unknown session", () => {
    const result = resolveDashboardWidgetSession("staging", [
      { session: "", label: "primary", host: "(local)", reachable: true },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not in catalog");
  });

  test("resolveDashboardWidgetSession rejects unreachable session", () => {
    const result = resolveDashboardWidgetSession("staging", [
      {
        session: "staging",
        label: "staging",
        host: "mac-mini",
        reachable: false,
        error: "timeout",
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("timeout");
  });

  test("findDashboardWidgetSessionEntry falls back to primary when catalog empty", () => {
    const entry = findDashboardWidgetSessionEntry("", undefined);
    expect(entry?.session).toBe("");
    expect(entry?.reachable).toBe(true);
  });

  test("parseHerdrPaneListOutput maps pane list JSON", () => {
    const parsed = parseHerdrPaneListOutput(
      JSON.stringify({
        result: {
          panes: [
            {
              pane_id: "1-2",
              tab_id: "1-1",
              workspace_id: "wB",
              focused: false,
              agent: "reviewer",
              agent_status: "idle",
              title: "review",
              cwd: "/repo",
            },
          ],
        },
      })
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.panes[0]?.paneId).toBe("1-2");
      expect(parsed.panes[0]?.agent).toBe("reviewer");
    }
  });

  test("fetchDashboardProcessesWidget returns panes for primary session", async () => {
    const result = await fetchDashboardProcessesWidget(
      REPO_ROOT,
      {
        session: "",
        catalog: [{ session: "", label: "primary", host: "(local)", reachable: true }],
      },
      {
        listLocalPanes: () => ({ ok: true, panes: [samplePane] }),
      }
    );
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.data.paneCount).toBe(1);
      expect(result.data.panes[0]).toEqual(mapPaneInfoToWidgetRow(samplePane));
    }
  });

  test("fetchDashboardProcessesWidget surfaces list errors", async () => {
    const result = await fetchDashboardProcessesWidget(
      REPO_ROOT,
      {
        session: "",
        catalog: [{ session: "", label: "primary", host: "(local)", reachable: true }],
      },
      {
        listLocalPanes: () => ({ ok: false, error: "pane list failed" }),
      }
    );
    expect(result.available).toBe(false);
    if (!result.available) expect(result.error).toBe("pane list failed");
  });
});
