import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  applyDefineRepairs,
  buildConstantRepairPlan,
  captureConstantsGolden,
  diffAgainstGolden,
  loadConstantsGolden,
  parseConstantsGolden,
  repairConstants,
  repairHashesForDiff,
  writeConstantsGolden,
  listGoldenArchives,
  restoreGoldenFromArchive,
  buildConstantRepairImpact,
} from "../src/lib/constants-heal.ts";
import { loadRepoDefineMap } from "../src/lib/build-constants-registry.ts";
import { constantsGoldenArchiveDir } from "../src/lib/paths.ts";
import { existsSync } from "fs";

describe("constantsHeal", () => {
  let projectDir: string;

  function writeProject(files: Record<string, string>): void {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(projectDir, path);
      mkdirSync(fullPath.split("/").slice(0, -1).join("/"), { recursive: true });
      writeFileSync(fullPath, content);
    }
  }

  it("should capture and persist golden template", async () => {
    projectDir = join(tmpdir(), `constants-heal-${Date.now()}`);
    writeProject({
      "bunfig.toml": `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
# define-domain:governance
KIMI_TUNING_SET_VERSION = '"1.0.0"'
`,
    });

    const golden = await writeConstantsGolden(projectDir);
    expect(golden.schemaVersion).toBe("1.0.0");
    expect(golden.tuningSetVersion).toBe("1.0.0");
    expect(golden.constants.KIMI_HOOK_VERIFIER_MAX_CYCLES?.value).toBe(32);

    const loaded = await loadConstantsGolden(projectDir);
    expect(loaded?.constants.KIMI_HOOK_VERIFIER_MAX_CYCLES?.rawValue).toBe('"32"');

    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should detect missing and invalid define keys", async () => {
    projectDir = join(tmpdir(), `constants-heal-diff-${Date.now()}`);
    writeProject({
      "bunfig.toml": `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
# define-domain:governance
KIMI_TUNING_SET_VERSION = '"1.0.0"'
`,
    });

    const golden = await captureConstantsGolden(projectDir);
    golden.constants.KIMI_CONTRACT_INFERENCE_ENABLED = {
      defineDomain: "contract-inference",
      rawValue: '"true"',
      value: true,
    };
    await writeConstantsGolden(projectDir, golden);

    writeFileSync(
      join(projectDir, "bunfig.toml"),
      `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "99"
`
    );

    const plan = await buildConstantRepairPlan(projectDir);
    expect(plan.canRepair).toBe(true);
    expect(plan.diff.invalidKeys.some((item) => item.key === "KIMI_HOOK_VERIFIER_MAX_CYCLES")).toBe(
      true
    );
    expect(plan.diff.missingKeys).toContain("KIMI_CONTRACT_INFERENCE_ENABLED");

    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should repair bunfig from golden template", async () => {
    projectDir = join(tmpdir(), `constants-heal-repair-${Date.now()}`);
    writeProject({
      "bunfig.toml": `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
# define-domain:governance
KIMI_TUNING_SET_VERSION = '"1.0.0"'
`,
    });

    await writeConstantsGolden(projectDir);
    writeFileSync(
      join(projectDir, "bunfig.toml"),
      `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "64"
`
    );

    const dryRun = await repairConstants({ projectRoot: projectDir, dryRun: true });
    expect(dryRun.repairedBunfig).toContain('KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"');

    const applied = await repairConstants({ projectRoot: projectDir, dryRun: false });
    expect(applied.applied).toBe(true);
    expect(applied.decisionId).toStartWith("dec-");

    const current = await loadRepoDefineMap(projectDir);
    expect(current.get("KIMI_HOOK_VERIFIER_MAX_CYCLES")?.value).toBe(32);
    expect(current.get("KIMI_TUNING_SET_VERSION")?.value).toBe("1.0.0");

    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should suppress duplicate repair decisions within one hour", async () => {
    projectDir = join(tmpdir(), `constants-heal-dedupe-${Date.now()}`);
    writeProject({
      "bunfig.toml": `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
# define-domain:governance
KIMI_TUNING_SET_VERSION = '"1.0.0"'
`,
      "types/build-constants.d.ts": `
/**
 * @defineDomain hook-verifier
 * @type number
 * @default 32
 * @restrictions positive integer
 */
declare const KIMI_HOOK_VERIFIER_MAX_CYCLES: number;
`,
    });

    await writeConstantsGolden(projectDir);
    writeFileSync(
      join(projectDir, "bunfig.toml"),
      `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "64"
`
    );

    const first = await repairConstants({ projectRoot: projectDir, dryRun: false });
    expect(first.decisionId).toStartWith("dec-");
    writeFileSync(
      join(projectDir, "bunfig.toml"),
      `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "64"
`
    );
    const second = await repairConstants({ projectRoot: projectDir, dryRun: false });
    expect(second.applied).toBe(true);
    expect(second.decisionId).toBeUndefined();
    expect(second.duplicateDecisionId).toBe(first.decisionId);

    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should validate golden constants against schema before repair", async () => {
    projectDir = join(tmpdir(), `constants-heal-validation-${Date.now()}`);
    writeProject({
      "bunfig.toml": `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "64"
`,
      "types/build-constants.d.ts": `
/**
 * @defineDomain hook-verifier
 * @type number
 * @default 32
 * @restrictions positive integer
 */
declare const KIMI_HOOK_VERIFIER_MAX_CYCLES: number;
`,
    });

    await writeConstantsGolden(projectDir, {
      schemaVersion: "1.0.0",
      tuningSetVersion: "1.0.0",
      capturedAt: "2026-06-15T10:00:00.000Z",
      constants: {
        KIMI_HOOK_VERIFIER_MAX_CYCLES: {
          defineDomain: "hook-verifier",
          rawValue: '"nope"',
          value: "nope",
        },
      },
    });

    await expect(repairConstants({ projectRoot: projectDir, dryRun: false })).rejects.toThrow(
      "Invalid golden constant"
    );

    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should preserve snapshot messages and compute repair hashes", async () => {
    projectDir = join(tmpdir(), `constants-heal-message-${Date.now()}`);
    writeProject({
      "bunfig.toml": `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
`,
    });

    const golden = await writeConstantsGolden(projectDir, undefined, {
      message: "intentional: raise max cycles for load testing",
    });
    expect(golden.message).toBe("intentional: raise max cycles for load testing");
    const hashes = repairHashesForDiff({
      missingKeys: [],
      invalidKeys: [
        {
          key: "KIMI_HOOK_VERIFIER_MAX_CYCLES",
          expected: 32,
          actual: 750,
        },
      ],
    });
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toMatch(/^[a-f0-9]{16}$/);

    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should preview repair impact from bound taxonomies and active failures", async () => {
    projectDir = join(tmpdir(), `constants-heal-impact-${Date.now()}`);
    writeProject({
      "error-taxonomy.yml": `
version: 2
categories:
  - id: lockfile_issue
    name: Lockfile
    description: lockfile
    severity: warn
    expected: false
    boundConstants:
      - KIMI_HOOK_VERIFIER_MAX_CYCLES
    patterns: []
`,
      "bunfig.toml": `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "64"
`,
      "types/build-constants.d.ts": `
/**
 * @defineDomain hook-verifier
 * @type number
 * @default 32
 */
declare const KIMI_HOOK_VERIFIER_MAX_CYCLES: number;
`,
      "failures.jsonl": `${JSON.stringify({
        taxonomyId: "lockfile_issue",
        timestamp: "2026-06-15T09:00:00.000Z",
        toolName: "kimi-guardian",
      })}\n`,
    });

    const impact = await buildConstantRepairImpact(
      projectDir,
      {
        missingKeys: [],
        invalidKeys: [
          {
            key: "KIMI_HOOK_VERIFIER_MAX_CYCLES",
            expected: 32,
            actual: 64,
          },
        ],
      },
      {
        failurePath: join(projectDir, "failures.jsonl"),
        nowMs: Date.parse("2026-06-15T10:00:00.000Z"),
      }
    );

    expect(impact[0]?.boundTaxonomies).toEqual(["lockfile_issue"]);
    expect(impact[0]?.servicesAffected).toEqual(["kimi-guardian"]);
    expect(impact[0]?.estimatedRisk).toBe("medium");

    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should apply define repairs with domain comments for missing keys", () => {
    const bunfig = `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "64"

[test]
preload = []
`;
    const golden = {
      schemaVersion: "1.0.0",
      tuningSetVersion: "1.0.0",
      capturedAt: new Date().toISOString(),
      constants: {
        KIMI_HOOK_VERIFIER_MAX_CYCLES: {
          defineDomain: "hook-verifier",
          rawValue: '"32"',
          value: 32,
        },
        KIMI_TUNING_SET_VERSION: {
          defineDomain: "governance",
          rawValue: '"1.0.0"',
          value: "1.0.0",
        },
      },
    };
    const diff = diffAgainstGolden(
      new Map([
        [
          "KIMI_HOOK_VERIFIER_MAX_CYCLES",
          {
            key: "KIMI_HOOK_VERIFIER_MAX_CYCLES",
            defineDomain: "hook-verifier",
            rawValue: '"64"',
            value: 64,
            line: 3,
          },
        ],
      ]),
      golden
    );

    const repaired = applyDefineRepairs(bunfig, golden, diff);
    expect(repaired).toContain('KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"');
    expect(repaired).toContain("# define-domain:governance");
    expect(repaired).toContain('KIMI_TUNING_SET_VERSION = "1.0.0"');
  });

  it("should normalize legacy numeric golden schemaVersion on load", () => {
    const parsed = parseConstantsGolden({
      schemaVersion: 1,
      tuningSetVersion: "1.0.0",
      capturedAt: "2026-06-15T10:00:00.000Z",
      constants: {
        KIMI_HOOK_VERIFIER_MAX_CYCLES: {
          defineDomain: "hook-verifier",
          rawValue: '"32"',
          value: 32,
        },
      },
    });

    expect(parsed?.schemaVersion).toBe("1.0.0");
    expect(parsed?.tuningSetVersion).toBe("1.0.0");
  });

  it("should archive prior golden on snapshot and support restore", async () => {
    projectDir = join(tmpdir(), `constants-heal-archive-${Date.now()}`);
    writeProject({
      "bunfig.toml": `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
# define-domain:governance
KIMI_TUNING_SET_VERSION = '"1.0.0"'
`,
    });

    const first = await writeConstantsGolden(projectDir);
    writeFileSync(
      join(projectDir, "bunfig.toml"),
      `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "64"
# define-domain:governance
KIMI_TUNING_SET_VERSION = '"1.0.0"'
`
    );
    await writeConstantsGolden(projectDir);

    const archiveDir = constantsGoldenArchiveDir(projectDir);
    expect(existsSync(archiveDir)).toBe(true);
    const archives = await listGoldenArchives(projectDir);
    expect(archives.length).toBeGreaterThanOrEqual(1);

    const archiveName = archives.find(
      (item) => item.tuningSetVersion === first.tuningSetVersion
    )?.name;
    expect(archiveName).toBeDefined();

    await restoreGoldenFromArchive(projectDir, archiveName!);
    const restored = await loadConstantsGolden(projectDir);
    expect(restored?.constants.KIMI_HOOK_VERIFIER_MAX_CYCLES?.value).toBe(32);

    rmSync(projectDir, { recursive: true, force: true });
  });
});
