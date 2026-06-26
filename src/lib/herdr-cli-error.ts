/**
 * Herdr CLI protocol error parsing and read-only recovery planning.
 *
 * Taxonomy: error-taxonomy.yml#herdr_socket_saturation, #herdr_cli_attach_refused
 */

export type HerdrCliProtocolErrorCode = "EAGAIN" | "ECONNREFUSED" | "UNKNOWN";

export type HerdrCliProtocolError = {
  code: HerdrCliProtocolErrorCode;
  taxonomyId: string;
  osError?: number;
  raw: string;
};

export type HerdrSocketRecoveryStep = {
  order: number;
  action: string;
  destructive: boolean;
  command?: string;
};

export type HerdrServerProcess = {
  pid: number;
  command: string;
};

export type HerdrSocketRecoveryExecution = HerdrSocketRecoveryStep & {
  wouldRun?: string;
  skippedReason?: string;
};

/** True when cmdline invokes the herdr binary as server (not herdr substring in script paths). */
export function isHerdrServerCommandLine(command: string): boolean {
  if (/\bserver\s+stop\b/i.test(command)) return false;
  return (
    /\bherdr\s+server\b/i.test(command) ||
    /\bherdr\s+--session\s+\S+\s+server\b/i.test(command) ||
    /\bbunx\s+herdr\s+server\b/i.test(command)
  );
}

const HERDR_PROTOCOL_PREFIX = /^herdr:\s*protocol error:/i;

/** Map Herdr CLI stderr to a taxonomy id (no side effects). */
export function parseHerdrCliProtocolError(output: string): HerdrCliProtocolError | null {
  const raw = output.trim();
  if (!raw || !HERDR_PROTOCOL_PREFIX.test(raw)) return null;

  const osMatch = raw.match(/os error (\d+)/i);
  const osError = osMatch ? Number(osMatch[1]) : undefined;

  if (osError === 35 || /\bEAGAIN\b/i.test(raw) || /Resource temporarily unavailable/i.test(raw)) {
    return { code: "EAGAIN", taxonomyId: "herdr_socket_saturation", osError: osError ?? 35, raw };
  }

  if (osError === 61 || /\bECONNREFUSED\b/i.test(raw) || /Connection refused/i.test(raw)) {
    return {
      code: "ECONNREFUSED",
      taxonomyId: "herdr_cli_attach_refused",
      osError: osError ?? 61,
      raw,
    };
  }

  return { code: "UNKNOWN", taxonomyId: "unknown", osError, raw };
}

/**
 * Read-only recovery steps — never kills processes. Validates via `herdr status` before
 * suggesting destructive escalation (operator must run commands manually).
 */
export function buildHerdrSocketRecoveryPlan(context: {
  code: HerdrCliProtocolErrorCode;
  serverRunning?: boolean;
  socketPath: string;
}): HerdrSocketRecoveryStep[] {
  const steps: HerdrSocketRecoveryStep[] = [];
  let order = 1;

  const push = (action: string, destructive: boolean, command?: string) => {
    steps.push({ order: order++, action, destructive, command });
  };

  push(
    "Confirm server state (do not kill until verified)",
    false,
    "herdr status && herdr status server"
  );

  if (context.code === "EAGAIN") {
    push(
      "Stop dashboard/orchestrator event subscribers",
      false,
      "ctrl+c on herdr-orchestrator dashboard"
    );
    push("Audit stale bun test load", false, "kimi-orphan-kill --dry-run");
    push("Request graceful server stop", false, "herdr server stop");
    push(
      "Re-check status — only escalate if still running after stop ack",
      false,
      "herdr status server"
    );
    push(
      "If status still running: SIGTERM the server PID from `pgrep -fl 'herdr server'` (not client PIDs)",
      true,
      "kill -TERM <server-pid>"
    );
    push("Restart Herdr from a real TTY", false, "herdr");
    push(
      "Inspect server log for subscribe churn",
      false,
      "kimi-debug logs --id herdr-server --tail 40"
    );
    return steps;
  }

  if (context.code === "ECONNREFUSED") {
    push(
      "If status is not running, remove stale socket then start server",
      true,
      `rm -f ${context.socketPath} && herdr server`
    );
    push("Attach client from a real TTY", false, "herdr");
    return steps;
  }

  push("Run herdr-doctor for structured socket hints", false, "herdr-doctor doctor");
  return steps;
}

/**
 * Parse pgrep output — macOS (`pgrep -fl`) and Linux (`pgrep -a -f` / `pgrep -af`).
 * Each line: `<pid> <command...>`
 */
export function parsePgrepHerdrServerLines(output: string): HerdrServerProcess[] {
  const results: HerdrServerProcess[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2]!.trim();
    if (!Number.isFinite(pid) || pid <= 0) continue;
    if (!isHerdrServerCommandLine(command)) continue;
    results.push({ pid, command });
  }
  return results;
}

/** Resolve running `herdr server` PIDs via pgrep (macOS + Linux flag fallbacks). */
export function probeHerdrServerProcesses(): {
  processes: HerdrServerProcess[];
  pgrepCommand: string;
  raw: string;
} {
  const attempts: string[][] = [
    ["pgrep", "-fl", "herdr server"],
    ["pgrep", "-a", "-f", "herdr server"],
    ["pgrep", "-af", "herdr server"],
    ["pgrep", "-af", "bunx herdr server"],
  ];

  for (const cmd of attempts) {
    const executable = cmd[0];
    if (!executable || !Bun.which(executable)) break;
    const proc = Bun.spawnSync({ cmd, stdout: "pipe", stderr: "pipe" });
    const raw = proc.stdout ? new TextDecoder().decode(proc.stdout).trim() : "";
    if (!raw) continue;
    const processes = parsePgrepHerdrServerLines(raw);
    if (processes.length > 0) {
      return { processes, pgrepCommand: cmd.join(" "), raw };
    }
  }

  const fallback = attempts[0] ?? ["pgrep", "-fl", "herdr server"];
  return { processes: [], pgrepCommand: fallback.join(" "), raw: "" };
}

/** Substitute resolved server PIDs into recovery steps (dry-run materialization). */
export function materializeHerdrSocketRecoveryPlan(
  steps: HerdrSocketRecoveryStep[],
  context: { serverPids: readonly HerdrServerProcess[]; dryRun?: boolean }
): HerdrSocketRecoveryExecution[] {
  const dryRun = context.dryRun !== false;
  return steps.map((step) => {
    if (!step.command?.includes("<server-pid>")) {
      return {
        ...step,
        wouldRun: dryRun && step.command ? `[dry-run] operator runs: ${step.command}` : undefined,
      };
    }

    if (context.serverPids.length === 0) {
      return {
        ...step,
        skippedReason: "no herdr server PID matched pgrep — verify manually before kill",
        wouldRun: "[dry-run] skipped: kill -TERM <server-pid> (no PID resolved)",
      };
    }

    const killCommands = context.serverPids.map((p) => `kill -TERM ${p.pid}  # ${p.command}`);
    const command = killCommands.join("\n");
    return {
      ...step,
      command,
      wouldRun: dryRun
        ? `[dry-run] would run:\n${killCommands.map((c) => `  ${c}`).join("\n")}`
        : undefined,
    };
  });
}
