#!/usr/bin/env bun
/**
 * setInterval → Bun-native migration v2 (report-first, conservative apply).
 *
 * Scans for setInterval call sites, classifies each with heuristics, and emits
 * migration guidance plus bun:test mock-clock test stubs.
 *
 * Usage:
 *   bun run migrate:setinterval:v2              # report (default)
 *   bun run migrate:setinterval:v2 --json
 *   bun run migrate:setinterval:v2 --apply      # patch high-confidence sites only
 *   bun run migrate:setinterval:v2 -- src/lib   # limit scan roots
 *
 * Mock-clock references (kimi-toolchain verified on Bun 1.4.0-canary):
 *   - Bun.sleep loops: jest.useFakeTimers() + jest.advanceTimersByTime(ms)
 *   - Wall clock / Date: setSystemTime(date) from "bun:test"
 *   - Reset: setSystemTime() or jest.useRealTimers()
 *   - Time zone: bun test defaults to UTC; Bun.cron schedules are UTC.
 *     Override via CLI: TZ=America/Los_Angeles bun test
 *     Or per test: process.env.TZ = "America/Los_Angeles" (runtime-safe in bun:test)
 *     Repo default: test/setup.ts sets Bun.env.TZ = "Etc/UTC" when TZ is unset.
 *
 * @see https://bun.com/guides/test/mock-clock
 * @see https://bun.sh/docs/test/dates-times#set-the-time-zone
 * @see https://bun.com/guides/util/sleep
 * @see test/helpers/mock-clock.ts — use-case matrix (TTL, JWT, snapshots, audit order)
 * @see test/bun-mock-clock-patterns.unit.test.ts
 */

import { Glob } from "bun";
import { join } from "path";

const REPO_ROOT = join(import.meta.dir, "..");
const CRON_MIN_MS = 60_000;

const argv = Bun.argv.slice(2);
const jsonOut = argv.includes("--json");
const apply = argv.includes("--apply");
const roots = argv.filter((a) => !a.startsWith("-"));

const SCAN_ROOTS = roots.length > 0 ? roots : ["src"];
const ALLOWLIST = new Set([
  "scripts/migrate-setinterval-v2.ts",
  "src/lib/bun-utils.ts",
  "test/bun-fake-timers.unit.test.ts",
  "test/bun-timer-idle-start.unit.test.ts",
]);

const MOCK_CLOCK_DOC = "https://bun.com/guides/test/mock-clock";
const DATES_TIMES_DOC = "https://bun.sh/docs/test/dates-times";
const TZ_DOC = "https://bun.sh/docs/test/dates-times#set-the-time-zone";
const SLEEP_DOC = "https://bun.com/guides/util/sleep";

type Strategy =
  | "bun-cron"
  | "delayed-loop"
  | "immediate-loop"
  | "sleep-abortable-inline"
  | "ref-unref-hold"
  | "manual-review";

type Confidence = "high" | "medium" | "low";

interface IntervalSite {
  file: string;
  line: number;
  intervalExpr: string;
  intervalMs: number | null;
  strategy: Strategy;
  confidence: Confidence;
  autoApply: boolean;
  reason: string;
  testStub: string;
  snippet: string;
}

const SET_INTERVAL_RE =
  /setInterval\s*\(\s*([\s\S]*?)\s*,\s*([^)]+)\)\s*(?:;|\.\s*(ref|unref)\s*\(\s*\)\s*;?)?/g;

function evalIntervalMs(expr: string): number | null {
  const trimmed = expr.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const mult = trimmed.match(/^(\d+)\s*\*\s*(\d+)(?:\s*\*\s*(\d+))?$/);
  if (mult) {
    const parts = [mult[1], mult[2], mult[3]].filter(Boolean).map(Number);
    return parts.reduce((a, b) => a * b, 1);
  }
  const parenMult = trimmed.match(/^\(\s*(\d+)\s*\*\s*(\d+)(?:\s*\*\s*(\d+))?\s*\)$/);
  if (parenMult) {
    const parts = [parenMult[1], parenMult[2], parenMult[3]].filter(Boolean).map(Number);
    return parts.reduce((a, b) => a * b, 1);
  }
  return null;
}

function buildCronSchedule(ms: number): string | null {
  if (ms < CRON_MIN_MS) return null;
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `*/${minutes} * * * *`;
}

function hasImmediateTickBefore(text: string, index: number, tickName: string | null): boolean {
  const window = text.slice(Math.max(0, index - 400), index);
  if (/void\s+\w+\s*\(\s*\)\s*;/.test(window)) return true;
  if (tickName && new RegExp(`void\\s+${tickName}\\s*\\(`).test(window)) return true;
  return false;
}

