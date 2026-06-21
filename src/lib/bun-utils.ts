/**
 * Bun runtime utilities — preferred call-site surface over Node polyfills.
 * Docs: https://bun.com/docs/runtime/utils · https://bun.com/docs/runtime/bun-apis
 *
 * Use these helpers in feature code; keep node:* imports confined to bun-native-shim.ts.
 * For inspect output, equality, and ANSI helpers see src/lib/inspect.ts.
 */

import { peek, password } from "bun";
import { hostname as osHostname } from "os";

/** Monotonic UUID v7 — prefer for session/db ids (see Bun.randomUUIDv7). */
export { randomUUIDv7 } from "bun";

/**
 * Password hashing SSOT (`password` from `"bun"` ≡ `Bun.password`).
 *
 * Defaults: match bare `Bun.password.hash(plain)` — argon2id, `m=65536,t=2,p=1` (see hash-a-password guide).
 * Tests: {@link getPasswordOptions} uses 1 MiB / `timeCost: 1` when `Bun.env.NODE_ENV === "test"`.
 *
 * Rotation: change {@link DEFAULT_PASSWORD_OPTIONS} only; new {@link hashPassword} uses new costs;
 * {@link verifyPassword} reads costs from the hash prefix (old users keep working).
 *
 * Optional upgrade-on-login (app code): `if (await verifyPassword(plain, hash) && needsUpgrade(hash))
 * { save(await hashPassword(plain)); }` — compare parsed `m`/`t` from the hash to current minimums.
 *
 * @see {@link BUN_PASSWORD_DOC_URL}
 */
/** Password hashing (argon2id default, bcrypt optional) — same as `Bun.password`. */
export { password };

/** @see https://bun.com/docs/guides/util/hash-a-password */
export const BUN_PASSWORD_DOC_URL = "https://bun.com/docs/guides/util/hash-a-password";

export type PasswordHashOptions = Parameters<typeof password.hash>[1];

/**
 * Argon2id defaults — word-for-word with bare `Bun.password.hash()` (`$m=65536,t=2,p=1`).
 * Tune here for rotation; existing hashes still verify (params live in the hash).
 */
export const DEFAULT_PASSWORD_OPTIONS = {
  algorithm: "argon2id",
  memoryCost: 65536,
  timeCost: 2,
} satisfies Bun.Password.Argon2Algorithm;

/** Production defaults; lighter cost when `Bun.env.NODE_ENV === "test"`. */
export function getPasswordOptions(): Bun.Password.Argon2Algorithm {
  if (Bun.env.NODE_ENV === "test") {
    return {
      algorithm: "argon2id",
      memoryCost: 1024,
      timeCost: 1,
    };
  }
  return DEFAULT_PASSWORD_OPTIONS;
}

/** Async hash — merges {@link getPasswordOptions} with per-call overrides. */
export function hashPassword(plain: string, options?: PasswordHashOptions): Promise<string> {
  if (options === undefined) {
    return password.hash(plain, getPasswordOptions());
  }
  if (typeof options === "string") {
    return password.hash(plain, options);
  }
  return password.hash(plain, { ...getPasswordOptions(), ...options });
}

/**
 * Async verify — uses cost/algorithm embedded in `hash`, not {@link getPasswordOptions}.
 * Safe across DEFAULT_PASSWORD_OPTIONS rotations; only new `hashPassword` calls use new costs.
 */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return password.verify(plain, hash);
}

/**
 * Base64 string encoding (Web `btoa` / `atob`).
 * For binary payloads prefer {@link encodeBase64Bytes} / {@link decodeBase64Bytes}.
 *
 * @see {@link BUN_BASE64_DOC_URL}
 */
/** @see https://bun.com/docs/guides/util/base64 */
export const BUN_BASE64_DOC_URL = "https://bun.com/docs/guides/util/base64";

/** Encode a string to base64 (`btoa`). */
export function encodeBase64(data: string): string {
  return btoa(data);
}

/** Decode a base64 string (`atob`). */
export function decodeBase64(encoded: string): string {
  return atob(encoded);
}

