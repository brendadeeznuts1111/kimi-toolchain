/**
 * Herdr automation — CLI wrappers (stable, testable).
 * Raw socket path available via HERDR_SOCKET_PATH; finish-work uses the CLI.
 */

import { readableStreamToText } from "./bun-utils.ts";
import { herdrSessionArgs, herdrSessionEnv } from "./herdr-project-cli.ts";

export interface HerdrCliResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface HerdrCliJsonResult<T = unknown> {
  ok: boolean;
  json: T | null;
  error: string | null;
  exitCode: number;
}

export async function herdrCli(args: string[], session?: string): Promise<HerdrCliResult> {
  const proc = Bun.spawn(["herdr", ...herdrSessionArgs(session), ...args], {
    env: herdrSessionEnv(session),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  return {
    ok: exitCode === 0,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
  };
}

export async function herdrCliJson<T = unknown>(
  args: string[],
  session?: string
): Promise<HerdrCliJsonResult<T>> {
  const result = await herdrCli(args, session);
  if (!result.ok) {
    return {
      ok: false,
      json: null,
      error: result.stderr || result.stdout || `herdr exited ${result.exitCode}`,
      exitCode: result.exitCode,
    };
  }
  if (!result.stdout) {
    return { ok: true, json: null, error: null, exitCode: 0 };
  }
  try {
    return {
      ok: true,
      json: JSON.parse(result.stdout) as T,
      error: null,
      exitCode: 0,
    };
  } catch {
    return {
      ok: false,
      json: null,
      error: "invalid JSON from herdr CLI",
      exitCode: result.exitCode,
    };
  }
}
