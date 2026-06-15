import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildTaxonomyConstantLinks,
  checkTaxonomyConstantLinks,
  formatTaxonomyConstantHint,
} from "../src/lib/taxonomy-constants.ts";

describe("taxonomyConstants", () => {
  let projectDir: string;

  function writeProject(files: Record<string, string>): void {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(projectDir, path);
      mkdirSync(fullPath.split("/").slice(0, -1).join("/"), { recursive: true });
      writeFileSync(fullPath, content);
    }
  }

  it("should resolve relatedConstants from bunfig and manifest", async () => {
    projectDir = join(tmpdir(), `taxonomy-constants-${Date.now()}`);
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
    expect(links[0]?.resolved[0]).toMatchObject({
      key: "KIMI_TUNING_SET_VERSION",
      known: true,
      default: "1.0.0",
    });
    expect(formatTaxonomyConstantHint(links[0]!)).toContain("KIMI_TUNING_SET_VERSION=1.0.0");

    const report = await checkTaxonomyConstantLinks(projectDir);
    expect(report.aligned).toBe(true);

    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should flag unknown relatedConstants", async () => {
    projectDir = join(tmpdir(), `taxonomy-constants-bad-${Date.now()}`);
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

    rmSync(projectDir, { recursive: true, force: true });
  });
});
