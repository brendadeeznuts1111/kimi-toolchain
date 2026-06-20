#!/usr/bin/env bun
/**
 * Visual dashboard card validator using `Bun.WebView`.
 *
 * Loads the Herdr dashboard HTML in a headless WebKit browser and verifies
 * that every card ID listed in `canvasInfluences` entries renders a real DOM
 * element. Catches card ID mismatches that static HTML parsing would miss
 * (e.g. cards generated at runtime, renamed IDs, removed sections).
 *
 * Usage:
 *   bun run lint:dashboard-visual               # run WebView validation
 *   bun run lint:dashboard-visual --list-ids    # print card IDs found in DOM, then exit
 *
 * Requirements:
 *   - macOS with a display (not headless CI without GPU/display server)
 *   - Bun >= 1.2 with Bun.WebView (WebKit backend)
 *
 * Not part of the main CI gate. Run manually before commits touching
 * dashboard.html or canvasInfluences arrays.
 */

import { join, resolve } from "path";
import {
  DASHBOARD_HTML_REL,
  dashboardHtmlPath,
  lintCanvasInfluences,
} from "../src/lib/dashboard-card-registry.ts";
import { LOCAL_DOC_REFERENCES } from "../src/lib/canonical-references.ts";
import { pathExists } from "../src/lib/bun-io.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const listIdsMode = args.includes("--list-ids");

const htmlPath = dashboardHtmlPath(REPO_ROOT);

if (!pathExists(htmlPath)) {
  process.stderr.write(`lint:dashboard-visual — missing ${DASHBOARD_HTML_REL}\n`);
  process.exit(1);
}

interface BunWebViewInstance {
  navigate(url: string): Promise<void>;
  evaluate<T>(js: string): Promise<T>;
  screenshot(opts: { format: string; quality?: number }): Promise<Uint8Array>;
  [Symbol.asyncDispose](): Promise<void>;
}

interface BunWebViewConstructor {
  new (opts: {
    width: number;
    height: number;
    backend?: "webkit" | "chrome" | { type: "chrome"; path?: string; argv?: string[] };
    console?: boolean;
    dataStore?: string;
  }): BunWebViewInstance;
}

const bunAny = Bun as unknown as { WebView?: BunWebViewConstructor };

if (typeof bunAny.WebView !== "function") {
  process.stderr.write(
    "lint:dashboard-visual — Bun.WebView unavailable.\n" +
      "  Requires Bun >= 1.2 on macOS with a display server.\n" +
      "  Falling back to static lint (lintCanvasInfluences).\n"
  );
  const violations = lintCanvasInfluences(REPO_ROOT);
  if (violations.length) {
    for (const v of violations) process.stderr.write(`  ✗ ${v}\n`);
    process.exit(1);
  }
  process.stdout.write("lint:dashboard-visual — static lint ok (no WebView available)\n");
  process.exit(0);
}

const fileUrl = `file://${resolve(htmlPath)}`;
process.stdout.write(`lint:dashboard-visual — loading ${fileUrl}\n`);

let exitCode = 0;

{
  await using view = new bunAny.WebView({ width: 1280, height: 720, backend: "webkit" });

  await view.navigate(fileUrl);

  // Collect all element IDs matching card-* from the live DOM
  const domCardIds = await view.evaluate<string[]>(
    `[...document.querySelectorAll("[id^='card-']")].map(el => el.id)`
  );

  if (listIdsMode) {
    process.stdout.write("DOM card IDs:\n");
    for (const id of domCardIds) process.stdout.write(`  ${id}\n`);
    // view disposed by await using before exit
  } else {
    process.stdout.write(
      `lint:dashboard-visual — ${domCardIds.length} card element(s) found in DOM\n`
    );

    // Cross-check canvasInfluences entries against the live DOM card IDs
    const domCardIdSet = new Set(domCardIds);
    const violations = lintCanvasInfluences(REPO_ROOT);

    // Additionally check any canvasInfluences card IDs present in static HTML
    // but absent from the live DOM (runtime-generated cards, hidden elements)
    const visualViolations: string[] = [];
    for (const ref of LOCAL_DOC_REFERENCES) {
      for (const cardId of ref.canvasInfluences ?? []) {
        if (!domCardIdSet.has(cardId)) {
          visualViolations.push(`${ref.id}: card "${cardId}" not found as a rendered DOM element`);
        }
      }
    }

    const allViolations = [...violations, ...visualViolations];
    if (allViolations.length) {
      process.stderr.write(`\nlint:dashboard-visual — ${allViolations.length} violation(s):\n`);
      for (const v of allViolations) process.stderr.write(`  ✗ ${v}\n`);
      exitCode = 1;
    } else {
      process.stdout.write(
        "lint:dashboard-visual — ✅ all canvasInfluences card IDs render correctly\n"
      );
    }
  }
  // await using disposes the view here
}

process.exit(exitCode);
