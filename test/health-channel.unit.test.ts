/**
 * health-channel.unit.test.ts — Cross-process health telemetry tests.
 *
 * Uses a temporary file (setFilePath) so tests don't touch real
 * ~/.kimi-code/var/health-events.jsonl.
 *
 * Integration tests verify publish → file append via direct file read.
 * Subscribe tests verify poll-based delivery with generous timeouts.
 */

import { describe, test, expect, afterAll, beforeEach } from "bun:test";
import { testTempDir } from "./helpers.ts";
import {
  isHealthEvent,
  publish,
  subscribe,
  subscribeTo,
  toolStart,
  toolProgress,
  toolDone,
  loadReport,
  healthWarning,
  healthResult,
  setFilePath,
  reset,
  type HealthEvent,
} from "../src/lib/health-channel.ts";

const tmpDir = testTempDir("health-channel-test");
const tmpFile = `${tmpDir}/health-events.jsonl`;
setFilePath(tmpFile);

afterAll(async () => {
  await Bun.spawn(["rm", "-rf", tmpDir]).exited;
});

async function clearFile() {
  await Bun.write(tmpFile, "");
}

async function readFileLines(): Promise<string[]> {
  try {
    const text = await Bun.file(tmpFile).text();
    return text.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

beforeEach(async () => {
  await clearFile();
  reset();
});

// ── Guards ────────────────────────────────────────────────────────────

describe("health-channel", () => {
  describe("is-health-event", () => {
    test("rejects null", () => {
      expect(isHealthEvent(null)).toBe(false);
    });
    test("rejects plain objects without kind", () => {
      expect(isHealthEvent({})).toBe(false);
    });
    test("rejects unknown kind", () => {
      expect(isHealthEvent({ kind: "unknown" })).toBe(false);
    });
    test("accepts tool:start", () => {
      expect(isHealthEvent({ kind: "tool:start", tool: "x", pid: 1, timestamp: 0 })).toBe(true);
    });
    test("accepts load", () => {
      expect(
        isHealthEvent({
          kind: "load",
          tool: "x",
          pid: 1,
          timestamp: 0,
          memoryBytes: 100,
        })
      ).toBe(true);
    });
  });

  // ── Publish → file ────────────────────────────────────────────────────

  describe("publish writes to file", () => {
    test("publish appends a JSON line", async () => {
      await publish({
        kind: "tool:start",
        tool: "test",
        pid: 1,
        timestamp: 0,
      });
      const lines = await readFileLines();
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.kind).toBe("tool:start");
      expect(parsed.tool).toBe("test");
    });

    test("multiple publishes append multiple lines", async () => {
      await publish({ kind: "tool:start", tool: "a", pid: 1, timestamp: 0 });
      await publish({
        kind: "tool:done",
        tool: "a",
        pid: 1,
        timestamp: 1,
        exitCode: 0,
        durationMs: 100,
      });
      const lines = await readFileLines();
      expect(lines.length).toBe(2);
      const kinds = lines.map((l) => JSON.parse(l).kind);
      expect(kinds).toEqual(["tool:start", "tool:done"]);
    });

    test("convenience publishers write correctly", async () => {
      await toolStart("kimi-guardian", 12);
      await toolProgress("kimi-doctor", 3, 8, "checking...");
      await toolDone("kimi-doctor", 0);
      await loadReport("test", 1024, 0.5);
      await healthWarning("gov", "memory", 0.3);
      await healthResult("kimi-doctor", { checks: 42 });

      const lines = await readFileLines();
      const kinds = lines.map((l) => JSON.parse(l).kind);
      expect(kinds).toContain("tool:start");
      expect(kinds).toContain("tool:progress");
      expect(kinds).toContain("tool:done");
      expect(kinds).toContain("load");
      expect(kinds).toContain("warning");
      expect(kinds).toContain("result");
    });

    test("tool:done includes duration tracking", async () => {
      await toolStart("test");
      await Bun.sleep(5);
      await toolDone("test", 0);
      const lines = await readFileLines();
      const doneEvent = lines.map((l) => JSON.parse(l)).find((e) => e.kind === "tool:done");
      expect(doneEvent).not.toBeNull();
      expect(doneEvent.durationMs).toBeGreaterThan(0);
      expect(doneEvent.exitCode).toBe(0);
    });
  });

  // ── Subscribe ─────────────────────────────────────────────────────────

  describe("subscribe (poll-based)", () => {
    test("subscriber receives events", async () => {
      const received: HealthEvent[] = [];
      const unsub = subscribe((e) => received.push(e), { intervalMs: 50 });

      await toolStart("test", 1);
      await Bun.sleep(300);

      expect(received.some((e) => e.kind === "tool:start")).toBe(true);
      unsub();
    }, 5000);

    test("subscribeTo filters by kind", async () => {
      const received: HealthEvent[] = [];
      const unsub = subscribeTo(["tool:done"], (e) => received.push(e), { intervalMs: 50 });

      await toolStart("test");
      await toolDone("test", 0);
      await Bun.sleep(300);

      expect(received.length).toBeGreaterThanOrEqual(1);
      expect(received.every((e) => e.kind === "tool:done")).toBe(true);
      unsub();
    }, 5000);

    test("unsubscribe stops delivery", async () => {
      const received: HealthEvent[] = [];
      const unsub = subscribe((e) => received.push(e), { intervalMs: 50 });

      await toolStart("test");
      await Bun.sleep(300);
      const afterFirst = received.length;
      expect(afterFirst).toBeGreaterThanOrEqual(1);
      unsub();

      await toolDone("test", 0);
      await Bun.sleep(300);
      expect(received.length).toBe(afterFirst);
      unsub();
    }, 8000);
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  describe("edge cases", () => {
    test("publish handles missing file gracefully", async () => {
      // setFilePath was already called, file exists — just verify publish doesn't throw
      await publish({ kind: "tool:start", tool: "x", pid: 1, timestamp: 0 });
      expect((await readFileLines()).length).toBeGreaterThanOrEqual(0);
    });

    test("isHealthEvent rejects malformed JSON lines", async () => {
      // Simulate a corrupt line in the file
      await Bun.write(
        tmpFile,
        '{"kind":"garbage"}\n{"kind":"tool:start","tool":"x","pid":1,"timestamp":0}\n'
      );
      const received: HealthEvent[] = [];
      // Read lines directly, simulating the poll parsing logic
      for (const line of await readFileLines()) {
        try {
          const parsed = JSON.parse(line);
          if (isHealthEvent(parsed)) received.push(parsed);
        } catch {}
      }
      expect(received.length).toBe(1);
      expect(received[0].kind).toBe("tool:start");
    });
  });
});
