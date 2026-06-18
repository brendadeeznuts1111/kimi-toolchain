import { describe, expect, test } from "bun:test";
import {
  FIX_SOCKET_KILL_WAIT_MS,
  FIX_SOCKET_STOP_TIMEOUT_MS,
  executeFixSocketLive,
  type FixSocketLiveDeps,
} from "../src/lib/herdr-fix-socket-live.ts";

const SERVER_CMD = "/opt/homebrew/opt/herdr/bin/herdr server";

function mockDeps(
  overrides: Partial<FixSocketLiveDeps> & {
    stop?: FixSocketLiveDeps["runCommand"] extends (...a: infer A) => infer R
      ? (...a: A) => R
      : never;
    alive?: Set<number>;
    kills?: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }>;
    statusSequence?: Array<{ running: boolean; output: string }>;
    probeSequence?: Array<ReturnType<FixSocketLiveDeps["probeProcesses"]>>;
  }
): FixSocketLiveDeps {
  const alive = overrides.alive ?? new Set([42]);
  const kills: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }> = overrides.kills ?? [];
  let statusIdx = 0;
  const statusSequence = overrides.statusSequence ?? [
    { running: true, output: "status: running" },
    { running: false, output: "status: not running" },
    { running: false, output: "status: not running" },
  ];
  let probeIdx = 0;
  const probeSequence = overrides.probeSequence ?? [
    {
      processes: [{ pid: 42, command: SERVER_CMD }],
      pgrepCommand: "pgrep -fl herdr server",
      raw: `42 ${SERVER_CMD}`,
    },
    {
      processes: [{ pid: 42, command: SERVER_CMD }],
      pgrepCommand: "pgrep -fl herdr server",
      raw: `42 ${SERVER_CMD}`,
    },
  ];

  return {
    runCommand:
      overrides.stop ??
      overrides.runCommand ??
      (async () => ({ ok: true, timedOut: false, exitCode: 0, output: "stopped" })),
    probeProcesses: () => probeSequence[Math.min(probeIdx++, probeSequence.length - 1)]!,
    getServerStatus: async () => statusSequence[Math.min(statusIdx++, statusSequence.length - 1)]!,
    isPidAlive: (pid) => alive.has(pid),
    killPid: (pid, signal) => {
      kills.push({ pid, signal });
      if (signal === "SIGKILL") alive.delete(pid);
      if (signal === "SIGTERM") alive.delete(pid);
      return { ok: true };
    },
    sleep: async () => {},
    ...overrides,
  };
}

describe("herdr-fix-socket-live", () => {
  test("stop timeout proceeds to SIGTERM escalation", async () => {
    const kills: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }> = [];
    const deps = mockDeps({
      kills,
      stop: async (_cmd, timeoutMs) => ({
        ok: false,
        timedOut: true,
        exitCode: null,
        output: `timed out after ${timeoutMs}`,
      }),
    });

    const result = await executeFixSocketLive(
      {
        code: "EAGAIN",
        socketPath: "/tmp/herdr.sock",
        serverRunningBefore: true,
        pgrepBefore: [{ pid: 42, command: SERVER_CMD }],
      },
      deps
    );

    expect(result.stopResult.timedOut).toBe(true);
    expect(kills.some((k) => k.signal === "SIGTERM" && k.pid === 42)).toBe(true);
    expect(result.actions.find((a) => a.phase === "graceful_stop")?.outcome).toBe("timed_out");
  });

  test("stop succeeds but PID alive triggers SIGTERM then SIGKILL", async () => {
    const kills: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }> = [];
    const alive = new Set([42]);
    const deps = mockDeps({
      kills,
      alive,
      killPid: (pid, signal) => {
        kills.push({ pid, signal });
        if (signal === "SIGTERM") return { ok: true };
        if (signal === "SIGKILL") {
          alive.delete(pid);
          return { ok: true };
        }
        return { ok: false };
      },
      isPidAlive: (pid) => alive.has(pid),
      sleep: async () => {
        // survive SIGTERM until SIGKILL
      },
    });

    await executeFixSocketLive(
      {
        code: "EAGAIN",
        socketPath: "/tmp/herdr.sock",
        serverRunningBefore: true,
        pgrepBefore: [{ pid: 42, command: SERVER_CMD }],
      },
      deps
    );

    expect(kills.map((k) => k.signal)).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("stop succeeds and PID gone skips destructive kills", async () => {
    const kills: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }> = [];
    const deps = mockDeps({
      kills,
      alive: new Set(),
      probeSequence: [
        {
          processes: [{ pid: 42, command: SERVER_CMD }],
          pgrepCommand: "pgrep -fl herdr server",
          raw: `42 ${SERVER_CMD}`,
        },
        { processes: [], pgrepCommand: "pgrep -fl herdr server", raw: "" },
      ],
    });

    const result = await executeFixSocketLive(
      {
        code: "EAGAIN",
        socketPath: "/tmp/herdr.sock",
        serverRunningBefore: true,
        pgrepBefore: [{ pid: 42, command: SERVER_CMD }],
      },
      deps
    );

    expect(kills).toHaveLength(0);
    expect(result.actions.some((a) => a.phase === "kill_skip" || a.outcome === "skipped")).toBe(
      true
    );
  });

  test("new PID after stop (supervisor respawn) aborts kill", async () => {
    const kills: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }> = [];
    const deps = mockDeps({
      kills,
      probeSequence: [
        {
          processes: [{ pid: 99, command: SERVER_CMD }],
          pgrepCommand: "pgrep -fl herdr server",
          raw: `99 ${SERVER_CMD}`,
        },
      ],
    });

    const result = await executeFixSocketLive(
      {
        code: "EAGAIN",
        socketPath: "/tmp/herdr.sock",
        serverRunningBefore: true,
        pgrepBefore: [{ pid: 42, command: SERVER_CMD }],
      },
      deps
    );

    expect(kills).toHaveLength(0);
    expect(
      result.actions.some((a) => a.outcome === "aborted" && a.detail?.includes("pre-stop snapshot"))
    ).toBe(true);
  });

  test("PID cmdline mismatch after stop aborts kill", async () => {
    const kills: Array<{ pid: number; signal: "SIGTERM" | "SIGKILL" }> = [];
    const deps = mockDeps({
      kills,
      // executeFixSocketLive probes once after stop — first entry is the post-stop snapshot
      probeSequence: [
        {
          processes: [{ pid: 42, command: "herdr server stop" }],
          pgrepCommand: "pgrep -fl herdr server",
          raw: "42 herdr server stop",
        },
      ],
    });

    const result = await executeFixSocketLive(
      {
        code: "EAGAIN",
        socketPath: "/tmp/herdr.sock",
        serverRunningBefore: true,
        pgrepBefore: [{ pid: 42, command: SERVER_CMD }],
      },
      deps
    );

    expect(kills).toHaveLength(0);
    expect(result.actions.some((a) => a.outcome === "aborted")).toBe(true);
  });

  test("constants match scoped contract", () => {
    expect(FIX_SOCKET_STOP_TIMEOUT_MS).toBe(10_000);
    expect(FIX_SOCKET_KILL_WAIT_MS).toBe(5_000);
  });
});
