import { Effect } from "effect";
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { cosineSimilarity, embedText, EMBEDDING_DIM } from "../src/lib/error-embedding.ts";
import {
  clusterFailureLedgerEffect,
  matchErrorToClusters,
  suggestForErrorEffect,
} from "../src/lib/error-clustering.ts";
import { readFailureRecords } from "../src/lib/failure-ledger.ts";

function tempDir(): string {
  const dir = join(tmpdir(), `kimi-cluster-${Bun.randomUUIDv7()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("error-embedding", () => {
  test("produces 384-dim normalized vectors", () => {
    const vector = embedText("Tool timed out after 30000ms while running bun test");
    expect(vector.length).toBe(EMBEDDING_DIM);
    let norm = 0;
    for (let i = 0; i < vector.length; i++) norm += (vector[i] ?? 0) * (vector[i] ?? 0);
    expect(norm).toBeCloseTo(1, 5);
  });

  test("similar timeout messages have higher cosine similarity than unrelated errors", () => {
    const a = embedText("Tool timed out after 30000ms while running bun test");
    const b = embedText("timeout waiting for tool after 15000ms during doctor run");
    const c = embedText("HASH MISMATCH for bun.lock integrity check failed");
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });
});

describe("error-clustering", () => {
  test("groups semantically similar timeout failures", async () => {
    const dir = tempDir();
    try {
      const failurePath = join(dir, "tool-failures.jsonl");
      const records = [
        {
          errorId: "error-timeout-a",
          toolName: "unified-shell",
          output: "Tool timed out after 30000ms while running bun test",
          taxonomyId: "timeout",
          suggestion: "Increase timeout or reduce subprocess work.",
        },
        {
          errorId: "error-timeout-b",
          toolName: "kimi-doctor",
          output: "timeout waiting for tool after 15000ms",
          taxonomyId: "timeout",
        },
        {
          errorId: "error-lockfile",
          toolName: "kimi-guardian",
          output: "HASH MISMATCH for bun.lock",
          taxonomyId: "lockfile_issue",
        },
      ];
      writeFileSync(failurePath, records.map((r) => JSON.stringify(r)).join("\n"));

      const report = await Effect.runPromise(
        clusterFailureLedgerEffect({
          failurePath,
          tracePath: join(dir, "trace-events.jsonl"),
          clustersPath: join(dir, "error-clusters.json"),
          threshold: 0.35,
        })
      );

      expect(report.totalFailures).toBe(3);
      expect(report.summaries.length).toBeGreaterThanOrEqual(2);
      const timeoutCluster = report.clusters.find((cluster) => cluster.size >= 2);
      expect(timeoutCluster).toBeDefined();
      expect(timeoutCluster?.taxonomyCounts.timeout).toBe(2);

      const match = matchErrorToClusters("command timed out after 20000ms", report.clusters);
      expect(match?.cluster.taxonomyCounts.timeout).toBeGreaterThanOrEqual(1);
      expect(match?.confidence).toBeGreaterThan(0);

      const updated = await readFailureRecords(failurePath);
      expect(updated.every((row) => row.clusterId)).toBe(true);
      expect(updated.some((row) => row.embedding)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("suggest returns playbook recommendation for clustered error", async () => {
    const dir = tempDir();
    try {
      const failurePath = join(dir, "tool-failures.jsonl");
      writeFileSync(
        failurePath,
        JSON.stringify({
          errorId: "error-suggest-1",
          toolName: "kimi-doctor",
          output: "timeout waiting for subprocess",
          taxonomyId: "timeout",
        })
      );

      await Effect.runPromise(
        clusterFailureLedgerEffect({
          failurePath,
          tracePath: join(dir, "trace-events.jsonl"),
          clustersPath: join(dir, "error-clusters.json"),
          threshold: 0.35,
        })
      );

      const suggestion = await Effect.runPromise(
        suggestForErrorEffect("error-suggest-1", {
          failurePath,
          tracePath: join(dir, "trace-events.jsonl"),
        })
      );
      expect(suggestion?.errorId).toBe("error-suggest-1");
      expect(suggestion?.clusterId).toBeTruthy();
      expect(suggestion?.recommendation.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("backward compatible with legacy ledger lines without clusterId", async () => {
    const dir = tempDir();
    try {
      const failurePath = join(dir, "tool-failures.jsonl");
      writeFileSync(
        failurePath,
        [
          '{"toolName":"legacy","output":"old format error","taxonomyId":"unknown","categoryId":"unknown"}',
        ].join("\n")
      );

      const report = await Effect.runPromise(
        clusterFailureLedgerEffect({
          failurePath,
          tracePath: join(dir, "trace-events.jsonl"),
          clustersPath: join(dir, "error-clusters.json"),
          threshold: 0.35,
        })
      );
      expect(report.totalFailures).toBe(1);
      const updated = await readFailureRecords(failurePath);
      expect(updated[0]?.errorId).toBeTruthy();
      expect(updated[0]?.clusterId).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