/** Encode bytes to base64 (`Uint8Array.prototype.toBase64`). */
export function encodeBase64Bytes(bytes: Uint8Array): string {
  return bytes.toBase64();
}

/** Decode base64 to bytes (`Uint8Array.fromBase64`). */
export function decodeBase64Bytes(encoded: string): Uint8Array {
  return Uint8Array.fromBase64(encoded);
}

/**
 * Hex encoding (`Uint8Array.prototype.toHex` / `Uint8Array.fromHex`).
 *
 * @see {@link BUN_HEX_DOC_URL}
 */
/** @see https://bun.com/docs/runtime/binary-data#uint8array-tohex-and-fromhex */
export const BUN_HEX_DOC_URL =
  "https://bun.com/docs/runtime/binary-data#uint8array-tohex-and-fromhex";

/** Encode bytes to lowercase hex (`bytes.toHex()`). */
export function encodeHex(bytes: Uint8Array): string {
  return bytes.toHex();
}

/** Decode hex string to bytes (`Uint8Array.fromHex`). */
export function decodeHex(hex: string): Uint8Array {
  return Uint8Array.fromHex(hex);
}

/** UTF-8 byte length for a string (`TextEncoder`). */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** @see https://bun.com/reference/bun/randomUUIDv7#bun.randomUUIDv7 */
export const BUN_RANDOM_UUIDV7_DOC_URL = "https://bun.com/reference/bun/randomUUIDv7";

export type PeekStatus = "fulfilled" | "pending" | "rejected";

/** Parse TOML text (Bun.TOML.parse). */
export function parseToml(text: string): Record<string, unknown> {
  return Bun.TOML.parse(text) as Record<string, unknown>;
}

/** Resolve a module specifier from a directory (Bun.resolveSync). */
export function resolveModule(specifier: string, fromDir: string): string {
  return Bun.resolveSync(specifier, fromDir);
}

/**
 * file:// URL → absolute path (`Bun.fileURLToPath`).
 * Prefer a string href; URL objects are normalized via `.href`.
 * @see https://bun.com/docs/runtime/utils#bun-fileurltopath
 */
export function filePathFromUrl(url: string | URL): string {
  return Bun.fileURLToPath(typeof url === "string" ? url : url.href);
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

/** Stable short key for in-flight dedup maps (JSON payload → hex prefix). */
export function hashInflightPayload(payload: unknown): string {
  const hasher = sha256Hasher();
  hasher.update(JSON.stringify(payload));
  return hasher.digest("hex").slice(0, 16);
}

/** Read a ReadableStream as UTF-8 text (Bun.readableStreamToText). */
export async function readableStreamToText(
  stream: ReadableStream<Uint8Array> | null | undefined
): Promise<string> {
  if (!stream) return "";
  return Bun.readableStreamToText(stream);
}

/** Minimal fetch response shape when Bun fetch typings omit body/status helpers. */
export interface HttpFetchBody {
  readonly ok: boolean;
  readonly status: number;
  readonly body: ReadableStream<Uint8Array> | null;
}

export async function fetchHttp(url: string, init?: RequestInit): Promise<HttpFetchBody> {
  return (await fetch(url, init)) as unknown as HttpFetchBody;
}

export async function fetchJsonBody<T>(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetchHttp(url, init);
  const text = await readableStreamToText(res.body);
  return { ok: res.ok, status: res.status, data: JSON.parse(text) as T };
}

/** Test semver satisfaction (Bun.semver.satisfies). */
export function semverSatisfies(version: string, range: string): boolean {
  return Bun.semver.satisfies(version, range);
}

/**
 * Gzip compression (`Bun.gzipSync` / `Bun.gunzipSync`) — `Uint8Array` ↔ `Uint8Array`.
 * String helpers encode/decode UTF-8 at the boundary; prefer bytes pass-through when already binary.
 *
 * @see {@link BUN_GZIP_DOC_URL}
 */
/** @see https://bun.com/docs/guides/util/gzip */
export const BUN_GZIP_DOC_URL = "https://bun.com/docs/guides/util/gzip";

function gzipInput(data: string | Uint8Array): Uint8Array<ArrayBuffer> {
  if (typeof data === "string") {
    return new TextEncoder().encode(data) as Uint8Array<ArrayBuffer>;
  }
  return Uint8Array.from(data) as Uint8Array<ArrayBuffer>;
}

/** Gzip bytes with Bun.gzipSync. Accepts UTF-8 string or Uint8Array input. */
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

/** @see https://bun.com/docs/runtime/utils#bun-main */
export const BUN_MAIN_DOC_URL = "https://bun.com/docs/runtime/utils#bun-main";

/** Absolute path to the process entry script (`Bun.main`). */
export function entryScriptPath(): string {
  return Bun.main;
}

/**
 * True when `modulePath` is the process entry script (`import.meta.path === Bun.main`).
 * Use at the bottom of CLI bins instead of `import.meta.main` for a single SSOT surface.
 */
export function isDirectRun(modulePath: string): boolean {
  return modulePath === Bun.main;
}

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
        return await existing;
      }
    }
    return await existing;
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

