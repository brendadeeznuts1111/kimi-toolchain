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
  repairConstants,
  writeConstantsGolden,
} from "../src/lib/constants-heal.ts";
import { loadRepoDefineMap } from "../src/lib/build-constants-registry.ts";

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

  it("should apply define repairs with domain comments for missing keys", () => {
    const bunfig = `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "64"

[test]
preload = []
`;
    const golden = {
      schemaVersion: 1,
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
});
