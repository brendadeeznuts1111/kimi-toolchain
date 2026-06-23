import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, it } from "bun:test";
import { join } from "path";
import { testTempDir } from "./helpers.ts";
import {
  buildManifestDomains,
  expandRepoPath,
  generateConstantsManifest,
  manifestNeedsRefresh,
  parseBunfigDefines,
  parseBuildConstantsTypes,
  parseDefineRawValue,
  stableStringify,
} from "../src/lib/build-constants-registry.ts";
import { checkConstantParity, lintConstantParity } from "../src/lib/constant-parity.ts";

const SAMPLE_BUNFIG = `
[define]
# define-domain:contract-inference
KIMI_CONTRACT_OBSERVATIONS_PATH = '".kimi/var/contract-observations.ndjson"'
KIMI_CONTRACT_INFERENCE_ENABLED = "true"
# define-domain:decision-scoring
KIMI_DECISION_SCORE_WINDOW_DAYS = "7"
`;

const SAMPLE_TYPES = `
/**
 * @defineDomain contract-inference
 * @type string
 * @default ".kimi/var/contract-observations.ndjson"
 * @restrictions must be a relative path from project root
 */
declare const KIMI_CONTRACT_OBSERVATIONS_PATH: string;

/**
 * @defineDomain contract-inference
 * @type boolean
 * @default true
 */
declare const KIMI_CONTRACT_INFERENCE_ENABLED: boolean;

/**
 * @defineDomain decision-scoring
 * @type number
 * @default 7
 */
declare const KIMI_DECISION_SCORE_WINDOW_DAYS: number;
`;

describe("buildConstantsRegistry", () => {
  it("should parse define raw values", () => {
    expect(parseDefineRawValue("true")).toBe(true);
    expect(parseDefineRawValue('"32"')).toBe(32);
    expect(parseDefineRawValue("'\".kimi/var/x\"'")).toBe(".kimi/var/x");
    expect(parseDefineRawValue('"0.55"')).toBe(0.55);
  });

  it("should parse bunfig define domains and keys", () => {
    const defines = parseBunfigDefines(SAMPLE_BUNFIG);
    expect(defines).toHaveLength(3);
    expect(defines[0]).toMatchObject({
      key: "KIMI_CONTRACT_OBSERVATIONS_PATH",
      defineDomain: "contract-inference",
      value: ".kimi/var/contract-observations.ndjson",
    });
    expect(defines[2]).toMatchObject({
      key: "KIMI_DECISION_SCORE_WINDOW_DAYS",
      defineDomain: "decision-scoring",
      value: 7,
    });
  });

  it("should parse structured JSDoc annotations", () => {
    const types = parseBuildConstantsTypes(SAMPLE_TYPES);
    expect(types.get("KIMI_CONTRACT_OBSERVATIONS_PATH")).toMatchObject({
      defineDomain: "contract-inference",
      type: "string",
      default: ".kimi/var/contract-observations.ndjson",
      restrictions: "must be a relative path from project root",
    });
  });

  it("should parse union literal declare types", () => {
    const types = parseBuildConstantsTypes(`
/**
 * @defineDomain effect-discipline
 * @type string
 * @default "strict"
 * @restrictions one of strict | gradual | off
 */
declare const KIMI_DOMAIN_PURITY_LEVEL: "strict" | "gradual" | "off";
`);
    expect(types.get("KIMI_DOMAIN_PURITY_LEVEL")).toMatchObject({
      defineDomain: "effect-discipline",
      type: "string",
      enumValues: ["strict", "gradual", "off"],
    });
  });

  it("should merge bunfig and types into manifest domains", () => {
    const domains = buildManifestDomains(
      parseBunfigDefines(SAMPLE_BUNFIG),
      parseBuildConstantsTypes(SAMPLE_TYPES)
    );
    expect(domains["contract-inference"]?.KIMI_CONTRACT_INFERENCE_ENABLED).toMatchObject({
      type: "boolean",
      default: true,
    });
    expect(domains["decision-scoring"]?.KIMI_DECISION_SCORE_WINDOW_DAYS?.default).toBe(7);
  });

  it("should expand repo paths relative to project root and home", () => {
    expect(expandRepoPath(".", "/tmp/root")).toBe("/tmp/root");
    expect(expandRepoPath("~/accounting-telegram", "/tmp/root")).toContain("accounting-telegram");
  });

  it("should detect stale manifests ignoring generatedAt", () => {
    const generated = {
      schemaVersion: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      repo: "demo",
      tuningSetVersion: "1.0.0",
      domains: { demo: { KIMI_X: { type: "number", default: 1 } } },
      parity: { shared: [] },
    };
    const existing = {
      ...generated,
      generatedAt: "2026-06-01T00:00:00.000Z",
    };
    expect(manifestNeedsRefresh(generated, existing)).toBe(false);
    expect(
      manifestNeedsRefresh(generated, {
        ...existing,
        domains: { demo: { KIMI_X: { type: "number", default: 2 } } },
      })
    ).toBe(true);
  });
});

