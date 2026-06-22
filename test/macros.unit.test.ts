import { describe, expect, test } from "bun:test";
import { buildInfo, buildSummary, buildBanner, type BuildInfo } from "../src/lib/build-info.ts";
import { kimiSecretsHelp, kimiGuardianHelp, generalHelp } from "../src/lib/cli-help.ts";
import {
  features,
  featureInfo,
  type Features,
  type FeatureFlagInfo,
} from "../src/lib/feature-flags.ts";

// ── Build Info Tests ─────────────────────────────────────────────────

describe("build-info > buildInfo", () => {
  test("has gitHash string", () => {
    expect(typeof buildInfo.gitHash).toBe("string");
    expect(buildInfo.gitHash.length).toBeGreaterThan(0);
  });

  test("has gitBranch string", () => {
    expect(typeof buildInfo.gitBranch).toBe("string");
    expect(buildInfo.gitBranch.length).toBeGreaterThan(0);
  });

  test("has buildTime as ISO string", () => {
    expect(typeof buildInfo.buildTime).toBe("string");
    const parsed = new Date(buildInfo.buildTime);
    expect(parsed.getTime()).not.toBeNaN();
  });

  test("has version string", () => {
    expect(typeof buildInfo.version).toBe("string");
    expect(buildInfo.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("has bunVersion", () => {
    expect(typeof buildInfo.bunVersion).toBe("string");
    expect(buildInfo.bunVersion).toMatch(/^\d+\.\d+/);
  });

  test("has platform string", () => {
    expect(typeof buildInfo.platform).toBe("string");
    expect(buildInfo.platform).toContain("-");
  });
});

describe("build-info > buildSummary", () => {
  test("contains version and git hash", () => {
    expect(buildSummary).toContain(buildInfo.version);
    expect(buildSummary).toContain(buildInfo.gitHash);
  });

  test("starts with 'v'", () => {
    expect(buildSummary.startsWith("v")).toBe(true);
  });
});

describe("build-info > buildBanner", () => {
  test("contains toolchain name", () => {
    expect(buildBanner).toContain("kimi-toolchain");
  });

  test("contains branch info", () => {
    expect(buildBanner).toContain("branch:");
    expect(buildBanner).toContain(buildInfo.gitBranch);
  });

  test("contains bun version", () => {
    expect(buildBanner).toContain("bun:");
    expect(buildBanner).toContain(buildInfo.bunVersion);
  });

  test("contains platform", () => {
    expect(buildBanner).toContain("platform:");
    expect(buildBanner).toContain(buildInfo.platform);
  });
});

describe("build-info > BuildInfo type", () => {
  test("type matches object shape", () => {
    const info: BuildInfo = buildInfo;
    expect(info.gitHash).toBeDefined();
    expect(info.version).toBeDefined();
  });
});

// ── CLI Help Tests ───────────────────────────────────────────────────

describe("cli-help > kimiSecretsHelp", () => {
  test("contains title", () => {
    expect(kimiSecretsHelp).toContain("kimi-secrets");
  });

  test("lists all commands", () => {
    expect(kimiSecretsHelp).toContain("check");
    expect(kimiSecretsHelp).toContain("list");
    expect(kimiSecretsHelp).toContain("get");
    expect(kimiSecretsHelp).toContain("set");
    expect(kimiSecretsHelp).toContain("rotate");
    expect(kimiSecretsHelp).toContain("delete");
    expect(kimiSecretsHelp).toContain("audit");
    expect(kimiSecretsHelp).toContain("init");
  });

  test("lists options", () => {
    expect(kimiSecretsHelp).toContain("--json");
    expect(kimiSecretsHelp).toContain("--unmask");
    expect(kimiSecretsHelp).toContain("--project");
  });

  test("contains examples", () => {
    expect(kimiSecretsHelp).toContain("Examples:");
    expect(kimiSecretsHelp).toContain("kimi-secrets check");
  });

  test("contains build stamp", () => {
    expect(kimiSecretsHelp).toContain("Build:");
  });
});

describe("cli-help > kimiGuardianHelp", () => {
  test("contains title", () => {
    expect(kimiGuardianHelp).toContain("kimi-guardian");
  });

  test("lists all commands", () => {
    expect(kimiGuardianHelp).toContain("check");
    expect(kimiGuardianHelp).toContain("fix");
    expect(kimiGuardianHelp).toContain("sign");
    expect(kimiGuardianHelp).toContain("verify");
    expect(kimiGuardianHelp).toContain("report");
    expect(kimiGuardianHelp).toContain("doctor");
  });

  test("contains build stamp", () => {
    expect(kimiGuardianHelp).toContain("Build:");
  });
});

describe("cli-help > generalHelp", () => {
  test("contains toolchain name", () => {
    expect(generalHelp).toContain("kimi-toolchain");
  });

  test("lists all tools", () => {
    expect(generalHelp).toContain("kimi-secrets");
    expect(generalHelp).toContain("kimi-guardian");
    expect(generalHelp).toContain("install-secure");
  });

  test("contains build stamp", () => {
    expect(generalHelp).toContain("Build:");
  });
});

// ── Feature Flags Tests ──────────────────────────────────────────────

describe("feature-flags > features", () => {
  test("scanner is enabled by default", () => {
    expect(features.scanner).toBe(true);
  });

  test("identity is enabled by default", () => {
    expect(features.identity).toBe(true);
  });

  test("audit is enabled by default", () => {
    expect(features.audit).toBe(true);
  });

  test("dashboard is disabled by default", () => {
    expect(features.dashboard).toBe(false);
  });

  test("sarifOutput is disabled by default", () => {
    expect(features.sarifOutput).toBe(false);
  });

  test("sbom is disabled by default", () => {
    expect(features.sbom).toBe(false);
  });

  test("debug is disabled by default", () => {
    expect(features.debug).toBe(false);
  });

  test("all flags are booleans", () => {
    expect(typeof features.scanner).toBe("boolean");
    expect(typeof features.identity).toBe("boolean");
    expect(typeof features.audit).toBe("boolean");
    expect(typeof features.dashboard).toBe("boolean");
    expect(typeof features.sarifOutput).toBe("boolean");
    expect(typeof features.sbom).toBe("boolean");
    expect(typeof features.debug).toBe("boolean");
  });
});

describe("feature-flags > featureInfo", () => {
  test("has 7 feature flag entries", () => {
    expect(featureInfo).toHaveLength(7);
  });

  test("each entry has name, envVar, enabled, description", () => {
    for (const info of featureInfo) {
      expect(info.name).toBeTruthy();
      expect(info.envVar).toBeTruthy();
      expect(typeof info.enabled).toBe("boolean");
      expect(info.description).toBeTruthy();
    }
  });

  test("enabled flags match features object", () => {
    for (const info of featureInfo) {
      expect(info.enabled).toBe(features[info.name as keyof Features]);
    }
  });

  test("contains expected env var names", () => {
    const envVars = featureInfo.map((f) => f.envVar);
    expect(envVars).toContain("SCANNER_ENABLED");
    expect(envVars).toContain("IDENTITY_ENABLED");
    expect(envVars).toContain("DASHBOARD_ENABLED");
  });
});
