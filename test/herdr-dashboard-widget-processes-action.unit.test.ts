import { describe, expect, test } from "bun:test";
import {
  buildPaneActionHerdrArgs,
  isPaneActionId,
  paneActionCommandSteps,
  paneActionSuccessMessage,
  runDashboardPaneAction,
} from "../src/lib/herdr-dashboard/widgets/processes-action.ts";
import { REPO_ROOT } from "./helpers.ts";

const primaryCatalog = [{ session: "", label: "primary", host: "(local)", reachable: true }];

describe("herdr-dashboard-widget-processes-action", () => {
  test("isPaneActionId accepts known actions", () => {
    expect(isPaneActionId("kill")).toBe(true);
    expect(isPaneActionId("focus")).toBe(true);
    expect(isPaneActionId("zoom")).toBe(true);
    expect(isPaneActionId("restart")).toBe(false);
  });

  test("buildPaneActionHerdrArgs maps kill to pane close", () => {
    expect(buildPaneActionHerdrArgs("kill", "wB:p1")).toEqual(["pane", "close", "wB:p1"]);
    expect(buildPaneActionHerdrArgs("zoom", "wB:p1")).toEqual([
      "pane",
      "zoom",
      "wB:p1",
      "--toggle",
    ]);
  });

  test("paneActionCommandSteps uses zoom on/off for focus", () => {
    expect(paneActionCommandSteps("focus", "wB:p1")).toEqual([
      ["pane", "zoom", "wB:p1", "--on"],
      ["pane", "zoom", "wB:p1", "--off"],
    ]);
    expect(paneActionCommandSteps("kill", "wB:p1")).toEqual([["pane", "close", "wB:p1"]]);
  });

  test("paneActionSuccessMessage describes outcome", () => {
    expect(paneActionSuccessMessage("kill", "wB:p1")).toBe("closed pane wB:p1");
    expect(paneActionSuccessMessage("focus", "wB:p1")).toBe("focused pane wB:p1");
  });

  test("runDashboardPaneAction requires paneId and action", async () => {
    const missingPane = await runDashboardPaneAction(REPO_ROOT, {
      action: "focus",
      catalog: primaryCatalog,
    });
    expect(missingPane.ok).toBe(false);
    if (!missingPane.ok) expect(missingPane.error).toBe("paneId required");

    const badAction = await runDashboardPaneAction(REPO_ROOT, {
      paneId: "wB:p1",
      action: "restart",
      catalog: primaryCatalog,
    });
    expect(badAction.ok).toBe(false);
    if (!badAction.ok) expect(badAction.error).toContain("unknown action");
  });

  test("runDashboardPaneAction runs local focus", async () => {
    let calls = 0;
    const result = await runDashboardPaneAction(
      REPO_ROOT,
      { paneId: "wB:p6E", session: "", action: "focus", catalog: primaryCatalog },
      {
        runLocalPaneAction: () => {
          calls += 1;
          return { ok: true };
        },
      }
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toBe("focused pane wB:p6E");
    expect(calls).toBe(1);
  });

  test("runDashboardPaneAction surfaces CLI errors", async () => {
    const result = await runDashboardPaneAction(
      REPO_ROOT,
      { paneId: "wB:p1", session: "", action: "kill", catalog: primaryCatalog },
      {
        runLocalPaneAction: () => ({ ok: false, error: "pane close failed" }),
      }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("pane close failed");
  });
});
