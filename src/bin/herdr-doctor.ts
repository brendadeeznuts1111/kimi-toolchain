#!/usr/bin/env bun
import { FIX_SOCKET_LIVE_TOTAL_TIMEOUT_MS } from "../lib/herdr-fix-socket-live.ts";
import {
  inspectHerdrDoctor,
  printFixSocketHuman,
  printHerdrDoctorHuman,
  runFixSocket,
} from "../lib/herdr-doctor.ts";

import { isDirectRun } from "../lib/bun-utils.ts";
import { writeStdoutLine } from "../lib/cli-contract.ts";

async function writeOut(line = ""): Promise<void> {
  await writeStdoutLine(line);
}

function parseArgs(argv: string[]) {
  const args = [...argv];
  const command =
    args[0] === "fix-socket" || args[0] === "doctor" ? (args.shift() ?? "doctor") : "doctor";
  let errorText = "";
  const errorIdx = args.indexOf("--error");
  if (errorIdx >= 0) {
    errorText = args
      .slice(errorIdx + 1)
      .join(" ")
      .trim();
    args.length = errorIdx;
  }
  const live = args.includes("--live");
  return {
    command,
    json: args.includes("--json"),
    fix: args.includes("--fix"),
    dryRun: args.includes("--dry-run") || !live,
    live,
    help: args.includes("--help") || argv.includes("-h"),
    errorText,
  };
}

if (isDirectRun(import.meta.path)) {
  const options = parseArgs(Bun.argv.slice(2));
  if (options.help) {
    await writeOut(
      [
        "herdr-doctor [doctor] [--json] [--fix]",
        "herdr-doctor fix-socket [--dry-run] [--live] [--json] [--error <text>]",
        "",
        "doctor  Read-only Herdr integration health for the DX config hub.",
        "          --fix updates stale agent manifests when the server is running.",
        "fix-socket  Materialize socket recovery plan with pgrep-resolved server PIDs.",
        "          --dry-run (default) prints commands without executing them.",
        "          --live executes graceful stop (10s timeout) and validated kill escalation.",
        "          --error optional Herdr CLI stderr to select EAGAIN vs ECONNREFUSED plan.",
      ].join("\n")
    );
    process.exit(0);
  }

  if (options.command === "fix-socket") {
    try {
      const run = () =>
        runFixSocket({
          dryRun: options.dryRun,
          errorText: options.errorText || undefined,
        });

      const report = options.live
        ? await Promise.race([
            run(),
            (async () => {
              await Bun.sleep(FIX_SOCKET_LIVE_TOTAL_TIMEOUT_MS);
              throw new Error(
                `fix-socket --live exceeded ${FIX_SOCKET_LIVE_TOTAL_TIMEOUT_MS}ms total timeout`
              );
            })(),
          ])
        : await run();

      if (options.json) await writeOut(JSON.stringify(report, null, 2));
      else await printFixSocketHuman(report);
      process.exit(0);
    } catch (error) {
      await writeOut(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  const report = await inspectHerdrDoctor({ fix: options.fix });
  if (options.json) await writeOut(JSON.stringify(report, null, 2));
  else await printHerdrDoctorHuman(report);
  process.exit(report.readiness.ready ? 0 : 1);
}
