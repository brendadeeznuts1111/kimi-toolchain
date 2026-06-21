/**
 * Live dashboard for `references:inspect --watch`.
 *
 * Render priority:
 *   1. `Bun.markdown.ansi` — single-process, HMR-ready (`bun --hot run`), no PTY.
 *   2. `Bun.Terminal` (PTY) — child-process per render when ansi unavailable.
 *   3. Poll fallback — non-TTY environments (CI, piped output).
 */

import { join } from "path";
import type { Subprocess } from "bun";
import { watchPath } from "./bun-io.ts";
import {
  formatCanonicalReferencesMarkdown,
  type CanonicalReferencesInspectSection,
} from "./canonical-references.ts";
import { markdownAnsiSupported, renderMarkdownAnsi } from "./bun-markdown.ts";
import { withBunNoOrphans } from "./tool-runner.ts";

const stdinDecoder = new TextDecoder();

type FileWatcher = ReturnType<typeof watchPath>;

export const REFERENCES_INSPECT_CHILD_ENV = "KIMI_REFERENCES_INSPECT_CHILD";

export type ReferencesInspectWatchSection = CanonicalReferencesInspectSection;

export interface ReferencesInspectWatchOptions {
  repoRoot: string;
  initialSection?: ReferencesInspectWatchSection;
  debounceMs?: number;
  /** Poll interval when PTY/watch unavailable (non-TTY environments). */
  pollMs?: number;
}

export type ReferencesInspectWatchKeyAction =
  | { action: "quit" }
  | { action: "refresh" }
  | { action: "section"; section: ReferencesInspectWatchSection }
  | { action: "noop" };

const CLEAR_SCREEN = "\x1b[2J\x1b[H";
const HELP_LINE = "[watch] q quit · r refresh · 0 all · 1 ecosystem · 2 repos · 3 docs";
const WATCH_HELP_MD =
  "\n\n`[watch]` **q** quit · **r** refresh · **0** all · **1** ecosystem · **2** repos · **3** docs";

/** stderr banner when inspect child exits non-zero — parent stays alive for retry. */
export function formatWatchChildExitMessage(exitCode: number, section: string): string | null {
  if (exitCode === 0) return null;
  return `references:inspect --watch: child exited ${exitCode} (section=${section}) — edit source and retry, or press r`;
}

const WATCH_PATHS = [
  "canonical-references.toml",
  "src/lib/canonical-references-data.ts",
  "canonical-references.json",
] as const;

const ESC = String.fromCharCode(0x1b);

/** Strip escape sequences so arrow keys and modifiers do not confuse key parsing. */
export function stripTerminalInput(chunk: string): string {
  let result = "";
  let i = 0;
  while (i < chunk.length) {
    if (chunk[i] === ESC && chunk[i + 1] === "[") {
      i += 2;
      while (i < chunk.length) {
        const ch = chunk[i]!;
        i++;
        if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) break;
      }
      continue;
    }
    result += chunk[i];
    i++;
  }
  return result.trim();
}

export function parseReferencesInspectWatchKey(chunk: string): ReferencesInspectWatchKeyAction {
  const key = stripTerminalInput(chunk);
  const code = key.length > 0 ? key.charCodeAt(0) : -1;
  if (key === "q" || code === 3 || code === 4) return { action: "quit" };
  if (key === "r") return { action: "refresh" };
  if (key === "0") return { action: "section", section: "all" };
  if (key === "1") return { action: "section", section: "ecosystem" };
  if (key === "2") return { action: "section", section: "repos" };
  if (key === "3") return { action: "section", section: "docs" };
  return { action: "noop" };
}

export function canRunReferencesInspectPtyWatch(): { ok: boolean; reason?: string } {
  if (typeof Bun.Terminal !== "function") return { ok: false, reason: "Bun.Terminal unavailable" };
  if (!process.stdout.isTTY) return { ok: false, reason: "stdout is not a TTY" };
  if (!process.stdin.isTTY) return { ok: false, reason: "stdin is not a TTY" };
  return { ok: true };
}

/** Check whether `Bun.markdown.ansi` is available for in-process rendering. */
export function canRunReferencesInspectMarkdownWatch(): { ok: boolean; reason?: string } {
  if (!markdownAnsiSupported()) {
    return { ok: false, reason: "Bun.markdown.ansi unavailable" };
  }
  if (!process.stdout.isTTY) return { ok: false, reason: "stdout is not a TTY" };
  if (!process.stdin.isTTY) return { ok: false, reason: "stdin is not a TTY" };
  return { ok: true };
}

export function referencesInspectWatchPaths(repoRoot: string): string[] {
  return WATCH_PATHS.map((rel) => join(repoRoot, rel));
}

