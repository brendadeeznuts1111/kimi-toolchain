import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, it } from "bun:test";
import { join } from "path";
import { Effect } from "effect";
import { DECISION_SCHEMA_VERSION } from "../src/lib/decision-ledger.ts";
import { decisionsNdjsonPath } from "../src/lib/paths.ts";
import { testTempDir } from "./helpers.ts";
import {
  formatBoundConstantLine,
  suggestErrorWithBoundConstantsEffect,
} from "../src/lib/error-suggest.ts";
import { writeConstantsGolden } from "../src/lib/constants-heal.ts";

describe("error-suggest", () => {
  let projectDir: string;
  let failurePath: string;

  function writeProject(files: Record<string, string>): void {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(projectDir, path);
      makeDir(fullPath.split("/").slice(0, -1).join("/"), { recursive: true });
      writeText(fullPath, content);
    }
  }

  it("should resolve bound constants with golden and decision context", async () => {
    projectDir = testTempDir("error-suggest-");
    failurePath = join(projectDir, "failures.jsonl");
    const now = Date.now();
    const decisionTimestamp = new Date(now - 2 * 60 * 60 * 1000).toISOString();

    writeProject({
      "error-taxonomy.yml": `
version: 2
categories:
  - id: lockfile_issue
    name: Lockfile integrity issue
    description: lockfile hash mismatch
    severity: error
    expected: false
    suggestion: Run kimi-guardian fix
    autoFix: kimi-guardian fix
    boundConstants:
      - KIMI_HOOK_VERIFIER_MAX_CYCLES
    patterns:
      - regex: "HASH MISMATCH"
`,
      "bunfig.toml": `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "500"
`,
      "types/build-constants.d.ts": `
/**
 * @defineDomain hook-verifier
 * @type number
 * @default 500
 */
declare const KIMI_HOOK_VERIFIER_MAX_CYCLES: number;
`,
      "package.json": JSON.stringify({ name: "demo" }),
    });

    await writeConstantsGolden(projectDir);

    writeText(
      decisionsNdjsonPath(projectDir),
      `${JSON.stringify({
        schemaVersion: DECISION_SCHEMA_VERSION,
        decisionId: "dec-test-lockfile",
        timestamp: decisionTimestamp,
        actor: "kimi",
        action: "config-change",
        trigger: { traceId: "trace-1" },
        rationale: { summary: "repair", fullReasoning: "repair", evidence: [] },
        alternatives: [],
        outcome: { result: "success" },
        metadata: {
          type: "constant-repair",
          restoredKeys: ["KIMI_HOOK_VERIFIER_MAX_CYCLES"],
        },
      })}\n`
    );

    writeText(
      failurePath,
      `${JSON.stringify({
        errorId: "err-lock-1",
        taxonomyId: "lockfile_issue",
        output: "HASH MISMATCH in bun.lock",
        toolName: "kimi-guardian",
        suggestion: "Lockfile issue — run 'kimi-guardian fix'.",
        autoFix: "kimi-guardian fix",
        timestamp: new Date().toISOString(),
      })}\n`
    );

    const report = await Effect.runPromise(
      suggestErrorWithBoundConstantsEffect("err-lock-1", {
        projectRoot: projectDir,
        failurePath,
      })
    );

    expect(report.errorId).toBe("err-lock-1");
    expect(report.boundConstants).toHaveLength(1);
    expect(report.boundConstants[0]?.key).toBe("KIMI_HOOK_VERIFIER_MAX_CYCLES");
    expect(report.boundConstants[0]?.value).toBe(500);
    expect(report.boundConstants[0]?.goldenStatus).toBe("unchanged");
    expect(report.boundConstants[0]?.lastModified?.decisionId).toBe("dec-test-lockfile");
    expect(report.suggestion).toContain("kimi-guardian fix");

    const line = formatBoundConstantLine(report.boundConstants[0]!);
    expect(line).toContain("KIMI_HOOK_VERIFIER_MAX_CYCLES = 500");
    expect(line).toContain("dec-test-lockfile");

    removePath(projectDir, { recursive: true, force: true });
  });
});
