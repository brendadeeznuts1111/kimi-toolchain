/** @description Card probe helpers and snapshot types. */

import { describe, expect, test } from "bun:test";
import {
  countUnhealthy,
  dashboardStatusToProbe,
  displayCardId,
  type CardStatus,
} from "../src/lib/card-probe.ts";

describe("card-probe", () => {
  test("displayCardId strips card- prefix", () => {
    expect(displayCardId("card-trace")).toBe("trace");
    expect(displayCardId("perf")).toBe("perf");
  });

  test("dashboardStatusToProbe maps statuses", () => {
    expect(dashboardStatusToProbe("ok")).toBe("pass");
    expect(dashboardStatusToProbe("pending")).toBe("unknown");
    expect(dashboardStatusToProbe("unknown")).toBe("unknown");
    expect(dashboardStatusToProbe("error")).toBe("fail");
  });

  test("countUnhealthy counts non-pass cards", () => {
    const statuses: CardStatus[] = [
      { cardId: "a", source: "examples", status: "pass", lastUpdated: "2024-01-01T00:00:00Z" },
      { cardId: "b", source: "examples", status: "fail", lastUpdated: "2024-01-01T00:00:00Z" },
      { cardId: "c", source: "herdr", status: "unknown", lastUpdated: "2024-01-01T00:00:00Z" },
    ];
    expect(countUnhealthy(statuses)).toBe(2);
  });
});
