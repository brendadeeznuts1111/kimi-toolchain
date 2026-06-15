import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildClassifiedFailure,
  classifyFailure,
  FAILURE_SCHEMA_VERSION,
  type Taxonomy,
} from "../src/lib/error-taxonomy.ts";
import { createLogger } from "../src/lib/logger.ts";

const sampleTaxonomy: Taxonomy = {
  version: 2,
  categories: [
    {
      id: "lockfile_issue",
      name: "Lockfile",
      description: "Lockfile drift",
      severity: "warn",
      expected: false,
      suggestion: "Run guardian fix",
      autoFix: "kimi-guardian fix",
      patterns: [{ regex: "lockfile" }],
    },
    {
      id: "unknown",
      name: "Unknown",
      description: "No match",
      severity: "info",
      expected: false,
      patterns: [],
    },
  ],
};

describe("telemetry schema", () => {
  test("ClassifiedFailure includes taxonomyId and schemaVersion", () => {
    const match = classifyFailure("lockfile hash mismatch", sampleTaxonomy);
    const record = buildClassifiedFailure("Shell", "lockfile hash mismatch", match, {
      sessionId: "sess-1",
      traceId: "trace-1",
      parentTraceId: "trace-parent",
      childTraceIds: ["trace-child"],
      context: {
        inputs: { command: "kimi-guardian check" },
        environment: { cwd: "/tmp/project" },
      },
    });
    expect(record.schemaVersion).toBe(FAILURE_SCHEMA_VERSION);
    expect(record.taxonomyId).toBe("lockfile_issue");
    expect(record.categoryId).toBe("lockfile_issue");
    expect(record.sessionId).toBe("sess-1");
    expect(record.traceId).toBe("trace-1");
    expect(record.parentTraceId).toBe("trace-parent");
    expect(record.childTraceIds).toEqual(["trace-child"]);
    expect(record.context?.inputs?.command).toBe("kimi-guardian check");
    expect(record.context?.environment?.cwd).toBe("/tmp/project");
  });

  test("flushToFile appends JSONL without overwriting prior content", async () => {
    const dir = join(tmpdir(), `kimi-telemetry-${Bun.randomUUIDv7()}`);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "cli-telemetry.jsonl");

    const logger1 = createLogger([], "test-tool");
    logger1.info("first run");
    await logger1.flushToFile(path);

    const logger2 = createLogger([], "test-tool");
    logger2.info("second run");
    await logger2.flushToFile(path);

    const content = readFileSync(path, "utf8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).message).toBe("first run");
    expect(JSON.parse(lines[1]).message).toBe("second run");

    rmSync(dir, { recursive: true, force: true });
  });
});
