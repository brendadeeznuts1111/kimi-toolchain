/**
 * Centralized sync Node API boundary for gradual Bun-native migration.
 * New code should prefer Bun.file, Bun.write, Bun.spawn, Bun.which, and src/lib/bun-utils.ts.
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

export {
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
};

/** @deprecated Prefer gzipBytes from bun-utils.ts */
export function gzipSync(data: string | Uint8Array): Buffer {
  const input = typeof data === "string" ? Buffer.from(data, "utf8") : Uint8Array.from(data);
  return Buffer.from(Bun.gzipSync(input as Uint8Array<ArrayBuffer>));
}

/** @deprecated Prefer gunzipBytes / gunzipText from bun-utils.ts */
export function gunzipSync(data: Uint8Array): Buffer {
  return Buffer.from(Bun.gunzipSync(Uint8Array.from(data) as Uint8Array<ArrayBuffer>));
}

export interface ExecFileSyncOptions {
  cwd?: string;
  encoding?: BufferEncoding | "buffer" | null;
  stdio?: [unknown, unknown, unknown] | unknown;
  timeout?: number;
  env?: Record<string, string | undefined>;
}

/** @deprecated Prefer execArgvSync from bun-utils.ts */
export function execFileSync(
  file: string,
  args: readonly string[],
  options: ExecFileSyncOptions = {}
): string {
  const stdinMode =
    Array.isArray(options.stdio) && options.stdio[0] === "ignore" ? "ignore" : "inherit";
  const proc = Bun.spawnSync([file, ...args], {
    cwd: options.cwd,
    timeout: options.timeout,
    env: options.env ? ({ ...Bun.env, ...options.env } as Record<string, string>) : undefined,
    stdin: stdinMode,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout ? Buffer.from(proc.stdout) : Buffer.alloc(0);
  const stderr = proc.stderr ? Buffer.from(proc.stderr) : Buffer.alloc(0);
  if (proc.exitCode !== 0) {
    const err = new Error(`Command failed: ${file}`) as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      status?: number | null;
    };
    err.status = proc.exitCode;
    err.stdout = stdout.toString("utf8");
    err.stderr = stderr.toString("utf8");
    throw err;
  }
  if (options.encoding === "buffer" || options.encoding === null) {
    return stdout as unknown as string;
  }
  return stdout.toString(options.encoding ?? "utf8");
}

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