function isHotReloadActive(): boolean {
  return Boolean((import.meta as ImportMeta & { hot?: unknown }).hot);
}

function inspectChildArgs(inspectScript: string, section: ReferencesInspectWatchSection): string[] {
  return [inspectScript, "--section", section];
}

function childEnv(): Record<string, string> {
  return { ...(Bun.env as Record<string, string>), [REFERENCES_INSPECT_CHILD_ENV]: "1" };
}

async function killSubprocess(proc: Subprocess | null): Promise<void> {
  if (!proc) return;
  proc.kill();
  try {
    await proc.exited;
  } catch {
    // child may already be gone
  }
}

/** Load markdown from SSOT — static import under `bun --hot`, cache-busted dynamic import otherwise. */
async function loadCanonicalReferencesMarkdown(
  repoRoot: string,
  section: ReferencesInspectWatchSection
): Promise<string> {
  if (isHotReloadActive()) {
    return formatCanonicalReferencesMarkdown(false, section);
  }
  const dataTs = join(repoRoot, "src/lib/canonical-references-data.ts");
  await import(`${dataTs}?t=${Date.now()}`);
  const mod = (await import(
    `${join(repoRoot, "src/lib/canonical-references.ts")}?t=${Date.now()}`
  )) as {
    formatCanonicalReferencesMarkdown: (
      compact?: boolean,
      section?: ReferencesInspectWatchSection
    ) => string;
  };
  return mod.formatCanonicalReferencesMarkdown(false, section);
}

export async function runReferencesInspectWatch(
  options: ReferencesInspectWatchOptions
): Promise<void> {
  const md = canRunReferencesInspectMarkdownWatch();
  if (md.ok) {
    await runReferencesInspectMarkdownWatch(options);
    return;
  }
  const pty = canRunReferencesInspectPtyWatch();
  if (pty.ok) {
    await runReferencesInspectPtyWatch(options);
    return;
  }
  await runReferencesInspectPollWatch(
    options,
    `markdown: ${md.reason ?? "unavailable"}; PTY: ${pty.reason ?? "unavailable"}`
  );
}

/**
 * In-process watch mode using `Bun.markdown.ansi`.
 * Prefer `bun --hot run references:inspect --watch` so HMR reloads constants without cache-busting.
 */
async function runReferencesInspectMarkdownWatch(
  options: ReferencesInspectWatchOptions
): Promise<void> {
  const debounceMs = options.debounceMs ?? 100;
  const repoRoot = options.repoRoot;

  let currentSection: ReferencesInspectWatchSection = options.initialSection ?? "all";
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let renderInFlight = false;
  let renderQueued = false;

  const render = async (): Promise<void> => {
    if (renderInFlight) {
      renderQueued = true;
      return;
    }
    renderInFlight = true;
    try {
      const md = await loadCanonicalReferencesMarkdown(repoRoot, currentSection);
      const ansi = renderMarkdownAnsi(md + WATCH_HELP_MD, {
        columns: process.stdout.columns ?? 80,
        hyperlinks: true,
      });
      process.stdout.write(CLEAR_SCREEN + ansi + "\n");
    } catch (err) {
      process.stderr.write(`\n⚠️  references:inspect --watch: render error — ${String(err)}\n`);
    } finally {
      renderInFlight = false;
      if (renderQueued) {
        renderQueued = false;
        await render();
      }
    }
  };

  const scheduleRender = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void render(), debounceMs);
  };

  const forceRender = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    void render();
  };

  const watchers: FileWatcher[] = [];
  for (const path of referencesInspectWatchPaths(repoRoot)) {
    try {
      watchers.push(watchPath(path, () => scheduleRender()));
    } catch {
      // missing path — skip
    }
  }

  const onResize = (): void => {
    scheduleRender();
  };
  process.stdout.on("resize", onResize);

  process.stdin.setRawMode(true);
  process.stdin.resume();

  try {
    await render();
    for await (const chunk of process.stdin) {
      const parsed = parseReferencesInspectWatchKey(
        typeof chunk === "string" ? chunk : stdinDecoder.decode(chunk)
      );
      if (parsed.action === "quit") break;
      if (parsed.action === "refresh") forceRender();
      if (parsed.action === "section") {
        currentSection = parsed.section;
        forceRender();
      }
    }
  } finally {
    if (debounceTimer) clearTimeout(debounceTimer);
    for (const watcher of watchers) watcher.close();
    process.stdout.off("resize", onResize);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }
}

