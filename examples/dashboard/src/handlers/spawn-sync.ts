// ── Spawn Sync ─────────────────────────────────────────────────────

export async function apiSpawnSync(): Promise<Response> {
  const proc = Bun.spawnSync(["echo", "hello from spawnSync"]);
  const stdout = proc.stdout?.toString().trim() ?? "";
  const usage = proc.resourceUsage();

  return jsonResponse({
    stdout,
    exitCode: proc.exitCode,
    success: proc.success,
    pid: proc.pid,
    resourceUsage: usage
      ? {
          maxRSS: `${(usage.maxRSS / 1024 / 1024).toFixed(1)} MB`,
          cpuUser: `${usage.cpuTime.user} µs`,
          cpuSystem: `${usage.cpuTime.system} µs`,
          messages: usage.messages,
          contextSwitches: usage.contextSwitches,
        }
      : null,
    note: "Bun.spawnSync — blocking, returns Buffer stdout/stderr. 60% faster than Node.js child_process. resourceUsage() gives CPU, memory, context switches.",
  });
}
