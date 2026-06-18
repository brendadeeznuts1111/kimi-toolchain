/**
 * Live execution for herdr-doctor fix-socket — graceful stop with timeout,
 * status re-check, validated SIGTERM → SIGKILL escalation.
 */

import {
  buildHerdrSocketRecoveryPlan,
  isHerdrServerCommandLine,
  materializeHerdrSocketRecoveryPlan,
  probeHerdrServerProcesses,
  type HerdrCliProtocolErrorCode,
  type HerdrServerProcess,
} from "./herdr-cli-error.ts";
import { readableStreamToText } from "./bun-utils.ts";

export const FIX_SOCKET_STOP_TIMEOUT_MS = 10_000;
export const FIX_SOCKET_KILL_WAIT_MS = 5_000;
export const FIX_SOCKET_LIVE_TOTAL_TIMEOUT_MS = 30_000;

export type FixSocketCommandResult = {
  ok: boolean;
  timedOut: boolean;
  exitCode: number | null;
  output: string;
};

export type FixSocketLiveDeps = {
  runCommand: (cmd: string[], timeoutMs: number) => Promise<FixSocketCommandResult>;
  probeProcesses: () => {
    processes: HerdrServerProcess[];
    pgrepCommand: string;
    raw: string;
  };
  getServerStatus: () => Promise<{ running: boolean; output: string }>;
  isPidAlive: (pid: number) => boolean;
  killPid: (pid: number, signal: "SIGTERM" | "SIGKILL") => { ok: boolean; error?: string };
  sleep: (ms: number) => Promise<void>;
};

export type FixSocketLiveAction = {
  phase: string;
  command?: string;
  outcome: "ok" | "timed_out" | "failed" | "skipped" | "aborted";
  detail?: string;
};

export type FixSocketLiveExecution = {
  executed: true;
  actions: FixSocketLiveAction[];
  stopResult: FixSocketCommandResult;
  serverRunningAfterStop: boolean;
  serverStatusAfterStop: string;
  pgrepAfterStop: ReturnType<FixSocketLiveDeps["probeProcesses"]>;
  finalServerRunning: boolean;
  finalServerStatus: string;
};

export function parseHerdrServerStatusRunning(output: string): boolean {
  return /status:\s*running/i.test(output);
}

async function runCommandWithTimeout(
  cmd: string[],
  timeoutMs: number
): Promise<FixSocketCommandResult> {
  const proc = Bun.spawn({ cmd, stdout: "pipe", stderr: "pipe", env: { ...Bun.env } });
  let timedOut = false;
  const timeout = (async (): Promise<"timeout"> => {
    await Bun.sleep(timeoutMs);
    timedOut = true;
    try {
      proc.kill("SIGTERM");
    } catch {
      // already exited
    }
    return "timeout";
  })();
  const exit = (async () => {
    const code = await proc.exited;
    return { type: "exit" as const, code };
  })();
  const winner = await Promise.race([exit, timeout]);
  if (winner === "timeout") {
    await Bun.sleep(200);
    try {
      proc.kill("SIGKILL");
    } catch {
      // ignore
    }
    try {
      await proc.exited;
    } catch {
      // ignore
    }
    const output = await readSpawnOutput(proc);
    return { ok: false, timedOut: true, exitCode: null, output };
  }
  const output = await readSpawnOutput(proc);
  return {
    ok: winner.code === 0,
    timedOut,
    exitCode: winner.code,
    output,
  };
}

