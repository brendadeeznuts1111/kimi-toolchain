#!/usr/bin/env bun
/**
 * Scaffold slim copy — post-push reviewer pane (self-contained, no src/lib imports).
 *
 *   bun run scripts/reviewer-pane.ts --report-file .kimi/finish-work-report.json
 */

import { readText } from "./lib/bun-io.ts";
import { readableStreamToText } from "./lib/bun-utils.ts";
import { resolve } from "node:path";
import type { FinishWorkReport } from "./finish-work-herdr.ts";

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

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

async function herdrCli(args: string[]) {
  const proc = Bun.spawn(["herdr", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

function renderTable(report: FinishWorkReport): void {
  const lines: string[] = [];
  lines.push(paint("purple", "finish-work reviewer"));
  lines.push(paint("dim", `outcome: ${report.outcome}  gates: ${report.results.length}`));
  lines.push("");
  lines.push(paint("cyan", `${pad("GATE", 18)} ${pad("EXIT", 6)} MS`));
  for (const gate of report.results) {
    const mark = gate.exitCode === 0 ? paint("green", "0") : paint("red", String(gate.exitCode));
    lines.push(`${pad(gate.name, 18)} ${pad(mark, 6)} ${gate.ms}`);
  }
  lines.push("");
  lines.push(paint("cyan", "WORKING TREE"));
  if (report.tree.clean) {
    lines.push(`  ${paint("green", "clean")}`);
  } else {
    lines.push(`  ${paint("yellow", `${report.tree.dirty.length} dirty path(s) after push`)}`);
    for (const line of report.tree.dirty.slice(0, 12)) lines.push(`    ${line}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function main(): Promise<number> {
  const argv = Bun.argv.slice(2);
  const fileIndex = argv.indexOf("--report-file");
  const filePath = fileIndex >= 0 ? argv[fileIndex + 1] : null;
  if (!filePath) {
    process.stderr.write("usage: reviewer-pane.ts --report-file <path>\n");
    return 1;
  }

  const report = JSON.parse(readText(resolve(filePath))) as FinishWorkReport;
  renderTable(report);

  const paneId = process.env.HERDR_PANE_ID;
  if (paneId && process.env.HERDR_ENV === "1") {
    await herdrCli([
      "pane",
      "report-agent",
      paneId,
      "--source",
      "finish-work:reviewer",
      "--agent",
      "finish-work-reviewer",
      "--state",
      report.tree.clean ? "idle" : "blocked",
      "--message",
      report.tree.clean ? "Post-push review complete" : "Dirty tree after push",
      ...(report.tree.clean ? [] : ["--custom-status", "needs-review"]),
    ]);
  }

  return report.tree.clean ? 0 : 2;
}

main()
  .then((code) => process.exit(code))
  .catch((error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
