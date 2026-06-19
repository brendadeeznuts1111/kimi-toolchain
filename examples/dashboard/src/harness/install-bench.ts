/**
 * Deterministic minimal install benchmark — frozen fixture, no network variance.
 */

import { join } from "path";
import { $ } from "bun";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__", "install-minimal");

let activeDir: string | null = null;

/** True when install benchmark is allowed (opt-in on CI via KIMI_PERF_INSTALL=1). */
export function installBenchEnabled(): boolean {
  if (Bun.env.KIMI_PERF_INSTALL === "1") return true;
  return Bun.env.CI !== "true";
}

export async function installBenchAvailable(): Promise<boolean> {
  const pkg = Bun.file(join(FIXTURE_DIR, "package.json"));
  const lock = Bun.file(join(FIXTURE_DIR, "bun.lock"));
  return (await pkg.exists()) && (await lock.exists());
}

async function copyFixtureTo(dir: string): Promise<void> {
  await $`cp ${join(FIXTURE_DIR, "package.json")} ${dir}/package.json`.quiet();
  await $`cp ${join(FIXTURE_DIR, "bun.lock")} ${dir}/bun.lock`.quiet();
}

async function ensureBenchDir(): Promise<string> {
  if (activeDir) return activeDir;
  const dir = await Bun.$`mktemp -d -t kimi-perf-install`.text();
  const trimmed = dir.trim();
  await copyFixtureTo(trimmed);
  activeDir = trimmed;
  return trimmed;
}

export function stopInstallBenchContext(): void {
  if (!activeDir) return;
  const dir = activeDir;
  activeDir = null;
  $`rm -rf ${dir}`.nothrow().quiet();
}

/** Run bun install --frozen-lockfile in an isolated copy of the install fixture. */
export async function benchMinimalInstall(): Promise<void> {
  const dir = await ensureBenchDir();
  await copyFixtureTo(dir);
  const result = await $`bun install --frozen-lockfile`.cwd(dir).nothrow().quiet();
  if (result.exitCode !== 0) {
    throw new Error(
      `package.install-minimal: bun install failed (${result.stderr.toString().trim()})`
    );
  }
}
