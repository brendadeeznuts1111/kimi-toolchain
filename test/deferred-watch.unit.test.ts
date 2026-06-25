import { afterEach, describe, expect, test } from "bun:test";
import { EventBus } from "../src/lib/event-bus.ts";
import { runDeferredWatch } from "../src/lib/deferred-watch.ts";

// ── Helpers ────────────────────────────────────────────────────────

interface TestEvents {
  "evt:a": { x: number };
  "evt:b": { y: string };
  "evt:c": { z: boolean };
  [key: string]: unknown;
}

function makeBus(): EventBus<TestEvents> {
  return new EventBus<TestEvents>();
}

interface StartStopLog {
  event: "start" | "stop";
  at: number;
}

function makeDeferredWatch(
  bus: EventBus<TestEvents>,
  events: string[],
  graceMs = 100
): { handle: ReturnType<typeof runDeferredWatch>; log: StartStopLog[] } {
  const log: StartStopLog[] = [];
  let seq = 0;
  const handle = runDeferredWatch({
    bus: bus as any,
    events,
    pollIntervalMs: 10_000,
    gracePeriodMs: graceMs,
    onStart: () => log.push({ event: "start", at: seq++ }),
    onStop: () => log.push({ event: "stop", at: seq++ }),
  });
  return { handle, log };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("deferred-watch", () => {
  let bus: EventBus<TestEvents>;
  let handle: ReturnType<typeof runDeferredWatch>;
  let log: StartStopLog[];

  afterEach(() => {
    if (handle && !handle.state) return;
    try {
      handle?.dispose();
    } catch {
      // ignore
    }
  });

  test("starts idle", () => {
    bus = makeBus();
    ({ handle, log } = makeDeferredWatch(bus, ["evt:a"]));
    expect(handle.state).toBe("idle");
    expect(log).toEqual([]);
  });

  test("transitions idle → running on first subscriber", () => {
    bus = makeBus();
    ({ handle, log } = makeDeferredWatch(bus, ["evt:a"]));
    const unsub = bus.on("evt:a", () => {});
    expect(handle.state).toBe("running");
    expect(log).toEqual([{ event: "start", at: 0 }]);
    unsub();
  });

  test("transitions running → grace → idle after last unsubscriber", async () => {
    bus = makeBus();
    ({ handle, log } = makeDeferredWatch(bus, ["evt:a"], 50));
    const unsub = bus.on("evt:a", () => {});
    expect(handle.state).toBe("running");
    unsub();
    expect(handle.state).toBe("grace");
    expect(log).toEqual([{ event: "start", at: 0 }]);

    await Bun.sleep(80);
    expect(handle.state).toBe("idle");
    expect(log).toEqual([
      { event: "start", at: 0 },
      { event: "stop", at: 1 },
    ]);
  });

  test("grace timer resets on re-subscribe during grace", async () => {
    bus = makeBus();
    ({ handle, log } = makeDeferredWatch(bus, ["evt:a"], 100));
    const unsub1 = bus.on("evt:a", () => {});
    unsub1();
    expect(handle.state).toBe("grace");

    await Bun.sleep(30);
    const unsub2 = bus.on("evt:a", () => {});
    expect(handle.state).toBe("running");
    expect(log).toEqual([
      { event: "start", at: 0 },
      { event: "start", at: 1 },
    ]);

    unsub2();
    await Bun.sleep(130);
    expect(handle.state).toBe("idle");
    expect(log).toEqual([
      { event: "start", at: 0 },
      { event: "start", at: 1 },
      { event: "stop", at: 2 },
    ]);
  });

  test("non-target events do not affect subscriber count", () => {
    bus = makeBus();
    ({ handle, log } = makeDeferredWatch(bus, ["evt:a"]));
    const unsub = bus.on("evt:b", () => {});
    expect(handle.state).toBe("idle");
    expect(log).toEqual([]);
    unsub();
    expect(handle.state).toBe("idle");
  });

  test("multiple target events aggregate subscriber count", () => {
    bus = makeBus();
    ({ handle, log } = makeDeferredWatch(bus, ["evt:a", "evt:b"]));
    const unsubA = bus.on("evt:a", () => {});
    expect(handle.state).toBe("running");

    const unsubB = bus.on("evt:b", () => {});
    expect(handle.state).toBe("running");

    unsubA();
    expect(handle.state).toBe("running");

    unsubB();
    expect(handle.state).toBe("grace");

    unsubA();
    unsubB();
  });

  test("manual start() bypasses subscriber check", () => {
    bus = makeBus();
    ({ handle, log } = makeDeferredWatch(bus, ["evt:a"]));
    handle.start();
    expect(handle.state).toBe("running");
    expect(log).toEqual([{ event: "start", at: 0 }]);
    handle.start();
    expect(log).toHaveLength(1);
  });

  test("manual stop() bypasses grace and stops immediately", () => {
    bus = makeBus();
    ({ handle, log } = makeDeferredWatch(bus, ["evt:a"]));
    const unsub = bus.on("evt:a", () => {});
    expect(handle.state).toBe("running");
    handle.stop();
    expect(handle.state).toBe("idle");
    expect(log).toEqual([
      { event: "start", at: 0 },
      { event: "stop", at: 1 },
    ]);
    handle.stop();
    expect(log).toHaveLength(2);
    unsub();
  });

  test("dispose() restores original bus.on and calls onStop if running", () => {
    bus = makeBus();
    ({ handle, log } = makeDeferredWatch(bus, ["evt:a"]));
    const unsub = bus.on("evt:a", () => {});
    expect(handle.state).toBe("running");

    handle.dispose();
    expect(handle.state).toBe("idle");
    expect(log).toEqual([
      { event: "start", at: 0 },
      { event: "stop", at: 1 },
    ]);

    bus.on("evt:a", () => {});
    expect(log).toHaveLength(2);

    unsub();
  });

  test("dispose() when idle is a no-op for callbacks", () => {
    bus = makeBus();
    ({ handle, log } = makeDeferredWatch(bus, ["evt:a"]));
    handle.dispose();
    expect(handle.state).toBe("idle");
    expect(log).toEqual([]);
  });

  test("multiple subscribers on same event — only stops after last unsubscribes", async () => {
    bus = makeBus();
    ({ handle, log } = makeDeferredWatch(bus, ["evt:a"], 50));
    const unsub1 = bus.on("evt:a", () => {});
    const unsub2 = bus.on("evt:a", () => {});
    expect(handle.state).toBe("running");
    expect(log).toEqual([{ event: "start", at: 0 }]);

    unsub1();
    expect(handle.state).toBe("running");
    unsub2();
    expect(handle.state).toBe("grace");

    await Bun.sleep(80);
    expect(handle.state).toBe("idle");
    expect(log).toEqual([
      { event: "start", at: 0 },
      { event: "stop", at: 1 },
    ]);
  });

  test("start() during grace cancels the timer and stays running", async () => {
    bus = makeBus();
    ({ handle, log } = makeDeferredWatch(bus, ["evt:a"], 100));
    const unsub = bus.on("evt:a", () => {});
    unsub();
    expect(handle.state).toBe("grace");

    handle.start();
    expect(handle.state).toBe("running");
    expect(log).toEqual([
      { event: "start", at: 0 },
      { event: "start", at: 1 },
    ]);

    await Bun.sleep(120);
    expect(handle.state).toBe("running");
  });
});
