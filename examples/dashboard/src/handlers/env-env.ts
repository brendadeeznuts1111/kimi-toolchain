// ── Env / .env ────────────────────────────────────────────────────

export async function apiDotenv(): Promise<Response> {
  // Read .env file if it exists
  let dotenvRaw = "";
  let dotenvParsed: Record<string, string> = {};
  try {
    const dotenvPath = import.meta.dir + "/../.env";
    const file = Bun.file(dotenvPath);
    if (await file.exists()) {
      dotenvRaw = await file.text();
      // Parse .env manually to show what was loaded
      for (const line of dotenvRaw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq > 0) {
          const key = trimmed.slice(0, eq).trim();
          let val = trimmed.slice(eq + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          dotenvParsed[key] = val;
        }
      }
    }
  } catch {
    /* no .env */
  }

  const nodeEnv = Bun.env.NODE_ENV ?? "unset";
  const loadedVars = Object.keys(dotenvParsed);

  // Bun-specific environment variables (from official docs)
  const bunSpecialVars: { name: string; description: string; value: string; set: boolean }[] = [
    {
      name: "NODE_TLS_REJECT_UNAUTHORIZED",
      description: "Disables SSL cert validation",
      value: Bun.env.NODE_TLS_REJECT_UNAUTHORIZED ?? "unset",
      set: "NODE_TLS_REJECT_UNAUTHORIZED" in Bun.env,
    },
    {
      name: "BUN_CONFIG_VERBOSE_FETCH",
      description: "Log fetch requests/responses as curl",
      value: Bun.env.BUN_CONFIG_VERBOSE_FETCH ?? "unset",
      set: "BUN_CONFIG_VERBOSE_FETCH" in Bun.env,
    },
    {
      name: "BUN_RUNTIME_TRANSPILER_CACHE_PATH",
      description: "Transpiler cache dir (files >50KB)",
      value: Bun.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH ?? "unset",
      set: "BUN_RUNTIME_TRANSPILER_CACHE_PATH" in Bun.env,
    },
    {
      name: "TMPDIR",
      description: "Intermediate assets during bundling",
      value: Bun.env.TMPDIR ?? "unset",
      set: "TMPDIR" in Bun.env,
    },
    {
      name: "NO_COLOR",
      description: "Disable ANSI color output",
      value: Bun.env.NO_COLOR ?? "unset",
      set: "NO_COLOR" in Bun.env,
    },
    {
      name: "FORCE_COLOR",
      description: "Force-enable ANSI colors",
      value: Bun.env.FORCE_COLOR ?? "unset",
      set: "FORCE_COLOR" in Bun.env,
    },
    {
      name: "BUN_CONFIG_MAX_HTTP_REQUESTS",
      description: "Max concurrent fetch/install requests (default 256)",
      value: Bun.env.BUN_CONFIG_MAX_HTTP_REQUESTS ?? "unset",
      set: "BUN_CONFIG_MAX_HTTP_REQUESTS" in Bun.env,
    },
    {
      name: "BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD",
      description: "Don't clear console on --watch reload",
      value: Bun.env.BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD ?? "unset",
      set: "BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD" in Bun.env,
    },
    {
      name: "DO_NOT_TRACK",
      description: "Disable crash reports & telemetry",
      value: Bun.env.DO_NOT_TRACK ?? "unset",
      set: "DO_NOT_TRACK" in Bun.env,
    },
    {
      name: "BUN_OPTIONS",
      description: "Prepend CLI args to any Bun execution",
      value: Bun.env.BUN_OPTIONS ?? "unset",
      set: "BUN_OPTIONS" in Bun.env,
    },
  ];

  return jsonResponse({
    loadingOrder: [
      ".env",
      `.env.${nodeEnv === "unset" ? "{production,development,test}" : nodeEnv}  (based on NODE_ENV)`,
      ".env.local  (skipped when NODE_ENV=test)",
    ],
    nodeEnv,
    loadedFromDotenv: dotenvParsed,
    runtimeValues: Object.fromEntries(loadedVars.map((k) => [k, Bun.env[k] ?? "unset"])),
    bunSpecialVars,
    setCount: bunSpecialVars.filter((v) => v.set).length,
    totalCount: bunSpecialVars.length,
    note: "Bun auto-loads .env files in priority order. Set inline: DASHBOARD_THEME=light bun run src/index.ts. Disable: bunfig.toml [env] file = false.",
  });
}
