import { describe, expect, test } from "bun:test";
import { createDashboardEventBus } from "../src/lib/herdr-dashboard/bus.ts";
import type { DashboardGateCheckPayload } from "../src/lib/herdr-dashboard/data/data.ts";
import {
  DASHBOARD_GATE_HEALTH_POLL_MS,
  handleDashboardGateHealthCheck,
  startDashboardGateHealthWatch,
} from "../src/lib/herdr-dashboard/gates/gate-watch.ts";

function gatePayload(
  overrides: Partial<DashboardGateCheckPayload> = {}
): DashboardGateCheckPayload {
  return {
    ok: true,
    failed: false,
    failures: [],
    total: 3,
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("herdr-dashboard-gate-watch", () => {
  test("DASHBOARD_GATE_HEALTH_POLL_MS matches browser overlay interval", () => {
    expect(DASHBOARD_GATE_HEALTH_POLL_MS).toBe(30_000);
  });

  test("handleDashboardGateHealthCheck seeds without emit when first check passes", () => {
    const state = {
      lastFailed: null as boolean | null,
      lastFailures: [] as Array<{ name: string; message: string }>,
    };
    const result = handleDashboardGateHealthCheck(gatePayload(), state);
    expect(result.emitted).toBeNull();
    expect(result.failed).toBe(false);
    expect(state.lastFailed).toBe(false);
  });

  test("handleDashboardGateHealthCheck emits gate:failed on first failing check", () => {
    const state = {
      lastFailed: null as boolean | null,
      lastFailures: [] as Array<{ name: string; message: string }>,
    };
    const result = handleDashboardGateHealthCheck(
      gatePayload({
        failed: true,
        failures: [{ name: "effect-gates", message: "violation" }],
      }),
      state
    );
    expect(result.emitted).toBe("gate:failed");
    expect(state.lastFailed).toBe(true);
  });

  test("handleDashboardGateHealthCheck emits gate:cleared on pass after failure", () => {
    const state = {
      lastFailed: true as boolean | null,
      lastFailures: [{ name: "effect-gates", message: "violation" }],
    };
    const result = handleDashboardGateHealthCheck(gatePayload(), state);
    expect(result.emitted).toBe("gate:cleared");
    expect(state.lastFailed).toBe(false);
    expect(state.lastFailures).toEqual([]);
  });

  test("handleDashboardGateHealthCheck re-emits gate:failed when failure set changes", () => {
    const state = {
      lastFailed: true as boolean | null,
      lastFailures: [{ name: "effect-gates", message: "a" }],
    };
    const result = handleDashboardGateHealthCheck(
      gatePayload({
        failed: true,
        failures: [{ name: "effect-gates", message: "b" }],
      }),
      state
    );
    expect(result.emitted).toBe("gate:failed");
  });

  test("startDashboardGateHealthWatch emits bus events from injected check", async () => {
    const bus = createDashboardEventBus();
    const events: Array<{ type: string; data: unknown }> = [];
    bus.on("gate:failed", (data) => events.push({ type: "gate:failed", data }));
    bus.on("gate:cleared", (data) => events.push({ type: "gate:cleared", data }));

    let calls = 0;
    const watch = startDashboardGateHealthWatch(bus, {
      projectPath: ".",
      pollMs: 60_000,
      check: async () => {
        calls += 1;
        if (calls === 1) {
          return gatePayload({
            failed: true,
            failures: [{ name: "effect-gates", message: "violation" }],
          });
        }
        return gatePayload();
      },
      log: () => {},
    });

    await Bun.sleep(30);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("gate:failed");
    expect(watch.state.lastFailed).toBe(true);
    watch.stop();
  });
});
