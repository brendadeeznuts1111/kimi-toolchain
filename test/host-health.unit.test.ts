import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { RecoveryResult } from "../src/lib/host-health.ts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We must mock sshExec and homedir BEFORE the module loads (STATE_PATH is computed at import time).
const tempDir = mkdtempSync(join(tmpdir(), "host-health-test-"));

mock.module("node:os", () => ({
  ...require("node:os"),
  homedir: () => tempDir,
}));

// Controlled sshExec — we swap behavior per test via the mutable helper below.
let mockSshOk = true;

mock.module("../src/lib/herdr-orchestrator.ts", () => ({
  sshExec: () => ({
    ok: mockSshOk,
    output: mockSshOk ? "herdr 0.7.0\n" : "",
    code: mockSshOk ? 0 : 255,
  }),
}));

// ── Helpers ─────────────────────────────────────────────────────────────

const STATE_DIR = join(tempDir, ".herdr", "orchestrator");
const STATE_PATH = join(STATE_DIR, "host-state.json");

function writeState(data: Record<string, unknown>) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(data, null, 2), "utf8");
}

function clearState() {
  if (existsSync(STATE_PATH)) require("node:fs").unlinkSync(STATE_PATH);
}

// ── Dynamic import after mocks ──────────────────────────────────────────

let hostHealth: typeof import("../src/lib/host-health.ts");

beforeAll(async () => {
  hostHealth = await import("../src/lib/host-health.ts");
});

afterEach(() => {
  clearState();
  mockSshOk = true;
  // Clean up any leftover .tmp files
  const tmpPath = STATE_PATH + ".tmp";
  if (existsSync(tmpPath)) require("node:fs").unlinkSync(tmpPath);
});

// ── Tests ───────────────────────────────────────────────────────────────

