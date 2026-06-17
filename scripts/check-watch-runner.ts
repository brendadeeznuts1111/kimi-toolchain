/**
 * File watcher runner for scripts/check.ts --watch / --watch-tests.
 */

import { watch } from "fs";
import { mergeWatchOptions, mergeWatchTestsOptions } from "../src/lib/check-watch.ts";
import type { CheckOptions, CheckRunResult } from "../src/lib/check-types.ts";

const WATCH_DIRS = ["src", "scripts", "test"] as const;
const DEBOUNCE_MS = 300;
const IGNORE_PATTERN = /(^|[/\\])(node_modules|\.git|coverage|dist)([/\\]|$)/;

function watchOut(message: string): void {
  Bun.stdout.write(`${message}\n`);
}

export function startCheckWatchMode(
  projectRoot: string,
  baseOptions: CheckOptions,
  run: (opts: CheckOptions) => Promise<CheckRunResult>
): () => void {
  const testOnly = baseOptions.watchTests;
  watchOut(testOnly ? "👀 Watching for test changes..." : "👀 Watching for changes...");

  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchers: ReturnType<typeof watch>[] = [];

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      console.clear();
      watchOut(testOnly ? "Running tests..." : "Running gate...");
      const merged = testOnly
        ? mergeWatchTestsOptions(baseOptions)
        : mergeWatchOptions(baseOptions);
      const result = await run(merged);
      if (result.passed) {
        const suffix = result.fromCache ? " (cached)" : "";
        watchOut(testOnly ? `✓ tests passed${suffix}` : `✓ gate passed${suffix}`);
      } else {
        const first = result.failures[0];
        const detail = first ? `${first.step} — ${first.message}` : "unknown";
        watchOut(testOnly ? `✗ tests failed: ${detail}` : `✗ gate failed: ${detail}`);
      }
    }, DEBOUNCE_MS);
  };

  for (const dir of WATCH_DIRS) {
    const path = `${projectRoot}/${dir}`;
    try {
      const watcher = watch(path, { recursive: true }, (_event, filename) => {
        if (!filename || IGNORE_PATTERN.test(filename)) return;
        schedule();
      });
      watchers.push(watcher);
    } catch {
      // Directory may not exist in minimal fixtures
    }
  }

  schedule();

  return () => {
    for (const watcher of watchers) watcher.close();
    if (timer) clearTimeout(timer);
  };
}
