#!/usr/bin/env bun
import { inspectHerdrDoctor, printHerdrDoctorHuman } from "../lib/herdr-doctor.ts";

function parseArgs(argv: string[]) {
  return {
    json: argv.includes("--json"),
    fix: argv.includes("--fix"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function writeOut(line = ""): void {
  process.stdout.write(`${line}\n`);
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  writeOut(
    "herdr-doctor [--json] [--fix]\n\nRead-only Herdr integration health for the DX config hub.\n--fix updates stale agent manifests when the server is running."
  );
  process.exit(0);
}

const report = inspectHerdrDoctor({ fix: options.fix });
if (options.json) writeOut(JSON.stringify(report, null, 2));
else printHerdrDoctorHuman(report);
process.exit(report.readiness.ready ? 0 : 1);
