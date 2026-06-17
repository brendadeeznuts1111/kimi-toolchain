/**
 * herdr-cli.ts — Shared herdr CLI invocation helpers
 *
 * Low-level Bun.spawn / Bun.spawnSync wrappers used by herdr-pane-service.ts
 * and herdr-workspace-service.ts. Each service builds its own herdrCliJson
 * wrapper on top to handle its specific error taxonomy.
 */

import { Effect } from "effect";
import { resolveHerdrPanePath, resolveHerdrSession, herdrSessionEnv } from "./herdr-project-cli.ts";

// ── Types ───────────────────────────────────────────────────────────────

export interface HerdrCliError {
  _tag: "HerdrCliError";
  message: string;
  stderr: string;
  exitCode: number | null;
}

// ── Error factory ───────────────────────────────────────────────────────

export function herdrCliError(
  stderr: string,
  exitCode: number | null,
  context: string
): HerdrCliError {
  return {
    _tag: "HerdrCliError" as const,
    message: `herdr ${context}: ${stderr.slice(0, 200)}`,
    stderr,
    exitCode,
  };
}

// ── Async CLI (Effect-based) ────────────────────────────────────────────

/** Run the herdr CLI with given args, returning stdout as text (async Effect). */
export function herdrCli(args: string[], session?: string): Effect.Effect<string, HerdrCliError> {
  return Effect.gen(function* () {
    const resolved = resolveHerdrSession(session);
    const binPath = resolveHerdrPanePath();
    const baseEnv = herdrSessionEnv(session);
    const env: Record<string, string> = { PATH: binPath };
    for (const [key, value] of Object.entries(baseEnv)) {
      if (value != null) env[key] = value;
    }
    // Clear HERDR_SESSION for primary server routing
    if (!resolved) {
      delete env.HERDR_SESSION;
      delete env.HERDR_SOCKET_PATH;
    }

    const proc = Bun.spawn({
      cmd: ["herdr", ...(resolved ? ["--session", resolved] : []), ...args],
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const exitCode = yield* Effect.promise(() => proc.exited);
    const stdout = yield* Effect.promise(async () => {
      return await Bun.readableStreamToText(proc.stdout);
    });
    const stderr = yield* Effect.promise(async () => {
      return await Bun.readableStreamToText(proc.stderr);
    });

    if (exitCode !== 0) {
      return yield* Effect.fail(herdrCliError(stderr, exitCode, args[0] || "cli"));
    }

    return stdout.trim();
  });
}

// ── Sync CLI (Bun.spawnSync) ────────────────────────────────────────────

/** Run herdr CLI synchronously via Bun.spawnSync. Returns stdout or throws. */
export function herdrCliSync(args: string[], session?: string): string {
  const resolved = resolveHerdrSession(session);
  const binPath = resolveHerdrPanePath();
  const baseEnv = herdrSessionEnv(session);
  const env: Record<string, string> = { PATH: binPath };
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value != null) env[key] = value;
  }
  if (!resolved) {
    delete env.HERDR_SESSION;
    delete env.HERDR_SOCKET_PATH;
  }

  const result = Bun.spawnSync({
    cmd: ["herdr", ...(resolved ? ["--session", resolved] : []), ...args],
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const stdout = result.stdout ? new TextDecoder().decode(result.stdout).trim() : "";
  const stderr = result.stderr ? new TextDecoder().decode(result.stderr).trim() : "";

  if (result.exitCode !== 0) {
    throw new Error(stderr || `herdr ${args[0]}: exit ${result.exitCode}`);
  }

  return stdout;
}