function extractTickName(callback: string): string | null {
  const arrow = callback.match(/^\(\s*\)\s*=>\s*(?:void\s+)?(\w+)/);
  if (arrow) return arrow[1] ?? null;
  const call = callback.match(/^\(\s*\)\s*=>\s*\{[\s\S]*?(\w+)\s*\(/);
  return call?.[1] ?? null;
}

function sleepLoopTestStub(intervalMs: number, stopCall: string): string {
  return [
    "/* TEST: Bun.sleep loop (jest fake timers — verified on Bun 1.4)",
    ' *   import { test, expect, jest } from "bun:test";',
    " *   jest.useFakeTimers();",
    ` *   // start loop (${intervalMs}ms)`,
    ` *   jest.advanceTimersByTime(${intervalMs});`,
    " *   await Promise.resolve(); // flush microtasks",
    " *   // expect(tick).toHaveBeenCalledTimes(1);",
    ` *   ${stopCall};`,
    " *   jest.useRealTimers();",
    ` * @see ${MOCK_CLOCK_DOC}`,
    " */",
  ].join("\n");
}

function cronTestStub(schedule: string, handlerName: string): string {
  return [
    "/* TEST: Bun.cron (UTC) — prefer direct handler unit test",
    ' *   import { test, expect, setSystemTime } from "bun:test"; // test/bun-set-system-time.unit.test.ts',
    " *   // Bun.cron uses UTC; bun test defaults to Etc/UTC (see test/setup.ts).",
    " *   // Override TZ: TZ=America/Los_Angeles bun test",
    ' *   // Or per test: process.env.TZ = "America/Los_Angeles";',
    " *   // Unit: call handler directly",
    ` *   // ${handlerName}();`,
    " *   // Wall-clock reads:",
    ' *   setSystemTime(new Date("2026-06-23T10:00:00.000Z"));',
    ` *   // Bun.cron("${schedule}", ${handlerName})`,
    ' *   setSystemTime(new Date("2026-06-23T10:10:00.000Z"));',
    " *   setSystemTime(); // reset",
    ` * @see ${TZ_DOC}`,
    ` * @see ${DATES_TIMES_DOC}`,
    " */",
  ].join("\n");
}

function classifySite(
  file: string,
  line: number,
  callback: string,
  intervalExpr: string,
  trailingRef: string | undefined,
  contextBefore: string,
  fullText: string,
  index: number
): IntervalSite {
  const intervalMs = evalIntervalMs(intervalExpr);
  const tickName = extractTickName(callback);
  const snippet =
    fullText
      .slice(index, index + 120)
      .split("\n")[0]
      ?.trim() ?? "";

  const usesRefUnref =
    Boolean(trailingRef) ||
    /\.ref\s*\(\s*\)/.test(fullText.slice(index, index + 80)) ||
    /\.unref\s*\(\s*\)/.test(fullText.slice(index, index + 80));

  const clearsInside = /clearInterval\s*\(/.test(callback);
  const isAsyncCallback = /async\s/.test(callback);
  const immediate = hasImmediateTickBefore(contextBefore + callback, index, tickName);

  let strategy: Strategy = "manual-review";
  let confidence: Confidence = "low";
  let reason = "Complex callback — migrate by hand.";
  let autoApply = false;

  if (clearsInside || isAsyncCallback) {
    strategy = "sleep-abortable-inline";
    confidence = "medium";
    reason = "Callback clears interval or is async — use AbortController + sleepAbortable loop.";
  } else if (usesRefUnref) {
    strategy = "ref-unref-hold";
    confidence = "medium";
    reason =
      "Timer uses ref/unref — pair startDelayedIntervalLoop with hold setInterval for ref surface.";
  } else if (intervalMs !== null && intervalMs >= CRON_MIN_MS && buildCronSchedule(intervalMs)) {
    strategy = "bun-cron";
    confidence = intervalMs % 60_000 === 0 ? "high" : "medium";
    reason = `Interval >= ${CRON_MIN_MS}ms — prefer Bun.cron (UTC, 5-field).`;
    autoApply = confidence === "high" && !immediate;
  } else if (immediate) {
    strategy = "immediate-loop";
    confidence = "high";
    reason = "Tick runs before interval — use startIntervalLoop (immediate first).";
    autoApply = intervalMs !== null && intervalMs >= 1000;
  } else {
    strategy = "delayed-loop";
    confidence = intervalMs !== null ? "high" : "medium";
    reason = "Standard setInterval semantics — use startDelayedIntervalLoop (Bun.sleep).";
    autoApply = intervalMs !== null && intervalMs >= 1000;
  }

  const msForStub = intervalMs ?? 5000;
  let testStub: string;
  if (strategy === "bun-cron" && intervalMs !== null) {
    const schedule = buildCronSchedule(intervalMs) ?? "*/1 * * * *";
    testStub = cronTestStub(schedule, tickName ?? "tick");
  } else {
    testStub = sleepLoopTestStub(msForStub, "stopLoop()");
  }

  return {
    file,
    line,
    intervalExpr: intervalExpr.trim(),
    intervalMs,
    strategy,
    confidence,
    autoApply,
    reason,
    testStub,
    snippet,
  };
}

function scanFile(path: string, text: string): IntervalSite[] {
  const sites: IntervalSite[] = [];
  const lines = text.split("\n");

  for (const match of text.matchAll(SET_INTERVAL_RE)) {
    const index = match.index ?? 0;
    const line = text.slice(0, index).split("\n").length;
    const callback = match[1] ?? "";
    const intervalExpr = match[2] ?? "";
    const trailingRef = match[3];
    const contextBefore = text.slice(Math.max(0, index - 400), index);

    if (lines[line - 1]?.includes("holdTimer") || lines[line - 1]?.includes("TEST:")) continue;

    sites.push(
      classifySite(path, line, callback, intervalExpr, trailingRef, contextBefore, text, index)
    );
  }

  return sites;
}

function ensureBunUtilsImport(text: string): string {
  if (/from\s+["'].*bun-utils/.test(text)) return text;
  const importLine =
    'import { startDelayedIntervalLoop, startIntervalLoop, stopDelayedIntervalLoop, sleepAbortable } from "./bun-utils.ts";\n';
  const shebang = text.match(/^#!\/usr\/env bun\n/);
  if (shebang) {
    const rest = text.slice(shebang[0].length);
    const firstImport = rest.search(/^import\s/m);
    if (firstImport >= 0) {
      return shebang[0] + rest.slice(0, firstImport) + importLine + rest.slice(firstImport);
    }
    return shebang[0] + importLine + rest;
  }
  const firstImport = text.search(/^import\s/m);
  if (firstImport >= 0) {
    return text.slice(0, firstImport) + importLine + text.slice(firstImport);
  }
  return importLine + text;
}

function applyDelayedLoopPatch(text: string, site: IntervalSite): string | null {
  const re = new RegExp(
    `setInterval\\s*\\(\\s*([\\s\\S]*?)\\s*,\\s*${site.intervalExpr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\)`,
    "m"
  );
  const match = text.match(re);
  if (!match) return null;

  const callback = match[1]?.trim() ?? "() => {}";
  const replacement = `${site.testStub}\nstartDelayedIntervalLoop(${site.intervalExpr}, ${callback})`;
  let result = text.replace(match[0], replacement);

  const varMatch = text.slice(0, text.indexOf(match[0])).match(/(?:let|const)\s+(\w+)\s*=\s*$/);
  const loopVar = varMatch?.[1];
  if (loopVar) {
    result = result.replace(
      new RegExp(`clearInterval\\(\\s*${loopVar}\\s*\\)`),
      `stopDelayedIntervalLoop(${loopVar})`
    );
  }

  return ensureBunUtilsImport(result);
}

async function main(): Promise<void> {
  const glob = new Glob("**/*.{ts,tsx}");
  const sites: IntervalSite[] = [];

  for (const root of SCAN_ROOTS) {
    for await (const file of glob.scan({ cwd: join(REPO_ROOT, root), onlyFiles: true })) {
      if (file.includes("node_modules")) continue;
      const path = `${root}/${file}`;
      if (ALLOWLIST.has(path)) continue;
      const abs = join(REPO_ROOT, path);
      const text = await Bun.file(abs).text();
      sites.push(...scanFile(path, text));
    }
  }

  sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  if (jsonOut) {
    console.log(
      Bun.inspect(
        { mode: apply ? "apply" : "report", count: sites.length, sites },
        { depth: 5, colors: false }
      )
    );
    process.exit(0);
  }

  if (sites.length === 0) {
    console.log("migrate-setinterval-v2 — no setInterval call sites found");
    process.exit(0);
  }

  console.log(`migrate-setinterval-v2 — ${sites.length} setInterval site(s)\n`);

  let applied = 0;
  for (const site of sites) {
    const rel = site.file;
    console.log(`${rel}:${site.line}`);
    console.log(`  strategy:   ${site.strategy} (${site.confidence})`);
    console.log(
      `  interval:   ${site.intervalExpr}${site.intervalMs !== null ? ` = ${site.intervalMs}ms` : ""}`
    );
    console.log(`  reason:     ${site.reason}`);
    console.log(`  auto-apply: ${site.autoApply ? "yes" : "no — manual review"}`);
    console.log(`  snippet:    ${site.snippet}`);

    if (apply && site.autoApply && site.strategy === "delayed-loop" && site.intervalMs !== null) {
      const abs = join(REPO_ROOT, site.file);
      const text = await Bun.file(abs).text();
      const next = applyDelayedLoopPatch(text, site);
      if (next && next !== text) {
        await Bun.write(abs, next);
        console.log("  applied:    patched → startDelayedIntervalLoop");
        applied++;
      } else {
        console.log("  applied:    skipped (pattern not matched for safe rewrite)");
      }
    }

    console.log("");
  }

  const byStrategy = new Map<Strategy, number>();
  for (const s of sites) byStrategy.set(s.strategy, (byStrategy.get(s.strategy) ?? 0) + 1);

  console.log(`Summary: ${[...byStrategy.entries()].map(([k, n]) => `${k}=${n}`).join(", ")}`);
  if (apply) console.log(`Applied ${applied} high-confidence delayed-loop patch(es).`);
  else console.log(`Dry run — pass --apply to patch high-confidence delayed-loop sites only.`);
  console.log(`Mock clock: ${MOCK_CLOCK_DOC}`);
  console.log(`Dates/TZ:   ${TZ_DOC}`);
  console.log(`Bun.sleep:  ${SLEEP_DOC}`);
}

await main();
