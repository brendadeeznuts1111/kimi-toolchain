/**
 * Bun runtime utilities — preferred call-site surface over Node polyfills.
 * Docs: https://bun.com/docs/runtime/utils · https://bun.com/docs/runtime/bun-apis
 *
 * Use these helpers in feature code; keep node:* imports confined to bun-io.ts.
 * For inspect output, equality, and ANSI helpers see src/lib/inspect.ts.
 */

import { join } from "path";
import { peek, password } from "bun";
import { deserialize, estimateShallowMemoryUsageOf, serialize } from "bun:jsc";
import {
  cpus,
  freemem,
  hostname as osHostname,
  release as osRelease,
  totalmem,
  type as osType,
  uptime as osUptime,
  userInfo,
} from "os";
import { safeToml } from "./safe-parse.ts";

/**
 * Generate a time-sortable trace ID (UUIDv7, 32 hex chars, no dashes).
 * Use for correlating log entries to a TraceEvent in trace-ledger.
 */
export function generateTraceId(): string {
  return Bun.randomUUIDv7().replace(/-/g, "");
}

/**
 * Generate a time-sortable span ID (first 16 hex chars of a stripped UUIDv7 — 64-bit).
 * Shorter than a full trace ID; scopes a sub-operation within a trace.
 */
export function generateSpanId(): string {
  return Bun.randomUUIDv7().replace(/-/g, "").slice(0, 16);
}

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

/** @see https://bun.com/guides/util/hash-a-password */
export const BUN_PASSWORD_DOC_URL = "https://bun.com/guides/util/hash-a-password";

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
 * Encrypted JSONL pattern: `iv.toBase64()` + `ciphertext.toBase64()` per line,
 * each independently decryptable via `crypto.subtle.decrypt` + `fromBase64`.
 *
 * @see {@link BUN_BASE64_DOC_URL}
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
 */
/** @see https://bun.com/guides/util/base64 */
export const BUN_BASE64_DOC_URL = "https://bun.com/guides/util/base64";

/** Binary conversion recipes index — footer target for guides/binary/*. */
export const BUN_BINARY_DATA_CONVERSION_DOC_URL =
  "https://bun.com/docs/runtime/binary-data#conversion";

/** Encode bytes to base64 (`Uint8Array.prototype.toBase64`). */
export function encodeBase64Bytes(bytes: Uint8Array): string {
  return bytes.toBase64();
}

/** Decode base64 to bytes (`Uint8Array.fromBase64`). */
export function decodeBase64Bytes(encoded: string): Uint8Array {
  return Uint8Array.fromBase64(encoded);
}

/** Encode bytes to base64url without padding (`Uint8Array.prototype.toBase64`). */
export function encodeBase64UrlBytes(bytes: Uint8Array): string {
  return bytes.toBase64({ alphabet: "base64url", omitPadding: true });
}

/** Decode base64url to bytes (`Uint8Array.fromBase64`). */
export function decodeBase64UrlBytes(encoded: string): Uint8Array {
  return Uint8Array.fromBase64(encoded, { alphabet: "base64url" });
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

/**
 * UTF-8 encode a string to bytes (`TextEncoder`).
 *
 * @see {@link BUN_BINARY_DATA_CONVERSION_DOC_URL}
 */
export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * UTF-8 decode bytes to string (`TextDecoder`).
 * Accepts `Uint8Array`, `ArrayBuffer`, and `DataView` per binary conversion guides.
 *
 * @see {@link BUN_BINARY_DATA_CONVERSION_DOC_URL}
 * @see https://bun.com/guides/binary/dataview-to-string
 */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** UTF-8 byte length for a string (`TextEncoder`). */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** @see https://bun.com/reference/bun/randomUUIDv7#bun.randomUUIDv7 */
export const BUN_RANDOM_UUIDV7_DOC_URL = "https://bun.com/reference/bun/randomUUIDv7";

export type PeekStatus = "fulfilled" | "pending" | "rejected";

/** Parse TOML text (Bun.TOML.parse) with plain-object root validation. */
export function parseToml(text: string): Record<string, unknown> {
  const parsed: unknown = Bun.TOML.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("TOML root must be a table/object");
  }
  return parsed as Record<string, unknown>;
}

