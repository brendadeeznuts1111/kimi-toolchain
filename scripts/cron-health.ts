#!/usr/bin/env bun
/**
 * Self-maintaining canonical references health monitor using `Bun.cron`.
 *
 * Runs a periodic audit of the canonical-references.json manifest and logs
 * drift warnings without modifying any files. Intended for long-running
 * agent or daemon processes.
 *
 * Usage:
 *   bun run cron:health                      # run until SIGINT/SIGTERM
 *   bun run cron:health --interval "* * * * *"   # override cron expression
 *   bun run cron:health --once               # one-shot audit then exit
 */

import { join } from "path";
import {
  auditCanonicalReferencesHealth,
  repoCanonicalReferencesPath,
} from "../src/lib/canonical-references.ts";
import { homeDir } from "../src/lib/paths.ts";

const REPO_ROOT = join(import.meta.dir, "..");

const args = Bun.argv.slice(2);
const onceMode = args.includes("--once");

const intervalIdx = args.indexOf("--interval");
const cronExpression =
  intervalIdx >= 0 && args[intervalIdx + 1] ? args[intervalIdx + 1]! : "*/30 * * * *";

async function runAudit(): Promise<void> {
  const home = homeDir();
  const report = await auditCanonicalReferencesHealth(REPO_ROOT, home);

  const ts = new Date().toISOString();

  if (!report.applicable) {
    process.stderr.write(`[${ts}] cron:health — not applicable for this project\n`);
    return;
  }

  if (report.aligned) {
    process.stdout.write(`[${ts}] cron:health — ok (manifest aligned)\n`);
    return;
  }

  const failNames = report.checks
    .filter((c) => c.status !== "ok")
    .map((c) => `${c.name}:${c.status}`)
    .join(", ");

  process.stderr.write(
    `[${ts}] cron:health — ⚠️  drift detected (${failNames})\n` +
      `  repo:    ${repoCanonicalReferencesPath(REPO_ROOT)}\n` +
      `  fix:     ${report.fixPlan.join(" → ") || "—"}\n`
  );
}

if (onceMode) {
  await runAudit();
  process.exit(0);
}

interface BunCronHandle {
  ref(): void;
  unref(): void;
  [Symbol.dispose](): void;
}

const bunAny = Bun as unknown as {
  cron: (expression: string, handler: () => void | Promise<void>) => BunCronHandle;
};

if (typeof bunAny.cron !== "function") {
  process.stderr.write("cron:health — Bun.cron unavailable; falling back to --once mode\n");
  await runAudit();
  process.exit(0);
}

process.stdout.write(`cron:health — starting (expression: "${cronExpression}")\n`);
process.stdout.write(`  Press Ctrl-C to stop.\n`);

// Log cron handler errors without killing the process (matches Bun.cron error semantics)
process.on("unhandledRejection", (err) => {
  process.stderr.write(`[cron:health] handler error: ${String(err)}\n`);
});

// Initial immediate audit on startup
await runAudit();

{
  using _job = bunAny.cron(cronExpression, () => void runAudit());

  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  // _job disposed here via using — stops the cron before process exits
}

process.stdout.write("\ncron:health — stopped\n");