export function defaultFixSocketLiveDeps(): FixSocketLiveDeps {
  return {
    runCommand: runCommandWithTimeout,
    probeProcesses: probeHerdrServerProcesses,
    async getServerStatus() {
      if (!Bun.which("herdr")) return { running: false, output: "" };
      const result = await runCommandWithTimeout(["herdr", "status", "server"], 5_000);
      return {
        running: parseHerdrServerStatusRunning(result.output),
        output: result.output,
      };
    },
    isPidAlive(pid) {
      if (!Number.isFinite(pid) || pid <= 1 || pid === process.pid) return false;
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    killPid(pid, signal) {
      if (!Number.isFinite(pid) || pid <= 1 || pid === process.pid) {
        return { ok: false, error: "refusing unsafe pid" };
      }
      try {
        process.kill(pid, signal);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    sleep: (ms) => Bun.sleep(ms),
  };
}

async function readSpawnOutput(proc: ReturnType<typeof Bun.spawn>): Promise<string> {
  const stdout =
    proc.stdout instanceof ReadableStream ? await readableStreamToText(proc.stdout) : "";
  const stderr =
    proc.stderr instanceof ReadableStream ? await readableStreamToText(proc.stderr) : "";
  return `${stdout}${stderr}`.trim();
}

/** Block kill when post-stop target is not the same PID we saw before graceful stop. */
function cmdlineMismatch(
  before: readonly HerdrServerProcess[],
  target: HerdrServerProcess
): string | null {
  const prior = before.find((p) => p.pid === target.pid);
  if (!prior) {
    return `pid ${target.pid} not in pre-stop snapshot (possible supervisor respawn)`;
  }
  if (prior.command !== target.command) {
    return `pid ${target.pid} cmdline changed: ${prior.command} → ${target.command}`;
  }
  if (!isHerdrServerCommandLine(target.command)) {
    return `pid ${target.pid} cmdline is not a herdr server: ${target.command}`;
  }
  return null;
}

/** Execute live saturation recovery (EAGAIN plans only). */
export async function executeFixSocketLive(
  context: {
    code: HerdrCliProtocolErrorCode;
    socketPath: string;
    serverRunningBefore: boolean;
    pgrepBefore: readonly HerdrServerProcess[];
  },
  deps: FixSocketLiveDeps = defaultFixSocketLiveDeps()
): Promise<FixSocketLiveExecution> {
  const actions: FixSocketLiveAction[] = [];

  if (context.code !== "EAGAIN") {
    actions.push({
      phase: "live",
      outcome: "skipped",
      detail: "live execution only supports EAGAIN (herdr_socket_saturation) plans",
    });
    const status = await deps.getServerStatus();
    return {
      executed: true,
      actions,
      stopResult: { ok: true, timedOut: false, exitCode: 0, output: "" },
      serverRunningAfterStop: status.running,
      serverStatusAfterStop: status.output,
      pgrepAfterStop: deps.probeProcesses(),
      finalServerRunning: status.running,
      finalServerStatus: status.output,
    };
  }

  const stopResult = await deps.runCommand(["herdr", "server", "stop"], FIX_SOCKET_STOP_TIMEOUT_MS);
  actions.push({
    phase: "graceful_stop",
    command: `herdr server stop (timeout ${FIX_SOCKET_STOP_TIMEOUT_MS}ms)`,
    outcome: stopResult.timedOut ? "timed_out" : stopResult.ok ? "ok" : "failed",
    detail: stopResult.output || undefined,
  });

  const statusAfter = await deps.getServerStatus();
  const pgrepAfter = deps.probeProcesses();

  actions.push({
    phase: "status_recheck",
    command: "herdr status server",
    outcome: "ok",
    detail: statusAfter.output || undefined,
  });

  for (const target of pgrepAfter.processes) {
    const mismatch = cmdlineMismatch(context.pgrepBefore, target);
    if (mismatch) {
      actions.push({
        phase: "kill_validation",
        outcome: "aborted",
        detail: mismatch,
      });
      continue;
    }

    if (!deps.isPidAlive(target.pid)) {
      actions.push({
        phase: "kill_skip",
        outcome: "skipped",
        detail: `pid ${target.pid} already exited after stop`,
      });
      continue;
    }

    const term = deps.killPid(target.pid, "SIGTERM");
    actions.push({
      phase: "sigterm",
      command: `kill -TERM ${target.pid}`,
      outcome: term.ok ? "ok" : "failed",
      detail: term.error ?? target.command,
    });
    if (!term.ok) continue;

    await deps.sleep(FIX_SOCKET_KILL_WAIT_MS);

    if (!deps.isPidAlive(target.pid)) {
      actions.push({
        phase: "sigkill",
        outcome: "skipped",
        detail: `pid ${target.pid} exited after SIGTERM`,
      });
      continue;
    }

    const kill = deps.killPid(target.pid, "SIGKILL");
    actions.push({
      phase: "sigkill",
      command: `kill -KILL ${target.pid}`,
      outcome: kill.ok ? "ok" : "failed",
      detail: kill.error ?? target.command,
    });
  }

  const finalStatus = await deps.getServerStatus();
  return {
    executed: true,
    actions,
    stopResult,
    serverRunningAfterStop: statusAfter.running,
    serverStatusAfterStop: statusAfter.output,
    pgrepAfterStop: pgrepAfter,
    finalServerRunning: finalStatus.running,
    finalServerStatus: finalStatus.output,
  };
}

export function buildFixSocketPlanSnapshot(context: {
  code: HerdrCliProtocolErrorCode;
  serverRunning: boolean;
  socketPath: string;
  serverPids: readonly HerdrServerProcess[];
  dryRun: boolean;
}) {
  const plan = buildHerdrSocketRecoveryPlan({
    code: context.code,
    serverRunning: context.serverRunning,
    socketPath: context.socketPath,
  });
  return materializeHerdrSocketRecoveryPlan(plan, {
    serverPids: context.serverPids,
    dryRun: context.dryRun,
  });
}
