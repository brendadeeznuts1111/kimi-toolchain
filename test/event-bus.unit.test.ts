import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/lib/event-bus.ts";

type TestEvents = {
  ping: { n: number };
  pong: string;
};

describe("event-bus", () => {
  test("on/emit delivers payloads to subscribers", () => {
    const bus = new EventBus<TestEvents>();
    const seen: number[] = [];
    bus.on("ping", (payload) => {
      seen.push(payload.n);
    });
    bus.emit("ping", { n: 42 });
    expect(seen).toEqual([42]);
  });

  test("unsubscribe handle stops delivery", () => {
    const bus = new EventBus<TestEvents>();
    const seen: string[] = [];
    const off = bus.on("pong", (value) => {
      seen.push(value);
    });
    bus.emit("pong", "a");
    off();
    bus.emit("pong", "b");
    expect(seen).toEqual(["a"]);
  });

  test("enforces maxListeners per event", () => {
    const bus = new EventBus<TestEvents>({ maxListeners: 1 });
    bus.on("ping", () => {});
    expect(() => bus.on("ping", () => {})).toThrow(/max listeners/);
  });
});
