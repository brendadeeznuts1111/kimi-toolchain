#!/usr/bin/env bun
/**
 * Post-push reviewer pane — renders finish-work JSON and reports agent state to Herdr.
 *
 *   bun run scripts/reviewer-pane.ts --report-file .kimi/finish-work-report.json
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { herdrCli } from "../src/lib/herdr-socket.ts";
import type { FinishWorkReport } from "../src/lib/finish-work-herdr.ts";

const ANSI = {
  purple: "\x1b[38;5;141m",
  green: "\x1b[38;5;84m",
  red: "\x1b[38;5;203m",
  cyan: "\x1b[38;5;117m",
  yellow: "\x1b[38;5;221m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

function noColor(): boolean {
  return Bun.env.NO_COLOR !== undefined && Bun.env.NO_COLOR !== "0" && Bun.env.NO_COLOR !== "false";
}

function paint(color: keyof typeof ANSI, text: string): string {
  if (noColor()) return text;
  return `${ANSI[color]}${text}${ANSI.reset}`;
}

function parseArgs(): string | null {
  const argv = Bun.argv.slice(2);
  const fileIndex = argv.indexOf("--report-file");
  if (fileIndex >= 0) return argv[fileIndex + 1] ?? null;
  const reportIndex = argv.indexOf("--report");
  if (reportIndex >= 0) return null;
  return null;
}

function loadReport(path: string | null): FinishWorkReport | null {
  if (!path) return null;
  const raw = readFileSync(resolve(path), "utf8");
  return JSON.parse(raw) as FinishWorkReport;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function renderTable(report: FinishWorkReport): void {
  const lines: string[] = [];
  lines.push(paint("purple", "finish-work reviewer"));
  lines.push(paint("dim", `outcome: ${report.outcome}  gates: ${report.results.length}`));
  lines.push("");

  const header = `${pad("GATE", 18)} ${pad("EXIT", 6)} MS`;
  lines.push(paint("cyan", header));
  for (const gate of report.results) {
    const mark = gate.exitCode === 0 ? paint("green", "0") : paint("red", String(gate.exitCode));
    lines.push(`${pad(gate.name, 18)} ${pad(mark, 6)} ${gate.ms}`);
  }

  lines.push("");
  lines.push(paint("cyan", "GIT"));
  lines.push(
    `  committed: ${report.git.committed}  pushed: ${report.git.pushed}${
      report.git.error ? `  error: ${report.git.error}` : ""
    }`
  );

  lines.push("");
  lines.push(paint("cyan", "WORKING TREE"));
  if (report.tree.clean) {
    lines.push(`  ${paint("green", "clean")}`);
  } else {
    lines.push(`  ${paint("yellow", `${report.tree.dirty.length} dirty path(s) after push`)}`);
    for (const line of report.tree.dirty.slice(0, 12)) {
      lines.push(`    ${line}`);
    }
    if (report.tree.dirty.length > 12) {
      lines.push(`    … +${report.tree.dirty.length - 12} more`);
    }
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

async function reportAgentState(report: FinishWorkReport): Promise<void> {
  const paneId = process.env.HERDR_PANE_ID;
  if (!paneId || process.env.HERDR_ENV !== "1") return;

  const state = report.tree.clean ? "idle" : "blocked";
  const message = report.tree.clean
    ? "Post-push review complete"
    : "Dirty tree after push — review required";

  await herdrCli([
    "pane",
    "report-agent",
    paneId,
    "--source",
    "kimi-toolchain:reviewer",
    "--agent",
    "finish-work-reviewer",
    "--state",
    state,
    "--message",
    message,
    ...(report.tree.clean ? [] : ["--custom-status", "needs-review"]),
  ]);
}

async function main(): Promise<number> {
  const filePath = parseArgs();
  if (!filePath) {
    process.stderr.write("usage: reviewer-pane.ts --report-file <path>\n");
    return 1;
  }

  const report = loadReport(filePath);
  if (!report) {
    process.stderr.write("invalid or missing report\n");
    return 1;
  }

  renderTable(report);
  await reportAgentState(report);
  return report.tree.clean ? 0 : 2;
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
