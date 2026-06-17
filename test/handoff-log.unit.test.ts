import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { cleanupPath, testTempDir } from "./helpers.ts";
import { listDir, pathExists, readText, writeText } from "../src/lib/bun-io.ts";
import { gunzipText } from "../src/lib/bun-utils.ts";
import {
  configureHandoffLog,
  getHandoffHistory,
  inferHandoffLogAction,
  logHandoff,
  queryHandoffHistory,
  recordHandoffRuleEvaluation,
  remoteHandoffContext,
  resetHandoffSeq,
  verifyHandoffLog,
} from "../src/lib/handoff-log.ts";

describe("handoff-log", () => {
  let tempDir = "";

  afterEach(() => {
    resetHandoffSeq(0);
    configureHandoffLog({ enabled: true, maxBytes: 50 * 1024 * 1024 });
    if (tempDir && pathExists(tempDir)) {
      cleanupPath(tempDir);
    }
    tempDir = "";
  });

  test("logHandoff writes checksum-verified JSONL entries", () => {
    tempDir = testTempDir("handoff-log-");
    const logPath = join(tempDir, "handoff-log.jsonl");
    configureHandoffLog({ path: logPath, enabled: true });

    logHandoff({
      workspace: "w1",
      agent: "kimi",
      rule: 1,
      trigger: "manual",
      action: "handoff",
      detail: "test entry",
      ok: true,
    });

    expect(verifyHandoffLog()).toEqual([]);
    const entries = getHandoffHistory(5);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.agent).toBe("kimi");
    expect(entries[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  test("remoteHandoffContext annotates SSH orchestration metadata", () => {
    const context = remoteHandoffContext("workbox", { reason: "spawn-fallback" });
    expect(context).toEqual({
      reason: "spawn-fallback",
      remote_host: "workbox",
      via_ssh: true,
    });
  });

  test("rotateIfNeeded gzips logs at maxBytes threshold", async () => {
    tempDir = testTempDir("handoff-log-");
    const logPath = join(tempDir, "handoff-log.jsonl");
    configureHandoffLog({ path: logPath, enabled: true, maxBytes: 256 });

    const preRotationContent = `${"x".repeat(300)}\n`;
    writeText(logPath, preRotationContent);

    logHandoff({
      workspace: "w1",
      agent: "codex",
      rule: 2,
      trigger: "react",
      action: "spawn",
      detail: "rotation trigger",
      ok: true,
      context: remoteHandoffContext("workbox"),
    });

    const archives = listDir(tempDir).filter((name) => name.endsWith(".jsonl.gz"));
    expect(archives.length).toBe(1);

    // Verify the log was cleared and repopulated with the new entry
    expect(readText(logPath).trim().length).toBeGreaterThan(0);

    // Verify archive content integrity — decompress and check pre-rotation data survived
    const archivePath = join(tempDir, archives[0]!);
    const decompressed = gunzipText(new Uint8Array(await Bun.file(archivePath).arrayBuffer()));
    expect(decompressed).toContain("x".repeat(300));
    expect(decompressed).toBe(preRotationContent);
  });

  test("getHandoffHistory reads from both live log and rotation archives", () => {
    tempDir = testTempDir("handoff-log-");
    const logPath = join(tempDir, "handoff-log.jsonl");
    configureHandoffLog({ path: logPath, enabled: true, maxBytes: 256 });

    // Phase 1: write a pre-rotation entry directly to the log
    const preEntry = JSON.stringify({
      timestamp: "2025-01-01T00:00:00.000Z",
      seq: 99,
      workspace: "old-workspace",
      agent: "archive-agent",
      rule: 1,
      trigger: "manual",
      action: "handoff",
      detail: "this should be archived",
      ok: true,
      checksum: "abc",
    });
    writeText(logPath, `${preEntry}\n${"y".repeat(300)}\n`);

    // Phase 2: logHandoff triggers rotation, archiving the old content
    logHandoff({
      workspace: "w1",
      agent: "live-agent",
      rule: 2,
      trigger: "react",
      action: "spawn",
      detail: "post-rotation entry",
      ok: true,
    });

    // Phase 3: getHandoffHistory should return entries from BOTH the archive AND the live log
    const history = getHandoffHistory(50);
    const agents = history.map((e) => e.agent);
    expect(agents).toContain("archive-agent");
    expect(agents).toContain("live-agent");
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  test("queryHandoffHistory filters by workspace and trigger", () => {
    tempDir = testTempDir("handoff-log-");
    const logPath = join(tempDir, "handoff-log.jsonl");
    configureHandoffLog({ path: logPath, enabled: true });

    logHandoff({
      workspace: "wB",
      agent: "kimi",
      rule: 1,
      trigger: "watch-events",
      action: "skip",
      detail: "probe not satisfied",
      ok: false,
    });
    logHandoff({
      workspace: "w1",
      agent: "test-agent",
      rule: 2,
      trigger: "react",
      action: "handoff",
      detail: "w1/test-agent → w1/kimi",
      ok: true,
    });

    const filtered = queryHandoffHistory({ workspace: "wB", trigger: "watch-events", limit: 10 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.workspace).toBe("wB");
  });

  test("inferHandoffLogAction classifies dry-run and skip", () => {
    expect(inferHandoffLogAction("wB/kimi → wB/codex", true, true)).toBe("dry-run");
    expect(inferHandoffLogAction("probe finish-work:pushed not satisfied", false, false)).toBe(
      "skip"
    );
  });

  test("recordHandoffRuleEvaluation writes audit entry", () => {
    tempDir = testTempDir("handoff-log-");
    const logPath = join(tempDir, "handoff-log.jsonl");
    configureHandoffLog({ path: logPath, enabled: true });

    recordHandoffRuleEvaluation({
      rule: {
        fromWorkspace: "wB",
        fromAgent: "kimi",
        toWorkspace: "wB",
        toAgent: "codex-primary",
        condition: "probe:finish-work:pushed",
      },
      ruleIndex: 3,
      detail: "probe not satisfied",
      ok: false,
      trigger: "watch-events",
      dryRun: false,
      durationMs: 42,
      context: { evalDurationMs: 42 },
    });

    const entries = queryHandoffHistory({ workspace: "wB", limit: 5 });
    expect(entries[0]?.trigger).toBe("watch-events");
    expect(entries[0]?.action).toBe("skip");
    expect(entries[0]?.durationMs).toBe(42);
    expect(entries[0]?.context?.evalDurationMs).toBe(42);
  });
});