async function runReferencesInspectPtyWatch(options: ReferencesInspectWatchOptions): Promise<void> {
  const debounceMs = options.debounceMs ?? 100;
  const repoRoot = options.repoRoot;
  const inspectScript = join(repoRoot, "scripts/inspect-references.ts");

  await using terminal = new Bun.Terminal({
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
    data(_term, data) {
      process.stdout.write(data);
    },
  });

  let currentSection: ReferencesInspectWatchSection = options.initialSection ?? "all";
  let running: Subprocess | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let renderGeneration = 0;
  let renderInFlight = false;
  let renderQueued = false;

  const runInspect = async (): Promise<void> => {
    if (renderInFlight) {
      renderQueued = true;
      return;
    }
    renderInFlight = true;
    try {
      const generation = ++renderGeneration;
      await killSubprocess(running);
      if (generation !== renderGeneration) return;

      process.stdout.write(CLEAR_SCREEN);
      running = Bun.spawn(
        withBunNoOrphans([process.execPath, ...inspectChildArgs(inspectScript, currentSection)]),
        {
          terminal,
          cwd: repoRoot,
          env: childEnv(),
          stderr: "inherit",
        }
      );

      const code = await running.exited;
      if (generation !== renderGeneration) return;
      running = null;

      const errorBanner = formatWatchChildExitMessage(code, currentSection);
      if (errorBanner) process.stderr.write(`\n⚠️  ${errorBanner}\n`);

      process.stdout.write(`\n${HELP_LINE} · section=${currentSection} · exit=${code}\n`);
    } finally {
      renderInFlight = false;
      if (renderQueued) {
        renderQueued = false;
        await runInspect();
      }
    }
  };

  const scheduleRender = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void runInspect(), debounceMs);
  };

  const forceRender = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = null;
    void runInspect();
  };

  const watchers: FileWatcher[] = [];
  for (const path of referencesInspectWatchPaths(repoRoot)) {
    try {
      watchers.push(watchPath(path, () => scheduleRender()));
    } catch {
      // missing path — skip
    }
  }

  const onResize = (): void => {
    terminal.resize(process.stdout.columns ?? 80, process.stdout.rows ?? 24);
    scheduleRender();
  };
  process.stdout.on("resize", onResize);

  process.stdin.setRawMode(true);
  process.stdin.resume();

  let signalInterrupted = false;
  const onSignal = () => {
    signalInterrupted = true;
    process.stdin.destroy();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    await runInspect();
    for await (const chunk of process.stdin) {
      if (signalInterrupted) break;
      const parsed = parseReferencesInspectWatchKey(
        typeof chunk === "string" ? chunk : stdinDecoder.decode(chunk)
      );
      if (parsed.action === "quit") break;
      if (parsed.action === "refresh") forceRender();
      if (parsed.action === "section") {
        currentSection = parsed.section;
        forceRender();
      }
    }
  } finally {
    renderGeneration++;
    if (debounceTimer) clearTimeout(debounceTimer);
    for (const watcher of watchers) watcher.close();
    process.stdout.off("resize", onResize);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await killSubprocess(running);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  }
}

async function runReferencesInspectPollWatch(
  options: ReferencesInspectWatchOptions,
  reason: string
): Promise<void> {
  const pollMs = options.pollMs ?? 2_000;
  const repoRoot = options.repoRoot;
  const inspectScript = join(repoRoot, "scripts/inspect-references.ts");

  process.stderr.write(
    `references:inspect --watch: PTY unavailable (${reason}); using poll fallback every ${pollMs}ms\n`
  );
  process.stderr.write(`${HELP_LINE}\n`);

  let currentSection: ReferencesInspectWatchSection = options.initialSection ?? "all";
  let running: Subprocess | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const runInspect = async (): Promise<void> => {
    await killSubprocess(running);
    process.stdout.write(CLEAR_SCREEN);
    running = Bun.spawn(
      withBunNoOrphans([process.execPath, ...inspectChildArgs(inspectScript, currentSection)]),
      {
        cwd: repoRoot,
        env: childEnv(),
        stdout: "inherit",
        stderr: "inherit",
      }
    );
    const code = await running.exited;
    running = null;
    process.stdout.write(`\n${HELP_LINE} · section=${currentSection} · exit=${code}\n`);
  };

  await runInspect();
  pollTimer = setInterval(() => void runInspect(), pollMs);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    try {
      for await (const chunk of process.stdin) {
        const parsed = parseReferencesInspectWatchKey(
          typeof chunk === "string" ? chunk : stdinDecoder.decode(chunk)
        );
        if (parsed.action === "quit") break;
        if (parsed.action === "refresh") void runInspect();
        if (parsed.action === "section") {
          currentSection = parsed.section;
          void runInspect();
        }
      }
    } finally {
      if (pollTimer) clearInterval(pollTimer);
      await killSubprocess(running);
      process.stdin.setRawMode(false);
    }
    return;
  }

  await new Promise<void>((resolve) => {
    const onSignal = () => resolve();
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
  if (pollTimer) clearInterval(pollTimer);
  await killSubprocess(running);
}
