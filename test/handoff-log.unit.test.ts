import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  configureHandoffLog,
  getHandoffHistory,
  logHandoff,
  remoteHandoffContext,
  resetHandoffSeq,
  verifyHandoffLog,
} from "../src/lib/handoff-log.ts";

describe("handoff-log", () => {
  let tempDir = "";

  afterEach(() => {
    resetHandoffSeq(0);
    configureHandoffLog({ enabled: true, maxBytes: 50 * 1024 * 1024 });
    if (tempDir && existsSync(tempDir)) {
      Bun.spawnSync(["rm", "-rf", tempDir]);
    }
    tempDir = "";
  });

  test("logHandoff writes checksum-verified JSONL entries", () => {
    tempDir = mkdtempSync(join(tmpdir(), "handoff-log-"));
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

  test("rotateIfNeeded gzips logs at maxBytes threshold", () => {
    tempDir = mkdtempSync(join(tmpdir(), "handoff-log-"));
    const logPath = join(tempDir, "handoff-log.jsonl");
    configureHandoffLog({ path: logPath, enabled: true, maxBytes: 256 });

    const preRotationContent = `${"x".repeat(300)}\n`;
    writeFileSync(logPath, preRotationContent, "utf8");

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

    const archives = readdirSync(tempDir).filter((name) => name.endsWith(".jsonl.gz"));
    expect(archives.length).toBe(1);

    // Verify the log was cleared and repopulated with the new entry
    expect(readFileSync(logPath, "utf8").trim().length).toBeGreaterThan(0);

    // Verify archive content integrity — decompress and check pre-rotation data survived
    const archivePath = join(tempDir, archives[0]!);
    const decompressed = gunzipSync(readFileSync(archivePath)).toString("utf8");
    expect(decompressed).toContain("x".repeat(300));
    expect(decompressed).toBe(preRotationContent);
  });
});
