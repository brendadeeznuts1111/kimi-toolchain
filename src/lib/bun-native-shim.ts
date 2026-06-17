/**
 * Centralized sync Node API boundary for gradual Bun-native migration.
 * New code should prefer Bun.file, Bun.write, Bun.spawn, and Bun.which.
 * Import from here instead of fs / node:fs / node:child_process / node:zlib / node:crypto.
 */

// @bun-native-exempt — single blessed sync boundary; shrink over time via bun-native:batch
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
// @bun-native-exempt
import { execFileSync, spawnSync } from "node:child_process";
// @bun-native-exempt
import { gunzipSync, gzipSync } from "node:zlib";
// @bun-native-exempt
import { randomUUID } from "node:crypto";

export {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  execFileSync,
  gunzipSync,
  gzipSync,
  lstatSync,
  mkdirSync,
  randomUUID,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  spawnSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
};

/** Bun.which wrapper — prefer over execFileSync("which", …). */
export function whichCommand(command: string): string | null {
  return Bun.which(command);
}

/** Run a command inheriting stdio; throws on non-zero exit. */
export function spawnInherit(argv: string[]): void {
  const proc = Bun.spawnSync(argv, { stdio: ["inherit", "inherit", "inherit"] });
  if (proc.exitCode !== 0) {
    throw new Error(`${argv[0]} exited with code ${proc.exitCode ?? "unknown"}`);
  }
}

/** Run a command quietly; returns false on failure. */
export function spawnQuiet(argv: string[], timeoutMs = 8_000): boolean {
  const proc = Bun.spawnSync(argv, {
    stdio: ["ignore", "ignore", "ignore"],
    timeout: timeoutMs,
  });
  return proc.exitCode === 0;
}
