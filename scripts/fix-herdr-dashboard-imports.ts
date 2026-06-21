#!/usr/bin/env bun
/**
 * One-shot import rewriter for PR 1 herdr-dashboard folder move.
 */

import { join, relative, dirname } from "path";

const REPO_ROOT = join(import.meta.dir, "..");
const LIB_ROOT = join(REPO_ROOT, "src/lib");
const HERDR_ROOT = join(LIB_ROOT, "herdr-dashboard");

const HERDR_TARGETS: Record<string, string> = {
  "herdr-dashboard-server.ts": "server/server.ts",
  "herdr-dashboard-http3.ts": "server/http3.ts",
  "herdr-dashboard-hub.ts": "server/hub.ts",
  "herdr-dashboard-events.ts": "server/events.ts",
  "herdr-dashboard-bridge.ts": "server/bridge.ts",
  "herdr-dashboard-data.ts": "data/data.ts",
  "herdr-dashboard-discovery-cache.ts": "discovery/cache.ts",
  "herdr-dashboard-discovery-meta.ts": "discovery/meta.ts",
  "herdr-dashboard-widgets.ts": "widgets/widgets.ts",
  "herdr-dashboard-widget-git.ts": "widgets/git.ts",
  "herdr-dashboard-widget-logs.ts": "widgets/logs.ts",
  "herdr-dashboard-widget-processes.ts": "widgets/processes.ts",
  "herdr-dashboard-widget-processes-action.ts": "widgets/processes-action.ts",
  "herdr-dashboard-widget-session.ts": "widgets/session.ts",
  "herdr-dashboard-automation.ts": "automation/automation.ts",
  "herdr-dashboard-automation-gate.ts": "automation/automation-gate.ts",
  "herdr-dashboard-gate-watch.ts": "gates/gate-watch.ts",
  "herdr-dashboard-meta-gate.ts": "gates/meta-gate.ts",
  "herdr-dashboard-webview-options.ts": "webview/options.ts",
  "herdr-dashboard-webview-store.ts": "webview/store.ts",
  "herdr-dashboard-contract.ts": "contract.ts",
  "herdr-dashboard-bus.ts": "bus.ts",
  "herdr-dashboard-agents.ts": "agents.ts",
  "herdr-dashboard-sessions.ts": "sessions.ts",
  "herdr-dashboard-session-selector.ts": "session-selector.ts",
  "herdr-dashboard-watch.ts": "watch.ts",
  "herdr-dashboard-cron.ts": "cron.ts",
  "herdr-dashboard-effect-image.ts": "effect-image.ts",
};

const herdrFiles = [...new Bun.Glob("**/*.ts").scanSync({ cwd: HERDR_ROOT })].map((f) =>
  join(HERDR_ROOT, f)
);

function toRel(fromFile: string, targetAbs: string): string {
  const fromDir = dirname(fromFile);
  let rel = relative(fromDir, targetAbs).replaceAll("\\", "/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

function herdrRelative(fromFile: string, targetRel: string): string {
  return toRel(fromFile, join(HERDR_ROOT, targetRel));
}

function libRelative(fromFile: string, libFile: string): string {
  return toRel(fromFile, join(LIB_ROOT, libFile));
}

async function resolveDotImport(fromFile: string, dotPath: string): Promise<string | null> {
  const fromDir = dirname(fromFile);
  const candidate = join(fromDir, dotPath);
  if (await Bun.file(candidate).exists()) return null;

  const libCandidate = join(LIB_ROOT, dotPath.replace(/^\.\//, ""));
  if (await Bun.file(libCandidate).exists()) {
    return libRelative(fromFile, dotPath.replace(/^\.\//, ""));
  }

  return null;
}

async function rewriteContent(filePath: string, content: string): Promise<string> {
  let next = content;

  for (const [oldName, newRel] of Object.entries(HERDR_TARGETS)) {
    const replacement = herdrRelative(filePath, newRel);
    next = next.replaceAll(`./${oldName}`, replacement);
  }

  const dotImportRe = /(["'])(\.\/[^"']+\.ts)\1/g;
  const matches = [...next.matchAll(dotImportRe)];
  for (const match of matches) {
    const [full, quote, dotPath] = match;
    const fixed = await resolveDotImport(filePath, dotPath);
    if (fixed) next = next.replaceAll(full, `${quote}${fixed}${quote}`);
  }

  if (filePath.endsWith("server/server.ts")) {
    next = next.replace(
      'join(import.meta.dir, "..", "..", "templates")',
      'join(import.meta.dir, "..", "..", "..", "..", "templates")'
    );
    next = next.replace(
      'join(import.meta.dir, "..", "templates")',
      'join(import.meta.dir, "..", "..", "..", "templates")'
    );
  }

  return next;
}

let changed = 0;
for (const filePath of herdrFiles) {
  const before = await Bun.file(filePath).text();
  const after = await rewriteContent(filePath, before);
  if (after !== before) {
    await Bun.write(filePath, after);
    changed++;
    console.log(`updated ${relative(REPO_ROOT, filePath)}`);
  }
}

console.log(`done: ${changed} files updated`);
