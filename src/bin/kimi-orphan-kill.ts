#!/usr/bin/env bun
/**
 * kimi-orphan-kill — Emergency orphan process cleanup
 * Kills runaway bun test / kimi-tool processes without touching system services.
 *
 * Usage:
 *   kimi-orphan-kill [--dry-run]
 */

export interface ProcessInfo {
  pid: number;
  cmd: string;
  cpu: number;
}

export function getOrphanProcesses(): ProcessInfo[] {
  try {
    const output = new TextDecoder().decode(
      Bun.spawnSync(["ps", "aux"]).stdout
    );

    const orphans: ProcessInfo[] = [];
    for (const line of output.split("\n")) {
      if (
        line.includes("/.bun/bin/bun test") ||
        (line.includes("bun run") && line.includes("kimi-")) ||
        line.includes("/.kimi-code/bin/kimi --version") ||
        (line.includes("/bin/cp") && line.includes("kimi-test"))
      ) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 11) {
          const pid = parseInt(parts[1], 10);
          const cpu = parseFloat(parts[2]);
          const cmd = parts.slice(10).join(" ");
          if (!isNaN(pid) && pid !== process.pid) {
            orphans.push({ pid, cmd, cpu });
          }
        }
      }
    }
    return orphans;
  } catch {
    return [];
  }
}

function killProcess(pid: number, signal: "SIGTERM" | "SIGKILL" = "SIGKILL") {
  try {
    process.kill(pid, signal === "SIGKILL" ? 9 : 15);
    return true;
  } catch {
    return false;
  }
}

export async function clearStaleLocks(): Promise<string[]> {
  const cleared: string[] = [];
  const guardDir = `${Bun.env.HOME || "/tmp"}/.kimi-code/guard`;
  const locks = [`${guardDir}/test-runner.pid`, `${guardDir}/kimi-test.lock`];
  for (const lock of locks) {
    try {
      const file = Bun.file(lock);
      if (await file.exists()) {
        Bun.spawnSync(["rm", "-f", lock]);
        cleared.push(lock);
      }
    } catch {
      /* ignore */
    }
  }
  return cleared;
}

export async function runOrphanKill(dryRun = false): Promise<{ killed: number; orphans: ProcessInfo[] }> {
  const orphans = getOrphanProcesses();
  if (orphans.length === 0) {
    await clearStaleLocks();
    return { killed: 0, orphans: [] };
  }

  if (dryRun) {
    return { killed: 0, orphans };
  }

  let killed = 0;
  for (const o of orphans) {
    if (killProcess(o.pid, "SIGTERM")) killed++;
  }

  Bun.sleepSync(500);
  for (const o of getOrphanProcesses()) {
    if (killProcess(o.pid, "SIGKILL")) killed++;
  }

  await clearStaleLocks();
  return { killed, orphans };
}

// ── CLI ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  const DRY_RUN = Bun.argv.includes("--dry-run");
  const orphans = getOrphanProcesses();

  if (orphans.length === 0) {
    console.log("✓ No orphan processes found");
    await clearStaleLocks();
    process.exit(0);
  }

  console.log(`Found ${orphans.length} orphan process(es):`);
  for (const o of orphans) {
    console.log(`  PID ${o.pid}  CPU ${o.cpu}%  ${o.cmd.slice(0, 80)}`);
  }

  if (DRY_RUN) {
    console.log("\n(Dry run — no processes killed)");
    process.exit(0);
  }

  console.log("\nKilling orphans...");
  const { killed } = await runOrphanKill(false);
  console.log(`✓ Killed ${killed} orphan process(es)`);
}
