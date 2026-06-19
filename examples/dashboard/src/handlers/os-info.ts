// ── OS Info ────────────────────────────────────────────────────────

export async function apiOsInfo(): Promise<Response> {
  const os = await import("node:os");

  return jsonResponse({
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    homedir: os.homedir(),
    cpus: { count: os.cpus().length, model: os.cpus()[0]?.model ?? "unknown" },
    memory: {
      freeMB: (os.freemem() / 1024 / 1024).toFixed(0),
      totalGB: (os.totalmem() / 1024 / 1024 / 1024).toFixed(1),
    },
    uptime: { seconds: os.uptime(), hours: (os.uptime() / 3600).toFixed(1) },
    network: Object.fromEntries(
      Object.entries(os.networkInterfaces()).map(([k, v]) => [k, v?.length ?? 0])
    ),
    userInfo: { username: os.userInfo().username, shell: os.userInfo().shell },
    note: "node:os — cross-platform OS info. Bun mirrors Node.js os module exactly.",
  });
}
