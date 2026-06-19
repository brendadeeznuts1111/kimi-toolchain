import { appendText, makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, it } from "bun:test";
import { join } from "path";
import { DECISION_SCHEMA_VERSION } from "../src/lib/decision-ledger.ts";
import { decisionsNdjsonPath } from "../src/lib/paths.ts";
import { testTempDir } from "./helpers.ts";
import {
  buildTaxonomyConstantLinks,
  checkRecentlyModifiedBoundConstants,
  checkTaxonomyConstantLinks,
  formatTaxonomyConstantHint,
} from "../src/lib/taxonomy-constants.ts";

describe("taxonomy-constants", () => {
  let projectDir: string;

  function writeProject(files: Record<string, string>): void {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(projectDir, path);
      makeDir(fullPath.split("/").slice(0, -1).join("/"), { recursive: true });
      writeText(fullPath, content);
    }
  }

  it("should resolve boundConstants from bunfig and manifest", async () => {
    projectDir = testTempDir("taxonomy-constants-");
    writeProject({
      "error-taxonomy.yml": `
version: 2
categories:
  - id: lint_failure
    name: Lint check failed
    description: lint failed
    severity: warn
    expected: false
    boundConstants:
      - KIMI_TUNING_SET_VERSION
    patterns:
      - regex: "lint failed"
`,
      "bunfig.toml": `
[define]
# define-domain:governance
KIMI_TUNING_SET_VERSION = '"1.0.0"'
`,
      "types/build-constants.d.ts": `
/**
 * @defineDomain governance
 * @type string
 * @default "1.0.0"
 */
declare const KIMI_TUNING_SET_VERSION: string;
`,
      "package.json": JSON.stringify({ name: "demo" }),
    });

    const links = await buildTaxonomyConstantLinks(projectDir);
    expect(links).toHaveLength(1);
    expect(links[0]?.boundConstants).toEqual(["KIMI_TUNING_SET_VERSION"]);
    expect(links[0]?.resolved[0]).toMatchObject({
      key: "KIMI_TUNING_SET_VERSION",
      known: true,
      default: "1.0.0",
    });
    expect(formatTaxonomyConstantHint(links[0]!)).toContain("KIMI_TUNING_SET_VERSION=1.0.0");

    const report = await checkTaxonomyConstantLinks(projectDir);
    expect(report.aligned).toBe(true);

    removePath(projectDir, { recursive: true, force: true });
  });

  it("should accept deprecated relatedConstants in yaml", async () => {
    projectDir = testTempDir("taxonomy-constants-legacy-");
    writeProject({
      "error-taxonomy.yml": `
version: 2
categories:
  - id: lint_failure
    name: Lint check failed
    description: lint failed
    severity: warn
    expected: false
    relatedConstants:
      - KIMI_TUNING_SET_VERSION
    patterns: []
`,
      "bunfig.toml": `
[define]
# define-domain:governance
KIMI_TUNING_SET_VERSION = '"1.0.0"'
`,
      "types/build-constants.d.ts": `
/**
 * @defineDomain governance
 * @type string
 * @default "1.0.0"
 */
declare const KIMI_TUNING_SET_VERSION: string;
`,
      "package.json": JSON.stringify({ name: "demo" }),
    });

    const links = await buildTaxonomyConstantLinks(projectDir);
    expect(links[0]?.boundConstants).toEqual(["KIMI_TUNING_SET_VERSION"]);

    removePath(projectDir, { recursive: true, force: true });
  });

  it("should flag unknown boundConstants", async () => {
    projectDir = testTempDir("taxonomy-constants-bad-");
    writeProject({
      "error-taxonomy.yml": `
version: 2
categories:
  - id: lint_failure
    name: Lint check failed
    description: lint failed
    severity: warn
    expected: false
    boundConstants:
      - KIMI_MISSING_CONSTANT
    patterns: []
`,
      "bunfig.toml": `
[define]
# define-domain:governance
KIMI_TUNING_SET_VERSION = '"1.0.0"'
`,
      "types/build-constants.d.ts": `
/**
 * @defineDomain governance
 * @type string
 * @default "1.0.0"
 */
declare const KIMI_TUNING_SET_VERSION: string;
`,
      "package.json": JSON.stringify({ name: "demo" }),
    });

    const report = await checkTaxonomyConstantLinks(projectDir);
    expect(report.aligned).toBe(false);
    expect(report.checks.some((check) => check.name === "taxonomy:lint_failure")).toBe(true);

    removePath(projectDir, { recursive: true, force: true });
  });

  describe("recently-modified-bound-constants", () => {
    const nowMs = Date.parse("2026-06-15T12:00:00.000Z");

    function writeDecision(key: string, ageMs: number, decisionId: string): void {
      const timestamp = new Date(nowMs - ageMs).toISOString();
      const line = JSON.stringify({
        schemaVersion: DECISION_SCHEMA_VERSION,
        decisionId,
        timestamp,
        actor: "kimi",
        action: "config-change",
        trigger: { traceId: `trace-${decisionId}` },
        rationale: { summary: "repair", fullReasoning: "repair", evidence: [] },
        alternatives: [],
        outcome: { result: "success" },
        metadata: {
          type: "constant-repair",
          restoredKeys: [key],
        },
      });
      appendText(decisionsNdjsonPath(projectDir), `${line}\n`);
    }

    function baseProject(): void {
      writeProject({
        "error-taxonomy.yml": `
version: 2
categories:
  - id: lockfile_issue
    name: Lockfile integrity issue
    description: lockfile hash mismatch
    severity: error
    expected: false
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
      makeDir(join(projectDir, ".kimi"), { recursive: true });
    }

    it("should emit error severity for modifications under 1h", async () => {
      projectDir = testTempDir("taxonomy-bound-recent-error-");
      baseProject();
      writeDecision("KIMI_HOOK_VERIFIER_MAX_CYCLES", 30 * 60 * 1000, "dec-30m");

      const report = await checkRecentlyModifiedBoundConstants(projectDir, { nowMs });
      const check = report.checks.find((item) => item.name === "KIMI_HOOK_VERIFIER_MAX_CYCLES");
      expect(check?.status).toBe("error");
      expect(check?.message).toContain("lockfile_issue");

      removePath(projectDir, { recursive: true, force: true });
    });

    it("should emit warn severity for modifications between 1h and 6h", async () => {
      projectDir = testTempDir("taxonomy-bound-recent-warn-");
      baseProject();
      writeDecision("KIMI_HOOK_VERIFIER_MAX_CYCLES", 3 * 60 * 60 * 1000, "dec-3h");

      const report = await checkRecentlyModifiedBoundConstants(projectDir, { nowMs });
      const check = report.checks.find((item) => item.name === "KIMI_HOOK_VERIFIER_MAX_CYCLES");
      expect(check?.status).toBe("warn");

      removePath(projectDir, { recursive: true, force: true });
    });

    it("should emit warn severity for modifications between 6h and 24h", async () => {
      projectDir = testTempDir("taxonomy-bound-recent-12h-");
      baseProject();
      writeDecision("KIMI_HOOK_VERIFIER_MAX_CYCLES", 12 * 60 * 60 * 1000, "dec-12h");

      const report = await checkRecentlyModifiedBoundConstants(projectDir, { nowMs });
      const check = report.checks.find((item) => item.name === "KIMI_HOOK_VERIFIER_MAX_CYCLES");
      expect(check?.status).toBe("warn");

      removePath(projectDir, { recursive: true, force: true });
    });

    it("should report ok when no recent bound constant modifications", async () => {
      projectDir = testTempDir("taxonomy-bound-recent-ok-");
      baseProject();

      const report = await checkRecentlyModifiedBoundConstants(projectDir, { nowMs });
      expect(report.checks.some((item) => item.name === "recent-modifications")).toBe(true);
      expect(report.aligned).toBe(true);

      removePath(projectDir, { recursive: true, force: true });
    });
  });
});
