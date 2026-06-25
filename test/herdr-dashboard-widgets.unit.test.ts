import { describe, expect, test } from "bun:test";
import { TtlCache } from "../src/lib/cache.ts";
import type { DashboardMetaDiscovery } from "../src/lib/herdr-dashboard/discovery/meta.ts";
import {
  DASHBOARD_WIDGET_IDS,
  fetchDashboardWidget,
  fetchDashboardWidgetStub,
  isDashboardWidgetId,
  type DashboardWidgetResponse,
  type DashboardWidgetRuntime,
} from "../src/lib/herdr-dashboard/widgets/widgets.ts";
import { REPO_ROOT } from "./helpers.ts";

const discovery = {
  herdrSession: "",
  herdrSessionLabel: "primary",
  mode: "workspace" as const,
  workspaceLabel: "kimi-toolchain",
  workspaceId: "wB",
  workspaceIdResolution: "single" as const,
  workspaceCandidateCount: 1,
  remoteHostsConfigured: 0,
  remoteHosts: {
    configured: 0,
    reachable: 0,
    hosts: [] as Array<{ label: string; reachable: boolean }>,
  },
  multiSessionEnabled: false,
  sessionsAvailable: [""],
  sessionCatalog: [{ session: "", label: "primary", host: "(local)", reachable: true }],
} satisfies DashboardMetaDiscovery;

describe("herdr-dashboard-widgets", () => {
  test("isDashboardWidgetId accepts known widget ids", () => {
    for (const id of DASHBOARD_WIDGET_IDS) {
      expect(isDashboardWidgetId(id)).toBe(true);
    }
    expect(isDashboardWidgetId("metrics")).toBe(false);
  });

  test("fetchDashboardWidgetStub labels primary session", () => {
    const payload = fetchDashboardWidgetStub("logs");
    expect(payload.ok).toBe(false);
    expect(payload.widget).toBe("logs");
    expect(payload.session).toBe("");
    expect(payload.sessionLabel).toBe("primary");
    expect(payload.available).toBe(false);
  });

  test("fetchDashboardWidgetStub preserves named session", () => {
    const payload = fetchDashboardWidgetStub("git", { session: "staging" });
    expect(payload.session).toBe("staging");
    expect(payload.sessionLabel).toBe("staging");
  });

  test("fetchDashboardWidget routes processes and caches second hit", async () => {
    let calls = 0;
    const cache = new TtlCache<DashboardWidgetResponse>({ ttlMs: 60_000 });
    const runtime: DashboardWidgetRuntime = {
      discovery,
      ttlMs: 60_000,
      cache,
      processesDeps: {
        listLocalPanes: () => {
          calls += 1;
          return {
            ok: true as const,
            panes: [
              {
                paneId: "1-1",
                tabId: "1-1",
                workspaceId: "wB",
                focused: false,
                agent: "kimi",
                agentStatus: "idle",
                title: "main",
                cwd: REPO_ROOT,
                isShell: false,
              },
            ],
          };
        },
      },
    };

    const first = await fetchDashboardWidget("processes", REPO_ROOT, { session: "" }, runtime);
    const second = await fetchDashboardWidget("processes", REPO_ROOT, { session: "" }, runtime);
    expect(first.available).toBe(true);
    expect(second.available).toBe(true);
    expect(calls).toBe(1);
  });

  test("fetchDashboardWidget routes logs without cache", async () => {
    let calls = 0;
    const runtime: DashboardWidgetRuntime = {
      discovery,
      ttlMs: 5000,
      logsDeps: {
        readLocalPane: () => {
          calls += 1;
          return { ok: true as const, text: "tick\n" };
        },
      },
    };

    const first = await fetchDashboardWidget(
      "logs",
      REPO_ROOT,
      { session: "", paneId: "1-1" },
      runtime
    );
    const second = await fetchDashboardWidget(
      "logs",
      REPO_ROOT,
      { session: "", paneId: "1-1" },
      runtime
    );
    expect(first.ok).toBe(true);
    if (first.ok && first.widget === "logs") {
      expect(first.lines).toEqual(["tick", ""]);
    }
    expect(second.ok).toBe(true);
    expect(calls).toBe(2);
  });

  test("fetchDashboardWidget routes git and caches second hit", async () => {
    let calls = 0;
    const cache = new TtlCache<DashboardWidgetResponse>({ ttlMs: 60_000 });
    const runtime: DashboardWidgetRuntime = {
      discovery,
      ttlMs: 60_000,
      cache,
      gitDeps: {
        readLocalGit: async () => {
          calls += 1;
          return {
            ok: true as const,
            data: {
              branch: "main",
              dirty: false,
              changedCount: 0,
              status: [],
              commits: [],
              commitLimit: 10,
            },
          };
        },
      },
    };

    const first = await fetchDashboardWidget("git", REPO_ROOT, { session: "" }, runtime);
    const second = await fetchDashboardWidget("git", REPO_ROOT, { session: "" }, runtime);
    expect(first.ok).toBe(true);
    if (first.ok && first.widget === "git") {
      expect(first.data.branch).toBe("main");
    }
    expect(second.ok).toBe(true);
    expect(calls).toBe(1);
  });
});
