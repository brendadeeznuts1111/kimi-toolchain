import { describe, expect, test } from "bun:test";
import {
  applyLogsSinceOffset,
  clampLogsWidgetLines,
  fetchDashboardLogsWidget,
  LOGS_WIDGET_DEFAULT_LINES,
  LOGS_WIDGET_MAX_LINES,
  logsWidgetHasMore,
  splitPaneLogText,
} from "../src/lib/herdr-dashboard-widget-logs.ts";
import { REPO_ROOT } from "./helpers.ts";

const primaryCatalog = [{ session: "", label: "primary", host: "(local)", reachable: true }];

describe("herdr-dashboard-widget-logs", () => {
  test("clampLogsWidgetLines defaults and clamps", () => {
    expect(clampLogsWidgetLines(undefined)).toBe(LOGS_WIDGET_DEFAULT_LINES);
    expect(clampLogsWidgetLines(0)).toBe(1);
    expect(clampLogsWidgetLines(999)).toBe(LOGS_WIDGET_MAX_LINES);
    expect(clampLogsWidgetLines(75)).toBe(75);
  });

  test("splitPaneLogText normalizes CRLF and trailing newline", () => {
    expect(splitPaneLogText("")).toEqual([]);
    expect(splitPaneLogText("a\r\nb\nc\n")).toEqual(["a", "b", "c", ""]);
  });

  test("applyLogsSinceOffset returns incremental tail slices", () => {
    const all = ["a", "b", "c", "d"];
    expect(applyLogsSinceOffset(all, undefined, 50)).toEqual({
      lines: all,
      totalLines: 4,
      hasMore: false,
      paneRestarted: false,
      sinceApplied: 0,
    });
    expect(applyLogsSinceOffset(all, 2, 50)).toEqual({
      lines: ["c", "d"],
      totalLines: 4,
      hasMore: false,
      paneRestarted: false,
      sinceApplied: 2,
    });
    expect(applyLogsSinceOffset(all, 4, 50)).toEqual({
      lines: [],
      totalLines: 4,
      hasMore: false,
      paneRestarted: false,
      sinceApplied: 4,
    });
    expect(applyLogsSinceOffset(["x", "y"], 5, 50).paneRestarted).toBe(true);
    expect(applyLogsSinceOffset(["x", "y"], 5, 50).lines).toEqual(["x", "y"]);
  });

  test("logsWidgetHasMore when scrollback hits requested window", () => {
    expect(logsWidgetHasMore(50, 50)).toBe(true);
    expect(logsWidgetHasMore(50, 200)).toBe(false);
    expect(logsWidgetHasMore(10, 50)).toBe(false);
  });

  test("fetchDashboardLogsWidget requires paneId", async () => {
    const result = await fetchDashboardLogsWidget(REPO_ROOT, {
      session: "",
      catalog: primaryCatalog,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("paneId required");
  });

  test("fetchDashboardLogsWidget rejects unknown session", async () => {
    const result = await fetchDashboardLogsWidget(REPO_ROOT, {
      session: "staging",
      paneId: "1-1",
      catalog: primaryCatalog,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not in catalog");
  });

  test("fetchDashboardLogsWidget returns pane lines for primary session", async () => {
    const result = await fetchDashboardLogsWidget(
      REPO_ROOT,
      { session: "", paneId: "wB:p6E", lines: 50, catalog: primaryCatalog },
      {
        readLocalPane: (paneId, session, lines) => {
          expect(paneId).toBe("wB:p6E");
          expect(session).toBe("");
          expect(lines).toBe(50);
          return { ok: true, text: "hello\nworld\n" };
        },
      }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.widget).toBe("logs");
      expect(result.paneId).toBe("wB:p6E");
      expect(result.lines).toEqual(["hello", "world", ""]);
      expect(result.lineCount).toBe(3);
      expect(result.totalLines).toBe(3);
      expect(result.hasMore).toBe(false);
      expect(result.requestedLines).toBe(50);
      expect(result.paneRestarted).toBe(false);
    }
  });

  test("fetchDashboardLogsWidget returns empty lines when since catches up", async () => {
    const result = await fetchDashboardLogsWidget(
      REPO_ROOT,
      { session: "", paneId: "1-1", lines: 50, since: 4, catalog: primaryCatalog },
      {
        readLocalPane: () => ({ ok: true, text: "a\nb\nc\n" }),
      }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines).toEqual([]);
      expect(result.totalLines).toBe(4);
      expect(result.sinceApplied).toBe(4);
    }
  });

  test("fetchDashboardLogsWidget surfaces read errors", async () => {
    const result = await fetchDashboardLogsWidget(
      REPO_ROOT,
      { session: "", paneId: "1-1", catalog: primaryCatalog },
      {
        readLocalPane: () => ({ ok: false, error: "pane read failed" }),
      }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("pane read failed");
  });
});