describe("host-health", () => {
  const resolvedHost = {
    name: "testbox",
    host: "testbox.local",
    timeout: 15_000,
    batchMode: true,
    connectTimeout: 5,
    identitiesOnly: false,
    strictHostKeyChecking: "accept-new" as const,
    serverAliveInterval: 0,
    serverAliveCountMax: 3,
    controlMaster: "no" as const,
    compression: false,
    identityFileSource: "none" as const,
  };

  describe("checkHostHealth", () => {
    test("marks host alive on first successful check", () => {
      mockSshOk = true;
      const result = hostHealth.checkHostHealth("testbox", resolvedHost);
      expect(result.status).toBe("alive");
      expect(result.state.failureCount).toBe(0);
      expect(result.state.label).toBe("testbox");
    });

    test("transitions alive → degraded after threshold failures", () => {
      // Pre-seed state as alive with threshold-1 failures
      writeState({
        testbox: {
          label: "testbox",
          status: "alive",
          since: new Date().toISOString(),
          lastChecked: new Date().toISOString(),
          failureCount: 2,
        },
      });

      mockSshOk = false;
      const result = hostHealth.checkHostHealth("testbox", resolvedHost, 3);
      expect(result.status).toBe("degraded");
      expect(result.state.failureCount).toBe(3);
    });

    test("transitions degraded → dead after threshold*2 failures", () => {
      writeState({
        testbox: {
          label: "testbox",
          status: "degraded",
          since: new Date().toISOString(),
          lastChecked: new Date().toISOString(),
          failureCount: 5,
        },
      });

      mockSshOk = false;
      const result = hostHealth.checkHostHealth("testbox", resolvedHost, 3);
      expect(result.status).toBe("dead");
      expect(result.state.failureCount).toBe(6);
    });

    test("recovers dead → alive on success", () => {
      writeState({
        testbox: {
          label: "testbox",
          status: "dead",
          since: new Date().toISOString(),
          lastChecked: new Date().toISOString(),
          failureCount: 10,
        },
      });

      mockSshOk = true;
      const result = hostHealth.checkHostHealth("testbox", resolvedHost, 3);
      expect(result.status).toBe("alive");
      expect(result.state.failureCount).toBe(0);
    });

    test("recovers degraded → alive on success", () => {
      writeState({
        testbox: {
          label: "testbox",
          status: "degraded",
          since: new Date().toISOString(),
          lastChecked: new Date().toISOString(),
          failureCount: 4,
        },
      });

      mockSshOk = true;
      const result = hostHealth.checkHostHealth("testbox", resolvedHost, 3);
      expect(result.status).toBe("alive");
      expect(result.state.failureCount).toBe(0);
    });

    test("stays alive on repeated success", () => {
      mockSshOk = true;
      hostHealth.checkHostHealth("testbox", resolvedHost);
      mockSshOk = true;
      const result = hostHealth.checkHostHealth("testbox", resolvedHost);
      expect(result.status).toBe("alive");
      expect(result.state.failureCount).toBe(0);
    });

    test("stays degraded when below threshold*2", () => {
      writeState({
        testbox: {
          label: "testbox",
          status: "degraded",
          since: new Date().toISOString(),
          lastChecked: new Date().toISOString(),
          failureCount: 3,
        },
      });

      mockSshOk = false;
      const result = hostHealth.checkHostHealth("testbox", resolvedHost, 4);
      // threshold=4, threshold*2=8, failureCount becomes 4 → still degraded
      expect(result.status).toBe("degraded");
      expect(result.state.failureCount).toBe(4);
    });
  });

  describe("getHostState / getAllHostStates / clearHostState", () => {
    test("getHostState returns null for unknown host", () => {
      expect(hostHealth.getHostState("ghost")).toBeNull();
    });

    test("getHostState returns persisted state", () => {
      writeState({
        testbox: {
          label: "testbox",
          status: "alive",
          since: "2025-01-01T00:00:00.000Z",
          lastChecked: "2025-01-01T00:00:00.000Z",
          failureCount: 0,
        },
      });

      const state = hostHealth.getHostState("testbox");
      expect(state).not.toBeNull();
      expect(state!.status).toBe("alive");
      expect(state!.failureCount).toBe(0);
    });

    test("getAllHostStates returns all persisted hosts", () => {
      writeState({
        host1: { label: "host1", status: "alive", since: "", lastChecked: "", failureCount: 0 },
        host2: { label: "host2", status: "dead", since: "", lastChecked: "", failureCount: 10 },
      });

      const all = hostHealth.getAllHostStates();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all["host1"]!.status).toBe("alive");
      expect(all["host2"]!.status).toBe("dead");
    });

    test("clearHostState removes a host", () => {
      writeState({
        host1: { label: "host1", status: "alive", since: "", lastChecked: "", failureCount: 0 },
        host2: { label: "host2", status: "dead", since: "", lastChecked: "", failureCount: 10 },
      });

      hostHealth.clearHostState("host1");
      expect(hostHealth.getHostState("host1")).toBeNull();
      expect(hostHealth.getHostState("host2")).not.toBeNull();
    });
  });

  describe("recoveryEffect", () => {
    test("detects revived hosts (dead → alive)", async () => {
      writeState({
        testbox: {
          label: "testbox",
          status: "dead",
          since: new Date().toISOString(),
          lastChecked: new Date().toISOString(),
          failureCount: 10,
        },
      });

      mockSshOk = true;
      const program = hostHealth.recoveryEffect({ testbox: "testbox.local" });
      const results = await require("effect").Effect.runPromise(program);

      expect(results).toHaveLength(1);
      expect(results[0]!.host).toBe("testbox");
      expect(results[0]!.previousStatus).toBe("dead");
      expect(results[0]!.newStatus).toBe("alive");
      expect(results[0]!.revived).toBe(true);
    });

    test("detects degraded → alive recovery", async () => {
      writeState({
        testbox: {
          label: "testbox",
          status: "degraded",
          since: new Date().toISOString(),
          lastChecked: new Date().toISOString(),
          failureCount: 3,
        },
      });

      mockSshOk = true;
      const program = hostHealth.recoveryEffect({ testbox: "testbox.local" });
      const results = await require("effect").Effect.runPromise(program);

      const recovered = results.find(
        (r: RecoveryResult) => r.host === "testbox" && r.newStatus === "alive"
      );
      expect(recovered).toBeDefined();
      expect(recovered!.previousStatus).toBe("degraded");
      expect(recovered!.revived).toBe(true);
    });

    test("empty hosts returns empty results", async () => {
      const program = hostHealth.recoveryEffect({});
      const results = await require("effect").Effect.runPromise(program);
      expect(results).toHaveLength(0);
    });
  });
});
