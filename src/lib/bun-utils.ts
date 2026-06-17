/**
 * Bun runtime utilities — preferred call-site surface over Node polyfills.
 * Docs: https://bun.com/docs/runtime/utils · https://bun.com/docs/runtime/bun-apis
 *
 * Use these helpers in feature code; keep node:* imports confined to bun-native-shim.ts.
 * For subprocess streams and inspect output, also see src/lib/inspect.ts.
 */

import { peek } from "bun";

/** Monotonic UUID v7 — prefer for session/db ids (see Bun.randomUUIDv7). */
export { randomUUIDv7 } from "bun";

export type PeekStatus = "fulfilled" | "pending" | "rejected";

/** Parse TOML text (Bun.TOML.parse). */
export function parseToml(text: string): Record<string, unknown> {
  return Bun.TOML.parse(text) as Record<string, unknown>;
}

/** Resolve a module specifier from a directory (Bun.resolveSync). */
export function resolveModule(specifier: string, fromDir: string): string {
  return Bun.resolveSync(specifier, fromDir);
}

/** file:// URL → absolute path (Bun.fileURLToPath). */
export function filePathFromUrl(url: string | URL): string {
  return Bun.fileURLToPath(url);
}

/** Absolute path → file:// URL (Bun.pathToFileURL). */
export function fileUrlFromPath(path: string): URL {
  return Bun.pathToFileURL(path);
}

/** High-resolution monotonic clock (Bun.nanoseconds). */
export function nowNanos(): number {
  return Bun.nanoseconds();
}

/** Elapsed milliseconds since a Bun.nanoseconds() sample. */
export function elapsedMsSince(startNanos: number): number {
  return Math.round((Bun.nanoseconds() - startNanos) / 1_000_000);
}

/** SHA-256 hasher (Bun.CryptoHasher). */
export function sha256Hasher(): InstanceType<typeof Bun.CryptoHasher> {
  return new Bun.CryptoHasher("sha256");
}

/** Read a ReadableStream as UTF-8 text (Bun.readableStreamToText). */
export async function readableStreamToText(
  stream: ReadableStream<Uint8Array> | null | undefined
): Promise<string> {
  if (!stream) return "";
  return Bun.readableStreamToText(stream);
}

/** Test semver satisfaction (Bun.semver.satisfies). */
export function semverSatisfies(version: string, range: string): boolean {
  return Bun.semver.satisfies(version, range);
}

function gzipInput(data: string | Uint8Array): Uint8Array<ArrayBuffer> {
  if (typeof data === "string") {
    return new TextEncoder().encode(data) as Uint8Array<ArrayBuffer>;
  }
  return Uint8Array.from(data) as Uint8Array<ArrayBuffer>;
}

/** Gzip bytes with Bun.gzipSync. */
export function gzipBytes(data: string | Uint8Array): Uint8Array {
  return Bun.gzipSync(gzipInput(data));
}

/** Gunzip bytes with Bun.gunzipSync. */
export function gunzipBytes(data: Uint8Array): Uint8Array {
  return Bun.gunzipSync(Uint8Array.from(data) as Uint8Array<ArrayBuffer>);
}

/** Gunzip to UTF-8 text. */
export function gunzipText(data: Uint8Array): string {
  return new TextDecoder().decode(Bun.gunzipSync(Uint8Array.from(data) as Uint8Array<ArrayBuffer>));
}

export interface ExecArgvOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string | undefined>;
}

/** Run [cmd, ...args] synchronously; returns trimmed UTF-8 stdout. */
export function execArgvSync(cmd: string, args: string[], options: ExecArgvOptions = {}): string {
  const proc = Bun.spawnSync([cmd, ...args], {
    cwd: options.cwd,
    timeout: options.timeout,
    env: options.env ? ({ ...Bun.env, ...options.env } as Record<string, string>) : undefined,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout ? new TextDecoder().decode(proc.stdout) : "";
  const stderr = proc.stderr ? new TextDecoder().decode(proc.stderr) : "";
  if (proc.exitCode !== 0) {
    const err = new Error(`${cmd} exited with code ${proc.exitCode ?? "unknown"}`) as Error & {
      stdout?: string;
      stderr?: string;
      status?: number | null;
    };
    err.stdout = stdout;
    err.stderr = stderr;
    err.status = proc.exitCode;
    throw err;
  }
  return stdout.trim();
}

/** Resolve executable on PATH (Bun.which). */
export function resolveExecutable(name: string, cwd?: string): string | null {
  return Bun.which(name, cwd ? { cwd } : undefined);
}

/** Blocking sleep — prefer await Bun.sleep() in async code. */
export function sleepSync(ms: number): void {
  Bun.sleepSync(Math.max(0, ms));
}

/** Entry script path for direct-run guards (Bun.main). */
export function entryScriptPath(): string {
  return Bun.main;
}

/** True when this module is the process entrypoint. */
export function isDirectRun(modulePath: string): boolean {
  return modulePath === Bun.main;
}

// .implemented:peek-wrapper — Bun.peek wrappers for in-flight promise fast paths
/** Read a settled promise synchronously; pending promises pass through. */
export function peekPromise<T>(promise: Promise<T>): T | Promise<T> {
  return peek(promise);
}

/** Non-throwing status probe for a promise (or non-promise value). */
export function peekPromiseStatus(value: unknown): PeekStatus {
  return peek.status(value) as PeekStatus;
}

/** Join concurrent callers on one in-flight promise; peek when already fulfilled. */
export async function dedupInflight<T>(
  map: Map<string, Promise<T>>,
  key: string,
  run: () => Promise<T>
): Promise<T> {
  const existing = map.get(key);
  if (existing) {
    if (peekPromiseStatus(existing) === "fulfilled") {
      try {
        return peekPromise(existing) as T;
      } catch {
        return existing;
      }
    }
    return existing;
  }

  const promise = (async () => {
    try {
      return await run();
    } finally {
      map.delete(key);
    }
  })();
  map.set(key, promise);
  return await promise;
}

/** Deep equality (Bun.deepEquals). */
export function deepEqual<T>(a: T, b: T, strict = false): boolean {
  return Bun.deepEquals(a, b, strict);
}

/** Strip ANSI escapes (Bun.stripANSI). */
export function stripAnsi(text: string): string {
  return Bun.stripANSI(text);
}

/** Terminal display width (Bun.stringWidth). */
export function terminalWidth(text: string, countAnsi = false): number {
  return Bun.stringWidth(text, countAnsi ? { countAnsiEscapeCodes: true } : undefined);
}

/** HTML escape (Bun.escapeHTML). */
export function escapeHtml(value: string | number | boolean | object): string {
  return Bun.escapeHTML(value);
}

/** Bun CLI semver string. */
export function bunVersion(): string {
  return Bun.version;
}

/** Bun build git revision. */
export function bunRevision(): string {
  return Bun.revision;
}
