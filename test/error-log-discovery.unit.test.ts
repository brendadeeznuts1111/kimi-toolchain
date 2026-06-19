import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import {
  discoverDashboardLogSinks,
  discoverErrorLogSinks,
  findFinishWorkGateLogPaths,
  isDashboardCuratedLogSink,
  isErrorLogLine,
  resolveErrorLogSink,
  tailErrorLogFile,
} from "../src/lib/error-log-discovery.ts";
import { fetchDashboardDebugLogSinks } from "../src/lib/herdr-dashboard-data.ts";
import { failureLedgerPath } from "../src/lib/paths.ts";
import { REPO_ROOT, testTempDir } from "./helpers.ts";

describe("error-log-discovery", () => {
  test("discoverErrorLogSinks includes tool-failures ledger", () => {
    const report = discoverErrorLogSinks(REPO_ROOT);
    const ledger = resolveErrorLogSink(report, "tool-failures");
    expect(ledger?.path).toBe(failureLedgerPath());
    expect(ledger?.readCommand).toContain("kimi-debug ledger");
  });

  test("discoverErrorLogSinks includes herdr server and client logs", () => {
    const report = discoverErrorLogSinks(REPO_ROOT);
    const server = resolveErrorLogSink(report, "herdr-server");
    const client = resolveErrorLogSink(report, "herdr-client");
    expect(server?.path).toContain(".config/herdr/herdr-server.log");
    expect(client?.path).toContain(".config/herdr/herdr-client.log");
    expect(server?.readCommand).toContain("kimi-debug logs --id herdr-server");
  });

  test("findFinishWorkGateLogPaths discovers gate logs under .kimi", () => {
    const root = testTempDir("finish-work-logs");
    const kimiDir = join(root, ".kimi");
    makeDir(kimiDir, { recursive: true });
    const logPath = join(kimiDir, "finish-work-gate-kimi-heal.log");
    writeText(logPath, "audit ok\n");
    expect(findFinishWorkGateLogPaths(root)).toEqual([logPath]);
  });

  test("isErrorLogLine matches common failure tokens", () => {
    expect(isErrorLogLine("[dashboard] gate health failed")).toBe(true);
    expect(isErrorLogLine("all checks passed")).toBe(false);
  });

  test("isDashboardCuratedLogSink includes P1/P2 and excludes wire", () => {
    expect(isDashboardCuratedLogSink("tool-failures")).toBe(true);
    expect(isDashboardCuratedLogSink("finish-work-gate-kimi-heal")).toBe(true);
    expect(isDashboardCuratedLogSink("orchestrator-events")).toBe(true);
    expect(isDashboardCuratedLogSink("wire-session")).toBe(false);
    expect(isDashboardCuratedLogSink("trace-events")).toBe(false);
  });

  test("discoverDashboardLogSinks excludes wire-session", () => {
    const sinks = discoverDashboardLogSinks(REPO_ROOT);
    expect(sinks.some((s) => s.id === "wire-session")).toBe(false);
    expect(sinks.some((s) => s.id === "tool-failures")).toBe(true);
  });

  test("fetchDashboardDebugLogSinks returns curated registry", () => {
    const payload = fetchDashboardDebugLogSinks(REPO_ROOT);
    expect(payload.ok).toBe(true);
    expect(payload.sinks.every((s) => isDashboardCuratedLogSink(s.id))).toBe(true);
  });

  test("tailErrorLogFile returns last lines and can filter errors", async () => {
    const root = testTempDir("tail-log");
    const logPath = join(root, "sample.log");
    writeText(logPath, "ok line\nWARN something\nERROR boom\n");
    const all = await tailErrorLogFile(logPath, 10, false);
    expect(all).toEqual(["ok line", "WARN something", "ERROR boom"]);
    const errors = await tailErrorLogFile(logPath, 10, true);
    expect(errors).toEqual(["WARN something", "ERROR boom"]);
  });
});
