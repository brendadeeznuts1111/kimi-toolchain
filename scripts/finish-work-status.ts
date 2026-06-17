#!/usr/bin/env bun
/**
 * Read (and optionally wait for) the finish-work close report for orchestrator probes.
 *
 *   bun run scripts/finish-work-status.ts
 *   bun run scripts/finish-work-status.ts --json
 *   bun run scripts/finish-work-status.ts --wait-for-marker --pane wB:p6F
 *   bun run scripts/finish-work-status.ts --project .
 */

import { isAbsolute, join, normalize, resolve } from "path";
import { execCli } from "../src/lib/herdr-project-cli.ts";
import { LATM_DONE_MARKER } from "../src/lib/herdr-latm.ts";
import { finishWorkReportPath, loadFinishWorkReportPublic } from "../src/lib/finish-work-herdr.ts";
import {
  FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION,
  validateFinishWorkReportV11,
} from "../src/lib/finish-work-report-schema.ts";
import { inspectAgent } from "../src/lib/inspect.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function resolveProjectArg(path: string): string {
  return isAbsolute(path) ? normalize(path) : resolve(process.cwd(), path);
}

interface CliOptions {
  json: boolean;
  projectRoot: string;
  waitForMarker: boolean;
  paneId: string | null;
  timeoutMs: number;
  session: string;
}

function parseCli(): CliOptions {
  const argv = Bun.argv.slice(2);
  let json = false;
  let waitForMarker = false;
  let projectRoot = REPO_ROOT;
  let paneId: string | null = Bun.env.HERDR_PANE_ID ?? null;
  let timeoutMs = 300_000;
  let session = Bun.env.HERDR_SESSION ?? "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--wait-for-marker") {
      waitForMarker = true;
      continue;
    }
    if (arg === "--project") {
      const next = argv[++i];
      if (!next) throw new Error("--project requires a path");
      projectRoot = resolveProjectArg(next);
      continue;
    }
    if (arg === "--pane") {
      const next = argv[++i];
      if (!next) throw new Error("--pane requires an id");
      paneId = next;
      continue;
    }
    if (arg === "--timeout") {
      const next = argv[++i];
      if (!next) throw new Error("--timeout requires milliseconds");
      timeoutMs = Number(next);
      continue;
    }
    if (arg === "--session") {
      const next = argv[++i];
      if (!next) throw new Error("--session requires a name");
      session = next;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
  }

  return { json, projectRoot, waitForMarker, paneId, timeoutMs, session };
}

function waitForLatmMarker(paneId: string, timeoutMs: number, session: string): boolean {
  const waited = execCli(
    "herdr",
    ["wait", "output", paneId, "--match", LATM_DONE_MARKER, "--timeout", String(timeoutMs)],
    { session, timeout: timeoutMs + 5_000 }
  );
  return waited.ok;
}

async function main(): Promise<number> {
  const options = parseCli();

  if (options.waitForMarker) {
    if (!options.paneId) {
      process.stderr.write("--wait-for-marker requires --pane or HERDR_PANE_ID\n");
      return 1;
    }
    const seen = waitForLatmMarker(options.paneId, options.timeoutMs, options.session);
    if (!seen) {
      if (options.json) {
        process.stdout.write(
          `${inspectAgent({
            ok: false,
            schemaVersion: FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION,
            error: `LATM marker not seen on ${options.paneId}`,
          })}\n`
        );
      } else {
        process.stderr.write(`LATM marker not seen on ${options.paneId}\n`);
      }
      return 1;
    }
  }

  const raw = await loadFinishWorkReportPublic(options.projectRoot);
  if (!raw) {
    const message = `no report at ${finishWorkReportPath(options.projectRoot)}`;
    if (options.json) {
      process.stdout.write(`${inspectAgent({ ok: false, error: message })}\n`);
    } else {
      process.stderr.write(`${message}\n`);
    }
    return 1;
  }

  const validated = validateFinishWorkReportV11(raw);
  const payload = {
    ok: validated.ok,
    schemaVersion: FINISH_WORK_REPORT_PUBLIC_SCHEMA_VERSION,
    report: validated.report ?? raw,
    errors: validated.errors,
    markerSeen: options.waitForMarker ? true : undefined,
  };

  if (options.json) {
    process.stdout.write(`${inspectAgent(payload)}\n`);
  } else if (!validated.ok) {
    process.stderr.write(`invalid finish-work report: ${validated.errors.join("; ")}\n`);
    return 1;
  } else {
    const report = validated.report!;
    process.stdout.write(
      `${report.outcome} — ${report.summary} (handoff: ${
        report.handoffCandidate?.shouldHandoff ? report.handoffCandidate.targetAgent : "none"
      })\n`
    );
  }

  return validated.ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
