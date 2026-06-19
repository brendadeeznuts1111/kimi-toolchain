import { describe, expect, test } from "bun:test";
import { createIsolation } from "../factory.ts";
import { isMessagePortIsolationAvailable, resetMessagePortProbeCache } from "../probe.ts";
import { getIsolationCapabilities } from "../index.ts";

describe("Isolation factory", () => {
  test("probe returns boolean", () => {
    const available = isMessagePortIsolationAvailable();
    expect(typeof available).toBe("boolean");
  });

  test("capabilities snapshot shape", () => {
    expect(getIsolationCapabilities()).toEqual({
      shadowRealm: expect.any(Boolean),
      worker: true,
      messagePort: expect.any(Boolean),
      resolvedEnv: expect.any(String),
    });
  });

  test("realm mode works", async () => {
    const iso = createIsolation("realm");
    expect(iso.mode).toBe("realm");
    expect(iso.available).toBe(true);
    const result = await iso.run(() => 42);
    expect(result).toBe(42);
  });

  test("worker mode works", async () => {
    const iso = createIsolation("worker");
    expect(iso.mode).toBe("worker");
    const result = await iso.run(() => 7 * 3);
    expect(result).toBe(21);
  });

  test("messageport mode or realm fallback", async () => {
    const iso = createIsolation("messageport");
    if (!isMessagePortIsolationAvailable()) {
      expect(iso.mode).toBe("realm");
      expect(iso.available).toBe(false);
      expect(await iso.evaluateScript("1 + 1")).toBe(2);
      return;
    }

    expect(iso.mode).toBe("messageport");
    expect(iso.available).toBe(true);
    expect(await iso.evaluateScript("4 + 4")).toBe(8);

    const ch = iso.createChannel();
    await new Promise<void>((resolve, reject) => {
      ch.hostPort.once("message", (msg) => {
        if (msg === "pong") resolve();
        else reject(new Error("unexpected ping reply"));
      });
      ch.hostPort.postMessage("ping");
    });
    ch.dispose();
  });

  test("probe cache can be reset", () => {
    resetMessagePortProbeCache();
    const first = isMessagePortIsolationAvailable();
    const second = isMessagePortIsolationAvailable();
    expect(first).toBe(second);
    resetMessagePortProbeCache();
  });
});
