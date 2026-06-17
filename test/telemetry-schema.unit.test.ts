import { makeDir, readText, removePath } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { testTempDir } from "./helpers.ts";
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
    });
    expect(record.schemaVersion).toBe(FAILURE_SCHEMA_VERSION);
    expect(record.taxonomyId).toBe("lockfile_issue");
    expect(record.categoryId).toBe("lockfile_issue");
    expect(record.sessionId).toBe("sess-1");
  });

  test("flushToFile appends JSONL without overwriting prior content", async () => {
    const dir = testTempDir("kimi-telemetry-");
    makeDir(dir, { recursive: true });
    const path = join(dir, "cli-telemetry.jsonl");

    const logger1 = createLogger([], "test-tool");
    logger1.info("first run");
    await logger1.flushToFile(path);

    const logger2 = createLogger([], "test-tool");
    logger2.info("second run");
    await logger2.flushToFile(path);

    const content = readText(path);
    const lines = content.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).message).toBe("first run");
    expect(JSON.parse(lines[1]).message).toBe("second run");

    removePath(dir, { recursive: true, force: true });
  });
});