/** Stable short key for in-flight dedup maps (JSON payload → hex prefix). */
export function hashInflightPayload(payload: unknown): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify(payload));
  return hasher.digest("hex").slice(0, 16);
}

/** Read a ReadableStream as UTF-8 text (ReadableStream.text — replaces deprecated Bun.readableStreamToText). */
export async function readableStreamToText(
  stream: ReadableStream<Uint8Array> | null | undefined
): Promise<string> {
  if (!stream) return "";
  return stream.text();
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

// All version comparisons use Bun.semver directly.
// @see https://bun.com/docs/runtime/semver

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

/** @see https://bun.com/docs/runtime/utils */
export const BUN_RUNTIME_UTILS_DOC_URL = "https://bun.com/docs/runtime/utils";

/**
 * True when `modulePath` is the process entry script (`import.meta.path === Bun.main`).
 * Use at the bottom of CLI bins instead of `import.meta.main` for a single SSOT surface.
 */
export function isDirectRun(modulePath: string): boolean {
  return modulePath === Bun.main;
}

/** @see https://bun.com/docs/runtime/utils#bun-openineditor */
export const BUN_OPEN_IN_EDITOR_DOC_URL = "https://bun.com/docs/runtime/utils#bun-openineditor";

export interface OpenInEditorOptions {
  /** Editor identifier, e.g. "vscode", "subl", "code". */
  editor?: string;
  /** 1-based line number. */
  line?: number;
  /** 1-based column number. */
  column?: number;
}

/**
 * Open a file or URL in the user's default editor (`Bun.openInEditor`).
 * Useful for CLI commands that jump to a config, contract, or failure source.
 */
export function openFileInEditor(file: string | URL, options?: OpenInEditorOptions): void {
  Bun.openInEditor(file as string, options as Parameters<typeof Bun.openInEditor>[1]);
}

export interface EditorRuntimeSnapshot {
  /** $VISUAL when set. */
  visual?: string;
  /** $EDITOR when set. */
  editorEnv?: string;
  /** `[debug].editor` from active bunfig.toml. */
  bunfigEditor?: string;
  /** Resolved bunfig path, if any. */
  activeBunfig?: string;
  /** Effective editor: bunfig > VISUAL > EDITOR. */
  resolved?: string;
}

/** Resolve active bunfig.toml (project-local, then ~/.bunfig.toml). */
export async function resolveActiveBunfigPath(cwd = process.cwd()): Promise<string | null> {
  const local = join(cwd, "bunfig.toml");
  if (await Bun.file(local).exists()) return local;
  const home = Bun.env.HOME;
  if (home) {
    const globalPath = join(home, ".bunfig.toml");
    if (await Bun.file(globalPath).exists()) return globalPath;
  }
  return null;
}

interface BunfigDebugSection {
  debug?: { editor?: string };
}

/** Read `[debug].editor` from the active bunfig.toml, if set. */
export async function readDebugEditorFromBunfig(cwd = process.cwd()): Promise<{
  editor?: string;
  bunfigPath?: string;
}> {
  const bunfigPath = await resolveActiveBunfigPath(cwd);
  if (!bunfigPath) return {};
  try {
    const text = await Bun.file(bunfigPath).text();
    const parsed = safeToml<BunfigDebugSection>(text, {});
    const editor = parsed.debug?.editor?.trim();
    return editor ? { editor, bunfigPath } : { bunfigPath };
  } catch {
    return { bunfigPath };
  }
}

/** Editor detection aligned with Bun.openInEditor precedence. */
export async function inspectEditorRuntime(cwd = process.cwd()): Promise<EditorRuntimeSnapshot> {
  const visual = Bun.env.VISUAL?.trim();
  const editorEnv = Bun.env.EDITOR?.trim();
  const bunfig = await readDebugEditorFromBunfig(cwd);
  const resolved = bunfig.editor ?? visual ?? editorEnv;
  return {
    visual,
    editorEnv,
    bunfigEditor: bunfig.editor,
    activeBunfig: bunfig.bunfigPath,
    resolved,
  };
}

/** One-line editor summary for runtime:info. */
export function formatEditorRuntimeSnapshot(snap: EditorRuntimeSnapshot): string {
  const lines = [`editor:     ${snap.resolved ?? "unset (set $EDITOR or [debug].editor)"}`];
  if (snap.bunfigEditor) lines.push(`  bunfig:     ${snap.bunfigEditor} (${snap.activeBunfig})`);
  else if (snap.activeBunfig) lines.push(`  bunfig:     ${snap.activeBunfig} (no [debug].editor)`);
  if (snap.visual) lines.push(`  VISUAL:     ${snap.visual}`);
  if (snap.editorEnv) lines.push(`  EDITOR:     ${snap.editorEnv}`);
  return lines.join("\n");
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

export type InflightCoalescer = (run: () => Promise<void>) => void;

/**
 * Cron-style coalescing: skip when the previous run is still pending (Bun.peek).
 * Replaces boolean `isRunning` guards — peek reads promise state synchronously.
 */
export function createInflightCoalescer(): InflightCoalescer {
  let current: Promise<void> | null = null;
  return (run) => {
    if (current !== null && peekPromiseStatus(current) === "pending") {
      return;
    }
    const promise = run().finally(() => {
      if (current === promise) current = null;
    });
    current = promise;
    void promise;
  };
}

const defaultInflightCoalescer = createInflightCoalescer();

/** Module-default coalescer (cron-health and one-off scripts). */
export function runIfNotInflight(run: () => Promise<void>): void {
  defaultInflightCoalescer(run);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

/** `Bun.sleep` with early abort via `signal`. Cancels the sleep when signal fires. */
export async function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError();
  let cleanup: (() => void) | undefined;
  try {
    await Promise.race([
      Bun.sleep(ms),
      new Promise<never>((_, reject) => {
        const onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort, { once: true });
        cleanup = () => signal.removeEventListener("abort", onAbort);
      }),
    ]);
  } finally {
    cleanup?.();
  }
}

/**
 * setInterval-equivalent: wait `intervalMs`, then run `tick`, repeat until aborted.
 * First tick runs after the initial delay (not immediately).
 */
export function startDelayedIntervalLoop(
  intervalMs: number,
  tick: () => void | Promise<void>
): AbortController {
  const controller = new AbortController();
  void (async () => {
    const { signal } = controller;
    while (!signal.aborted) {
      try {
        await sleepAbortable(intervalMs, signal);
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        console.error("[startDelayedIntervalLoop] sleep error:", error);
        return;
      }
      if (signal.aborted) return;
      try {
        await tick();
      } catch (error) {
        console.error("[startDelayedIntervalLoop] tick error:", error);
        return;
      }
    }
  })();
  return controller;
}

/**
 * setInterval-equivalent: run `tick` immediately, wait `intervalMs`, repeat until aborted.
 */
export function startIntervalLoop(
  intervalMs: number,
  tick: () => void | Promise<void>
): AbortController {
  const controller = new AbortController();
  void (async () => {
    const { signal } = controller;
    while (!signal.aborted) {
      try {
        await tick();
      } catch (error) {
        console.error("[startIntervalLoop] tick error:", error);
        return;
      }
      if (signal.aborted) return;
      try {
        await sleepAbortable(intervalMs, signal);
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        console.error("[startIntervalLoop] sleep error:", error);
        return;
      }
    }
  })();
  return controller;
}

/** Abort an interval loop started with {@link startDelayedIntervalLoop} or {@link startIntervalLoop}. */
export function stopDelayedIntervalLoop(controller: AbortController | null): void {
  controller?.abort();
}

// ---------------------------------------------------------------------------
// Bun.cron compatibility — native cron when available (Bun ≥1.3.12), else interval loop
// ---------------------------------------------------------------------------

const BUN_CRON_READY = typeof (Bun as Record<string, unknown>).cron === "function";

/**
 * Start a periodic loop using `Bun.cron` when available (Bun ≥1.3.12),
 * falling back to {@link startIntervalLoop} on older runtimes.
 *
 * Cron form: in-process, no overlap, UTC, `--hot` safe, disposable via `using`.
 * Interval form: same AbortController-based loop used elsewhere in the codebase.
 *
 * @param cronExpr 6-field cron expression (e.g. `"* * * * * *"` for every second)
 * @param intervalMs Fallback interval in milliseconds (used when Bun.cron unavailable)
 * @param tick Async callback — next invocation waits for the previous Promise to settle
 * @returns AbortController — call `.abort()` to stop
 */
export function startCronLoop(
  cronExpr: string,
  intervalMs: number,
  tick: () => void | Promise<void>
): AbortController {
  if (BUN_CRON_READY) {
    const controller = new AbortController();
    const cron = (
      Bun as unknown as { cron: (expr: string, cb: () => void) => { dispose: () => void } }
    ).cron(cronExpr, async () => {
      if (controller.signal.aborted) return;
      try {
        await tick();
      } catch {
        // Cron errors are surfaced via unhandledRejection — no crash
      }
      // Signal may have fired during tick — cron.dispose() won't cancel in-flight ticks
      if (controller.signal.aborted) return;
    });
    controller.signal.addEventListener("abort", () => cron.dispose(), { once: true });
    return controller;
  }
  return startIntervalLoop(intervalMs, tick);
}

/** @see https://bun.com/guides/util/version */
export const BUN_VERSION_GUIDE_DOC_URL = "https://bun.com/guides/util/version";

/** @see https://bun.com/guides/util/detect-bun */
export const BUN_DETECT_BUN_GUIDE_DOC_URL = "https://bun.com/guides/util/detect-bun";

/** Bun release registry — canonical definitions in bun-release-registry.ts */
export {
  BUN_ARCHIVE_RELEASE_URL,
  BUN_BUFFER_FROM_RELEASE_URL,
  BUN_COMPILE_EXECUTABLE_PATH_RELEASE_URL,
  BUN_CPU_PROF_MD_RELEASE_URL,
  BUN_JSON5_RELEASE_URL,
  BUN_JSONC_RELEASE_URL,
  BUN_JSONL_RELEASE_URL,
  BUN_RELEASE,
  BUN_RELEASE_1_3_6_FEATURE_ANCHORS,
  BUN_RELEASE_BLOG_URL,
  BUN_RELEASE_FEATURE_ANCHORS,
  BUN_RELEASE_HISTORY,
  BUN_RELEASE_PREVIOUS,
  BUN_WEBSOCKET_PROXY_RELEASE_URL,
  BUN_WRAP_ANSI_RELEASE_URL,
  BUN_HEAP_PROF_RELEASE_URL,
  BUN_HEADER_CASE_RELEASE_URL,
  BUN_NODE_INSPECTOR_RELEASE_URL,
  BUN_BUFFER_SWAP_RELEASE_URL,
  BUN_REPL_MODE_RELEASE_URL,
  BUN_S3_PRESIGN_RELEASE_URL,
  BUN_S3_CONTENT_ENCODING_RELEASE_URL,
  BUN_FFI_NIXOS_RELEASE_URL,
  breakingChangeCount,
  buildReleaseHistoryRows,
  computeReleaseDiff,
  computeReleaseDiffVersions,
  formatBreakingCell,
  measureReleaseHistoryRows,
  ReleaseRegistryError,
  commitHashFromUrl,
  releaseRoleForVersion,
  releaseCommitUrl,
  releaseFeatureUrl,
  releaseMarkdownAlt,
  releaseOgImage,
  semverCompare,
  sortReleaseVersions,
  type BunReleaseRecord,
  type ReleaseRole,
  type BunReleaseVersion,
  type ReleaseDiff,
  type ReleaseHistoryMetrics,
  type ReleaseHistoryRow,
} from "./bun-release-registry.ts";

export {
  formatReleaseHistoryMarkdown,
  formatReleaseHistoryTable,
  RELEASE_BREAKING_PROPERTIES,
  RELEASE_HISTORY_FULL_PROPERTIES,
  RELEASE_HISTORY_SUMMARY_PROPERTIES,
  RELEASE_TABLE_PRINTER_OPTS,
  renderReleaseTable,
  type ReleaseHistoryTableOptions,
} from "./bun-release-inspect.ts";

export {
  ALLOWED_DELAY_ONLY,
  ALLOWED_DLL_IMPORTS,
  GLIBC_FLOOR,
  formatPortabilityViolationTable,
  glibcVersionAboveFloor,
  parseGlibcSymbolViolations,
  parseLibatomicLines,
  parsePeImports,
  peImportViolations,
  type GlibcSymbolViolation,
  type PeImport,
  type PeImportKind,
} from "./bun-binary-portability.ts";

export {
  runWebGlobalsContractProbes,
  type WebGlobalsProbeResult,
} from "./bun-web-globals-contract.ts";

export {
  auditCliAlignment,
  BUN_UPSTREAM_CLI_COVERAGE_RULES,
  BUN_UPSTREAM_CLI_SECTIONS,
  BUN_UPSTREAM_CLI_TEST_FILE_COUNT,
  BUN_UPSTREAM_CLI_TEST_FILES,
  BUN_UPSTREAM_HARNESS_PATH,
  BUN_UPSTREAM_TEST_CLI_TREE_URL,
  BUN_UPSTREAM_TEST_COMMIT,
  BUN_UPSTREAM_TEST_REFS,
  BUN_UPSTREAM_TEST_TREE_URL,
  auditCliCaseAlignment,
  BUN_UPSTREAM_CLI_CASE_COUNT,
  BUN_UPSTREAM_CLI_PORT_REFS,
  buildCliAlignmentRows,
  buildCliPortRefRows,
  buildUpstreamCliSectionRows,
  buildUpstreamTestRefRows,
  resolveCliTestCoverage,
  upstreamBlobUrl,
  upstreamTreeUrl,
  type BunUpstreamCliSection,
  type BunUpstreamTestRef,
  type BunUpstreamTestRefId,
  type CliAlignmentReport,
  type CliCaseAlignmentReport,
  type CliCoverageKind,
  type CliCoverageRule,
  type CliPortRef,
  type CliTestCoverage,
} from "./bun-upstream-test-refs.ts";

export {
  normalizeConsoleOutput,
  runAllCliContractProbes,
  runBunCliContractProbes,
  runBunfigTestOptionsProbes,
  runBunOptionsContractProbes,
  runConsoleDepthContractProbes,
  runHeapProfContractProbes,
  runUserAgentContractProbes,
  type CliContractProbeResult,
} from "./bun-cli-contract-probes.ts";

export { runRunTestContractProbes } from "./bun-cli-run-test-probes.ts";

/** Read the pinned Bun version from `.bun-version` if present. */
export async function readPinnedBunVersion(projectRoot = process.cwd()): Promise<string | null> {
  const file = Bun.file(join(projectRoot, ".bun-version"));
  if (!(await file.exists())) return null;
  const text = (await file.text()).trim();
  return text || null;
}

export interface BunVersionPinResult {
  ok: boolean;
  pinned: string | null;
  actual: string;
  reason?: string;
}

/**
 * Verify the running Bun runtime satisfies the pinned version in `.bun-version`.
 * A missing pin is treated as ok (no gate). A missing Bun runtime is a hard fail.
 */
export async function checkBunVersionPin(
  actualVersion: string = Bun.version,
  projectRoot = process.cwd()
): Promise<BunVersionPinResult> {
  const pinned = await readPinnedBunVersion(projectRoot);
  if (!pinned) {
    return { ok: true, pinned: null, actual: actualVersion };
  }
  const cmp = Bun.semver.order(actualVersion, pinned) as -1 | 0 | 1;
  if (cmp < 0) {
    return {
      ok: false,
      pinned,
      actual: actualVersion,
      reason: `Bun ${actualVersion} is older than pinned ${pinned}`,
    };
  }
  return { ok: true, pinned, actual: actualVersion };
}

export interface BunRuntimeDetection {
  /** True when `typeof Bun !== "undefined"` and `Bun.version` is a string. */
  detected: boolean;
  version: string;
  revision: string;
}

export type BunRuntimeChannel = "stable" | "canary" | "unknown";

/** Host OS metadata for provenance and doctor output. */
export interface OsRuntimeSnapshot {
  /** Node platform id — `darwin`, `linux`, `win32`. */
  platform: string;
  /** CPU architecture — `arm64`, `x64`, etc. */
  arch: string;
  /** OS proper name from `os.type()` — e.g. `Darwin`, `Linux`. */
  type: string;
  /** OS/kernel release from `os.release()`. */
  release: string;
  /** Local hostname (`os.hostname()`). */
  hostname: string;
}

/** Collect host OS fields without subprocess calls. */
export function inspectOsRuntime(): OsRuntimeSnapshot {
  return {
    platform: process.platform,
    arch: process.arch,
    type: osType(),
    release: osRelease(),
    hostname: osHostname(),
  };
}

/** Host CPU metadata from `os.cpus()` and Bun parallelism helpers. */
export interface CpuRuntimeSnapshot {
  /** CPU architecture — `arm64`, `x64`, etc. */
  arch: string;
  /** Logical CPU count (`os.cpus().length`). */
  cores: number;
  /** Scheduler parallelism (`Bun.availableParallelism()` or hardware concurrency). */
  parallelism: number;
  /** Model string from the first CPU entry. */
  model: string;
  /** Reported max clock speed (MHz) for the first core, when available. */
  speedMhz?: number;
}

/** Collect CPU fields without subprocess calls. */
export function inspectCpuRuntime(): CpuRuntimeSnapshot {
  const list = cpus();
  const first = list[0];
  const bun = Bun as typeof Bun & { availableParallelism?: () => number };
  let parallelism = 0;
  if (typeof bun.availableParallelism === "function") {
    parallelism = bun.availableParallelism();
  }
  if (parallelism <= 0) {
    parallelism =
      typeof navigator !== "undefined" && navigator.hardwareConcurrency > 0
        ? navigator.hardwareConcurrency
        : list.length || 1;
  }
  return {
    arch: process.arch,
    cores: list.length || 1,
    parallelism,
    model: first?.model?.trim() || "unknown",
    speedMhz: first?.speed,
  };
}

/** System memory snapshot from `os.totalmem()` / `os.freemem()`. */
export interface MemoryRuntimeSnapshot {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  /** Used memory percentage (0–100, one decimal). */
  usedPercent: number;
}

/** Process + session host metadata. */
export interface HostRuntimeSnapshot {
  pid: number;
  /** This process uptime in seconds. */
  uptimeSeconds: number;
  /** OS uptime in seconds. */
  osUptimeSeconds: number;
  user: string;
  timezone: string;
  /** Node-compat version string embedded in Bun (`process.version`). */
  nodeVersion: string;
}

export function formatMemoryBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} MB`;
}

/** Collect memory usage without subprocess calls. */
export function inspectMemoryRuntime(): MemoryRuntimeSnapshot {
  const totalBytes = totalmem();
  const freeBytes = freemem();
  const usedBytes = totalBytes - freeBytes;
  return {
    totalBytes,
    freeBytes,
    usedBytes,
    usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
  };
}

/** Process memory usage snapshot (`process.memoryUsage()`). */
export interface ProcessMemorySnapshot {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

/** Format process memory fields as human-readable strings. */
export function formatProcessMemoryUsage(
  mem: ProcessMemorySnapshot = process.memoryUsage()
): Record<keyof ProcessMemorySnapshot, string> {
  return {
    rss: formatMemoryBytes(mem.rss),
    heapTotal: formatMemoryBytes(mem.heapTotal),
    heapUsed: formatMemoryBytes(mem.heapUsed),
    external: formatMemoryBytes(mem.external),
    arrayBuffers: formatMemoryBytes(mem.arrayBuffers),
  };
}

/** Cached timezone — resolved once, constant for process lifetime. */
let _cachedTimezone: string | undefined;

function resolveTimezone(): string {
  if (_cachedTimezone === undefined) {
    _cachedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  return _cachedTimezone;
}

/** Collect process/host session metadata. */
export function inspectHostRuntime(): HostRuntimeSnapshot {
  let user = "unknown";
  try {
    user = userInfo().username;
  } catch {
    // userInfo can fail in hardened/sandbox environments
  }
  return {
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    osUptimeSeconds: Math.round(osUptime()),
    user,
    timezone: resolveTimezone(),
    nodeVersion: process.version,
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** Extended runtime snapshot — version, revision, entry, PATH, channel. */
export interface BunRuntimeSnapshot extends BunRuntimeDetection {
  /** Entry script path (`Bun.main`). */
  main: string;
  /** Node-compat detect string (`process.versions.bun`). */
  processVersion?: string;
  /** Resolved `bun` binary on PATH, if any. */
  executable: string | null;
  /** Inferred from semver string (e.g. `1.4.0-canary.1`). */
  channel: BunRuntimeChannel;
  /** Host OS metadata (`os.type`, `os.release`, hostname, platform, arch). */
  os: OsRuntimeSnapshot;
  /** Host CPU metadata (model, cores, parallelism). */
  cpu: CpuRuntimeSnapshot;
  /** System memory (total/free/used). */
  memory: MemoryRuntimeSnapshot;
  /** Process pid, user, uptime, timezone, Node compat version. */
  host: HostRuntimeSnapshot;
  /** Current working directory. */
  cwd: string;
  /** Short git revision prefix for display. */
  revisionShort: string;
  /** True when `Bun.main` is `[eval]` (inline `bun -e`, not a file). */
  evalMode: boolean;
}

/** Infer stable vs canary from `Bun.version`. */
export function inferBunRuntimeChannel(version: string): BunRuntimeChannel {
  if (!version || version === "unknown") return "unknown";
  if (/canary/i.test(version)) return "canary";
  return "stable";
}

/** True when the process was started with `bun -e` / eval rather than a script file. */
export function isBunEvalMain(main: string): boolean {
  return main === "[eval]" || main.endsWith("/[eval]") || main.endsWith("\\[eval]");
}

function revisionShortLabel(revision: string): string {
  if (!revision || revision === "unknown") return "unknown";
  return revision.length <= 12 ? revision : revision.slice(0, 12);
}

function emptyRuntimeSnapshot(base: BunRuntimeDetection): BunRuntimeSnapshot {
  return {
    ...base,
    main: "unknown",
    executable: null,
    channel: "unknown",
    os: inspectOsRuntime(),
    cpu: inspectCpuRuntime(),
    memory: inspectMemoryRuntime(),
    host: inspectHostRuntime(),
    cwd: process.cwd(),
    revisionShort: revisionShortLabel(base.revision),
    evalMode: false,
  };
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

/**
 * Full Bun runtime snapshot for doctor, CLI one-liners, and provenance JSON.
 *
 * @example
 * bun run runtime:info
 * bun -e 'import { formatFullBunRuntimeSnapshot } from "./src/lib/bun-utils.ts"; console.log(formatFullBunRuntimeSnapshot())'
 * bun -e 'import { bunRuntimeSnapshotJson } from "./src/lib/bun-utils.ts"; console.log(bunRuntimeSnapshotJson())'
 */
export function inspectBunRuntime(): BunRuntimeSnapshot {
  const base = detectBunRuntime();
  if (!base.detected) {
    return emptyRuntimeSnapshot(base);
  }
  const main = Bun.main;
  return {
    ...base,
    main,
    processVersion: process.versions.bun,
    executable: Bun.which("bun"),
    channel: inferBunRuntimeChannel(base.version),
    os: inspectOsRuntime(),
    cpu: inspectCpuRuntime(),
    memory: inspectMemoryRuntime(),
    host: inspectHostRuntime(),
    cwd: process.cwd(),
    revisionShort: revisionShortLabel(base.revision),
    evalMode: isBunEvalMain(main),
  };
}

/** Human-readable multi-line runtime summary for CLI one-liners. */
export function formatBunRuntimeSnapshot(
  snap: BunRuntimeSnapshot,
  extras?: {
    engineRange?: string;
    engineSatisfied?: boolean;
    packageManager?: string;
    processMemory?: ProcessMemorySnapshot;
  }
): string {
  const { os, cpu, memory, host } = snap;
  const speed = cpu.speedMhz ? ` @ ${cpu.speedMhz} MHz` : "";
  const lines = [
    `Bun ${snap.version} (${snap.channel}) · ${os.type} ${os.release} (${os.platform}/${os.arch})`,
    `  os:         ${os.type} ${os.release} · ${os.platform}/${os.arch}`,
    `  hostname:   ${os.hostname}`,
    `  cpu:        ${cpu.model} · ${cpu.cores} core(s) · parallelism ${cpu.parallelism}${speed}`,
    `  memory:     ${formatMemoryBytes(memory.usedBytes)} used / ${formatMemoryBytes(memory.totalBytes)} (${memory.usedPercent}%)`,
  ];
  if (extras?.processMemory) {
    const pm = formatProcessMemoryUsage(extras.processMemory);
    lines.push(
      `  processMem: rss ${pm.rss} · heap ${pm.heapUsed}/${pm.heapTotal} · external ${pm.external}`
    );
  }
  lines.push(
    `  host:       pid ${host.pid} · ${host.user} · tz ${host.timezone}`,
    `  uptime:     process ${formatDuration(host.uptimeSeconds)} · os ${formatDuration(host.osUptimeSeconds)}`,
    `  node:       ${host.nodeVersion} (compat)`,
    `  revision:   ${snap.revision}`,
    `  revision↯:  ${snap.revisionShort}`,
    `  main:       ${snap.main}${snap.evalMode ? "  ← eval (use bun run <file> for script entry)" : ""}`,
    `  cwd:        ${snap.cwd}`,
    `  executable: ${snap.executable ?? "not on PATH"}`,
    `  process:    process.versions.bun = ${snap.processVersion ?? "n/a"}`
  );
  if (extras?.packageManager) {
    lines.push(`  pm:         ${extras.packageManager}`);
  }
  if (extras?.engineRange !== undefined) {
    lines.push(
      `  engine:     ${extras.engineRange} → ${extras.engineSatisfied ? "satisfied" : "NOT satisfied"}`
    );
  }
  return lines.join("\n");
}

/** Pretty-print full runtime snapshot (Bun + OS + CPU + optional engine check). */
export function formatFullBunRuntimeSnapshot(
  engineRange = ">=1.4.0",
  extras?: {
    packageManager?: string;
    projectName?: string;
    projectVersion?: string;
    processMemory?: ProcessMemorySnapshot;
  }
): string {
  const report = bunRuntimeReport(engineRange);
  const lines = [
    formatBunRuntimeSnapshot(report, {
      engineRange: report.engineRange,
      engineSatisfied: report.engineSatisfied,
      packageManager: extras?.packageManager,
      processMemory: extras?.processMemory,
    }),
  ];
  if (extras?.projectName) {
    lines.push(
      `  project:    ${extras.projectName}${extras.projectVersion ? `@${extras.projectVersion}` : ""}`
    );
  }
  return lines.join("\n");
}

/** Full runtime JSON (Bun + OS + CPU + engine check). */
export function bunRuntimeSnapshotJson(engineRange = ">=1.4.0"): BunRuntimeSnapshot & {
  engineRange?: string;
  engineSatisfied?: boolean;
} {
  return bunRuntimeReport(engineRange);
}

/** JSON-friendly runtime row with optional engine range check. */
export function bunRuntimeReport(engineRange?: string): BunRuntimeSnapshot & {
  engineRange?: string;
  engineSatisfied?: boolean;
} {
  const snapshot = inspectBunRuntime();
  if (!engineRange) return snapshot;
  return {
    ...snapshot,
    engineRange,
    engineSatisfied: snapshot.detected
      ? Bun.semver.satisfies(snapshot.version, engineRange)
      : false,
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

/** @see https://bun.com/docs/runtime/utils#serialize-deserialize-in-bun-jsc */
export const BUN_JSC_SERIALIZE_DOC_URL =
  "https://bun.com/docs/runtime/utils#serialize-deserialize-in-bun-jsc";

/**
 * Serialize a value to an ArrayBuffer-like buffer using the structured clone algorithm
 * (`bun:jsc` `serialize`). Same format used by `structuredClone` and `postMessage`.
 */
export function structuredCloneSerialize<T>(value: T): ArrayBufferLike {
  return serialize(value) as ArrayBufferLike;
}

/**
 * Deserialize a structured-clone buffer back to a value (`bun:jsc` `deserialize`).
 */
export function structuredCloneDeserialize<T>(buffer: ArrayBufferLike): T {
  return deserialize(buffer) as T;
}

/** @see https://bun.com/docs/runtime/utils#estimateshallowmemoryusageof-in-bun-jsc */
export const BUN_JSC_MEMORY_USAGE_DOC_URL =
  "https://bun.com/docs/runtime/utils#estimateshallowmemoryusageof-in-bun-jsc";

/**
 * Best-effort shallow memory usage estimate for an object, in bytes (`bun:jsc`
 * `estimateShallowMemoryUsageOf`). Excludes referenced objects; use heap snapshots
 * for accurate per-object accounting.
 */
export function estimateShallowMemoryUsage(
  value: string | bigint | symbol | object | CallableFunction
): number {
  return estimateShallowMemoryUsageOf(value);
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
