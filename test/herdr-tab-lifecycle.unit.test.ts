import { describe, expect, test } from "bun:test";
import { buildPaneInterruptArgs, panesWithAgentsOnTab } from "../src/lib/herdr-tab-lifecycle.ts";

describe("herdr-tab-lifecycle", () => {
  test("panesWithAgentsOnTab returns only agent panes on the target tab", () => {
    const panes = [
      { paneId: "wB:p1", tabId: "wB:t1", agent: "test-agent" },
      { paneId: "wB:p2", tabId: "wB:t1", agent: null },
      { paneId: "wB:p3", tabId: "wB:t2", agent: "kimi" },
    ];
    expect(panesWithAgentsOnTab(panes, "wB:t1").map((row) => row.paneId)).toEqual(["wB:p1"]);
  });

  test("buildPaneInterruptArgs sends ctrl+c to the pane", () => {
    expect(buildPaneInterruptArgs("wB:p5J")).toEqual(["pane", "send-keys", "wB:p5J", "ctrl+c"]);
  });
});
