/**
 * File-triggered perf re-runs — uses node:fs.watch (Bun's rewritten backend).
 */

import { watch } from "node:fs";
import { join } from "path";

export const PERF_WATCH_REL_PATHS = ["src/harness", "src/lib/isolation"] as const;
export const PERF_WATCH_DEBOUNCE_MS = 300;

export interface PerfWatchOptions {
  projectRoot: string;
  debounceMs?: number;
  signal: AbortSignal;
  onRun: () => Promise<void>;
  log?: (line: string) => void;
}

/** Debounced fs.watch loop; runs onRun once immediately, then on file changes. */
export async function runPerfWatchLoop(options: PerfWatchOptions): Promise<void> {
  const debounceMs = options.debounceMs ?? PERF_WATCH_DEBOUNCE_MS;
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const schedule = () => {
    if (options.signal.aborted) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      if (running || options.signal.aborted) return;
      running = true;
      try {
        await options.onRun();
      } finally {
        running = false;
      }
    }, debounceMs);
  };

  const watchers: ReturnType<typeof watch>[] = [];
  for (const rel of PERF_WATCH_REL_PATHS) {
    const path = join(options.projectRoot, rel);
    try {
      watchers.push(
        watch(path, { recursive: true }, (_event, filename) => {
          if (filename) schedule();
        })
      );
    } catch (err) {
      log(`watch skip ${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log(
    `perf-doctor — watch (${PERF_WATCH_REL_PATHS.join(", ")}, debounce ${debounceMs}ms, Ctrl+C to stop)`
  );

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers) w.close();
  };

  options.signal.addEventListener("abort", cleanup, { once: true });

  await options.onRun();

  while (!options.signal.aborted) {
    await Bun.sleep(60_000);
  }

  cleanup();
}

/** Register shutdown signals for watch mode (incl. Windows console close). */
export function bindPerfWatchSignals(onAbort: () => void): void {
  const handler = () => onAbort();
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  if (process.platform === "win32") {
    process.on("SIGHUP", handler);
    process.on("SIGBREAK", handler);
  }
}

export function unbindPerfWatchSignals(onAbort: () => void): void {
  process.off("SIGINT", onAbort);
  process.off("SIGTERM", onAbort);
  if (process.platform === "win32") {
    process.off("SIGHUP", onAbort);
    process.off("SIGBREAK", onAbort);
  }
}