describe("constantParity", () => {
  let projectDir: string;

  function writeProject(files: Record<string, string>): void {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(projectDir, path);
      makeDir(fullPath.split("/").slice(0, -1).join("/"), { recursive: true });
      writeText(fullPath, content);
    }
  }

  it("should warn when sibling repo is missing but local shared value exists", async () => {
    projectDir = testTempDir("constant-parity-");
    writeProject({
      "constants-parity.toml": `
schemaVersion = 1

[repos.kimi-toolchain]
path = "."
bunfig = "bunfig.toml"

[repos.accounting-telegram]
path = "./missing-repo"
bunfig = "bunfig.toml"

[[shared]]
id = "velocity-window-days"

[shared.repos.kimi-toolchain]
key = "KIMI_DECISION_SCORE_WINDOW_DAYS"
defineDomain = "decision-scoring"

[shared.repos.accounting-telegram]
key = "DRIFT_VELOCITY_WINDOW_DAYS"
defineDomain = "drift-predict"
`,
      "bunfig.toml": `
[define]
# define-domain:decision-scoring
KIMI_DECISION_SCORE_WINDOW_DAYS = "7"
`,
      "types/build-constants.d.ts": SAMPLE_TYPES,
      "package.json": JSON.stringify({ name: "demo" }),
    });

    const lint = await lintConstantParity(projectDir);
    expect(lint.ok).toBe(true);
    expect(lint.warnings.length).toBeGreaterThan(0);

    const report = await checkConstantParity(projectDir);
    expect(report.applicable).toBe(true);
    expect(report.aligned).toBe(false);
    expect(report.checks.some((check) => check.status === "warn")).toBe(true);

    removePath(projectDir, { recursive: true, force: true });
  });

  it("should error on value drift when both repos are present", async () => {
    projectDir = testTempDir("constant-parity-drift-");
    const siblingDir = join(projectDir, "sibling");
    makeDir(siblingDir, { recursive: true });

    writeProject({
      "constants-parity.toml": `
schemaVersion = 1

[repos.local]
path = "."
bunfig = "bunfig.toml"

[repos.sibling]
path = "./sibling"
bunfig = "bunfig.toml"

[[shared]]
id = "velocity-window-days"

[shared.repos.local]
key = "KIMI_DECISION_SCORE_WINDOW_DAYS"
defineDomain = "decision-scoring"

[shared.repos.sibling]
key = "DRIFT_VELOCITY_WINDOW_DAYS"
defineDomain = "drift-predict"
`,
      "bunfig.toml": `
[define]
# define-domain:decision-scoring
KIMI_DECISION_SCORE_WINDOW_DAYS = "7"
`,
      "types/build-constants.d.ts": SAMPLE_TYPES,
      "package.json": JSON.stringify({ name: "demo" }),
    });

    writeText(
      join(siblingDir, "bunfig.toml"),
      `
[define]
# define-domain:drift-predict
DRIFT_VELOCITY_WINDOW_DAYS = "14"
`
    );

    const lint = await lintConstantParity(projectDir);
    expect(lint.ok).toBe(false);
    expect(lint.violations.join("\n")).toContain("value drift");

    removePath(projectDir, { recursive: true, force: true });
  });
});

describe("generateConstantsManifest", () => {
  it("should generate manifest for kimi-toolchain repo", async () => {
    const root = join(import.meta.dir, "..");
    const manifest = await generateConstantsManifest(root);
    expect(manifest.repo).toBe("kimi-toolchain");
    expect(manifest.tuningSetVersion).toBe("1.4.5");
    expect(manifest.domains["decision-scoring"]?.KIMI_DECISION_SCORE_WINDOW_DAYS?.default).toBe(7);
    expect(manifest.parity.shared.some((entry) => entry.id === "velocity-window-days")).toBe(true);
    expect(stableStringify(manifest)).toContain("KIMI_HOOK_VERIFIER_MAX_CYCLES");
  });
});
