/**
 * Shared subprocess fixtures for oven-sh/bun `test/cli` ports.
 */

import { dirname, join } from "path";
import { makeDir, removePath, writeText } from "./bun-io.ts";
import { readableStreamToText } from "./bun-utils.ts";
import { gateSpawnEnv, probeBunExecutable, scrubEphemeralBunNodeDirs } from "./root-hygiene.ts";

export interface CliSpawnResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Normalize subprocess console output for upstream snapshot parity. */
export function normalizeCliOutput(output: string): string {
  return output.replace(/\r\n?/g, "\n").trim();
}

export async function spawnCliInDir(
  cwd: string,
  args: string[],
  env?: Record<string, string | undefined>
): Promise<CliSpawnResult> {
  scrubEphemeralBunNodeDirs();
  const proc = Bun.spawn({
    cmd: [probeBunExecutable(), ...args],
    cwd,
    env: gateSpawnEnv(env ? { ...Bun.env, ...env } : Bun.env),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export async function withCliFixture(
  label: string,
  files: Record<string, string>,
  args: string[],
  env?: Record<string, string | undefined>
): Promise<CliSpawnResult> {
  const dir = join(Bun.env.TMPDIR || "/tmp", `kimi-cli-${label}-${Bun.randomUUIDv7()}`);
  makeDir(dir, { recursive: true });
  try {
    for (const [name, body] of Object.entries(files)) {
      const filePath = join(dir, name);
      if (body === "") {
        makeDir(filePath, { recursive: true });
      } else {
        makeDir(dirname(filePath), { recursive: true });
        writeText(filePath, body);
      }
    }
    return await spawnCliInDir(dir, args, env);
  } finally {
    removePath(dir, { recursive: true, force: true });
  }
}

export async function withCliFixtureDir<T>(
  label: string,
  files: Record<string, string>,
  fn: (dir: string) => T | Promise<T>
): Promise<T> {
  const dir = join(Bun.env.TMPDIR || "/tmp", `kimi-cli-${label}-${Bun.randomUUIDv7()}`);
  makeDir(dir, { recursive: true });
  try {
    for (const [name, body] of Object.entries(files)) {
      const filePath = join(dir, name);
      if (body === "") {
        makeDir(filePath, { recursive: true });
      } else {
        makeDir(dirname(filePath), { recursive: true });
        writeText(filePath, body);
      }
    }
    return await fn(dir);
  } finally {
    removePath(dir, { recursive: true, force: true });
  }
}

export function cliProbe(
  id: string,
  ok: boolean,
  detail: string
): { id: string; ok: boolean; detail: string } {
  return { id, ok, detail };
}