/** Terminal display width (Bun.stringWidth). */
export function terminalWidth(text: string, countAnsi = false): number {
  return Bun.stringWidth(text, countAnsi ? { countAnsiEscapeCodes: true } : undefined);
}

/** HTML escape (Bun.escapeHTML). */
export function escapeHtml(value: string | number | boolean | object): string {
  return Bun.escapeHTML(value);
}

/** @see https://bun.com/docs/guides/util/version */
export const BUN_VERSION_GUIDE_DOC_URL = "https://bun.com/docs/guides/util/version";

/** @see https://bun.com/docs/guides/util/detect-bun */
export const BUN_DETECT_BUN_GUIDE_DOC_URL = "https://bun.com/docs/guides/util/detect-bun";

/** @see https://bun.com/docs/pm/cli/update */
export const BUN_PM_UPDATE_DOC_URL = "https://bun.com/docs/pm/cli/update";

export interface BunRuntimeDetection {
  /** True when `typeof Bun !== "undefined"` and `Bun.version` is a string. */
  detected: boolean;
  version: string;
  revision: string;
}

/**
 * Auto-detect the running Bun runtime (version + revision).
 * Refreshed on every call — use for doctor output, not cached policy rows.
 *
 * @see {@link BUN_DETECT_BUN_GUIDE_DOC_URL}
 * @see {@link BUN_VERSION_GUIDE_DOC_URL}
 */
export function detectBunRuntime(): BunRuntimeDetection {
  const detected = typeof Bun !== "undefined" && typeof Bun.version === "string";
  if (!detected) {
    return { detected: false, version: "unknown", revision: "unknown" };
  }
  return {
    detected: true,
    version: Bun.version,
    revision: typeof Bun.revision === "string" ? Bun.revision : "unknown",
  };
}

/** Bun CLI semver string. */
export function bunVersion(): string {
  return detectBunRuntime().version;
}

/** Bun build git revision. */
export function bunRevision(): string {
  return detectBunRuntime().revision;
}

/**
 * Local machine hostname for provenance metadata (`os.hostname`).
 *
 * Not `Bun.serve({ hostname })` / `server.hostname` — those are the server bind address
 * (default `"0.0.0.0"`). See {@link BUN_SERVE_HOSTNAME_DOC_URL}.
 *
 * Bun mirrors `node:os`; confine the import here rather than at feature call sites.
 */
/** @see https://bun.com/docs/runtime/http/server#changing-the-port-and-hostname */
export const BUN_SERVE_HOSTNAME_DOC_URL =
  "https://bun.com/docs/runtime/http/server#changing-the-port-and-hostname";

/** @see https://bun.com/reference/node/os/hostname */
export const BUN_OS_HOSTNAME_DOC_URL = "https://bun.com/reference/node/os/hostname";

export function runtimeHostname(): string {
  return osHostname();
}
