import { describe, expect, test } from "bun:test";
import { join } from "path";
import { writeText } from "../src/lib/bun-io.ts";
import {
  auditBunInstallConfig,
  BUN_GLOBAL_INSTALL_PATHS,
  BUN_INSTALL_BUNFIG_POLICY,
  BUN_INSTALL_CLI,
  BUN_INSTALL_DOCS_URL,
  BUN_INSTALL_WORKSPACE_POLICY,
  BUN_WORKSPACE_ROOT_CONSUMER_LINK,
  BUN_INSTALL_ENV_VARS,
  BUN_INSTALL_PLATFORM_POLICY,
  BUN_INSTALL_POLICY_GROUP_ORDER,
  BUN_INSTALL_POLICY_MIN_BUN,
  BUN_INSTALL_STREAMING_EXTRACT_DISABLE_ENV,
  buildInstallPolicyReport,
  BUN_INSTALL_REQUIRED_KEYS,
  collectInstallPropertyReferences,
  formatInstallCliWorkflow,
  formatInstallPropertyReferenceTable,
  formatInstallPolicyReport,
  policyRowToPropertyRef,
  SECURE_BUN_INSTALL_POLICY,
} from "../src/lib/bun-install-config.ts";
import { loadTaxonomy } from "../src/lib/error-taxonomy.ts";
import { REPO_ROOT, testTempDir, withEnv } from "./helpers.ts";

const SECURE_BUNFIG = `[install]
optional = true
dev = true
peer = true
production = false
dryRun = false
saveTextLockfile = true
frozenLockfile = true
exact = false
ignoreScripts = false
concurrentScripts = 8
linker = "isolated"
globalDir = "~/.bun/install/global"
globalBinDir = "~/.bun/bin"
minimumReleaseAge = 259200
minimumReleaseAgeExcludes = ["@types/bun", "@types/node", "typescript"]

[install.cache]
dir = "~/.bun/install/cache"
`;

const SECURE_PACKAGE_JSON = {
  name: "demo",
  version: "1.0.0",
  packageManager: `bun@${BUN_INSTALL_POLICY_MIN_BUN}`,
  engines: { bun: `>=${BUN_INSTALL_POLICY_MIN_BUN}` },
  trustedDependencies: [] as string[],
};

describe("bun-install-config", () => {
  test("BUN_INSTALL_BUNFIG_POLICY rows cover hardened policy keys", () => {
    for (const [key, value] of Object.entries(SECURE_BUN_INSTALL_POLICY)) {
      if (key === "minimumReleaseAgeExcludes") continue;
      const row = BUN_INSTALL_BUNFIG_POLICY.find((r) => r.key === key);
      expect(row, `missing policy row for ${key}`).toBeDefined();
      expect(String(value)).toBe(row!.hardenedDefault);
    }
    expect(BUN_INSTALL_PLATFORM_POLICY.some((r) => r.key === "targetOs")).toBe(true);
    expect(BUN_INSTALL_PLATFORM_POLICY.find((r) => r.key === "targetOs")?.notes).toContain("sunos");
  });

  test("BUN_INSTALL_ENV_VARS documents risky skip flags", () => {
    const risky = BUN_INSTALL_ENV_VARS.filter((row) => row.risky).map((row) => row.name);
    expect(risky).toContain("BUN_CONFIG_SKIP_SAVE_LOCKFILE");
    expect(risky).toContain("BUN_CONFIG_SKIP_LOAD_LOCKFILE");
    expect(BUN_INSTALL_ENV_VARS.map((row) => row.name)).toContain(
      BUN_INSTALL_STREAMING_EXTRACT_DISABLE_ENV
    );
  });

  test("buildInstallPolicyReport groups tables in stable order", async () => {
    const dir = testTempDir("bun-install-groups-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    const report = await buildInstallPolicyReport(dir);
    expect(report.schemaVersion).toBe(1);
    expect(report.versions.policyMinBun).toBe(BUN_INSTALL_POLICY_MIN_BUN);
    expect(Object.keys(report.tables)).toEqual(
      expect.arrayContaining(BUN_INSTALL_POLICY_GROUP_ORDER.filter((g) => g !== "environment"))
    );
    expect(report.tables.platform.length).toBeGreaterThan(0);
    expect(
      report.tables["package-json"].find((r) => r.key === "trustedDependencies")?.current
    ).toBe("[]");
  });

  test("formatInstallPropertyReferenceTable uses standard column schema", () => {
    const lines = formatInstallPropertyReferenceTable();
    expect(lines[0]).toBe(
      "| Property | Type | Default | Required | Description | VersionAdded | LastModified |"
    );
    expect(lines.some((l) => l.includes("[install].frozenLockfile"))).toBe(true);
    expect(lines.some((l) => l.includes("cli.update"))).toBe(true);
  });

  test("policyRowToPropertyRef marks hardened keys as required", () => {
    const frozen = BUN_INSTALL_BUNFIG_POLICY.find((r) => r.key === "frozenLockfile");
    expect(frozen).toBeDefined();
    const ref = policyRowToPropertyRef(frozen!);
    expect(ref.property).toBe("[install].frozenLockfile");
    expect(ref.required).toBe(true);
    expect(BUN_INSTALL_REQUIRED_KEYS.has("frozenLockfile")).toBe(true);
    expect(collectInstallPropertyReferences().length).toBeGreaterThan(
      BUN_INSTALL_BUNFIG_POLICY.length
    );
  });

  test("BUN_INSTALL_WORKSPACE_POLICY documents Path A layout", () => {
    const workspaces = BUN_INSTALL_WORKSPACE_POLICY.find((r) => r.key === "workspaces");
    const rootLink = BUN_INSTALL_WORKSPACE_POLICY.find((r) => r.key === "rootConsumerLink");
    expect(workspaces?.hardenedDefault).toBe('["examples/*"]');
    expect(rootLink?.hardenedDefault).toBe(BUN_WORKSPACE_ROOT_CONSUMER_LINK);
    expect(BUN_INSTALL_CLI.installFilter).toContain("--filter");
    expect(BUN_INSTALL_POLICY_GROUP_ORDER).toContain("workspace");
  });

  test("buildInstallPolicyReport reads workspace rows from repo root", async () => {
    const report = await buildInstallPolicyReport(REPO_ROOT);
    const workspaces = report.tables.workspace.find((r) => r.key === "workspaces");
    const rootLink = report.tables.workspace.find((r) => r.key === "rootConsumerLink");
    expect(workspaces?.current).toBe('["examples/*"]');
    expect(rootLink?.current).toBe(BUN_WORKSPACE_ROOT_CONSUMER_LINK);
    expect(rootLink?.status).toBe("ok");
  });

  test("BUN_INSTALL_CLI documents add and update paths", () => {
    expect(BUN_INSTALL_CLI.add).toBe("bun add <pkg>");
    expect(BUN_INSTALL_CLI.update).toBe("bun update <pkg>");
    expect(BUN_INSTALL_CLI.reproducible).toBe("bun ci");
    expect(formatInstallCliWorkflow().some((l) => l.includes("bun update"))).toBe(true);
  });

  test("error-taxonomy lockfile_issue autoFix matches BUN_INSTALL_CLI.guardianFix", async () => {
    const taxonomy = await loadTaxonomy(join(REPO_ROOT, "error-taxonomy.yml"));
    const lockfile = taxonomy.categories.find((c) => c.id === "lockfile_issue");
    expect(lockfile?.autoFix).toBe(BUN_INSTALL_CLI.guardianFix);
    expect(lockfile?.suggestion).toContain("bun add");
    expect(lockfile?.suggestion).toContain("bun update");
  });

  test("formatInstallPolicyReport includes version header and platform section", async () => {
    const dir = testTempDir("bun-install-format-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    const report = await buildInstallPolicyReport(dir);
    const lines = formatInstallPolicyReport(report);
    expect(lines[0]).toContain("policy≥");
    expect(lines.some((l) => l.includes("streamingExtraction: enabled"))).toBe(true);
    expect(lines.some((l) => l.includes("isolatedLinkerFastPath: active"))).toBe(true);
    expect(lines.some((l) => l.includes("sourceMapsMemory: optimized"))).toBe(true);
    expect(lines.some((l) => l.includes("Platform-specific"))).toBe(true);
    expect(lines.some((l) => l.includes("targetOs"))).toBe(true);
    expect(lines.some((l) => l.includes("Install CLI workflow"))).toBe(true);
    expect(lines.some((l) => l.includes("## Property reference"))).toBe(true);
  });

  test("auditBunInstallConfig warns on risky env overrides", async () => {
    const dir = testTempDir("bun-install-audit-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    await withEnv({ BUN_CONFIG_SKIP_SAVE_LOCKFILE: "1" }, async () => {
      const audit = await auditBunInstallConfig(dir);
      expect(audit.ok).toBe(false);
      expect(audit.docsUrl).toBe(BUN_INSTALL_DOCS_URL);
      expect(audit.warnings.some((w) => w.includes("BUN_CONFIG_SKIP_SAVE_LOCKFILE"))).toBe(true);
    });
  });

  test("auditBunInstallConfig reports streaming install fallback without failing", async () => {
    const dir = testTempDir("bun-install-streaming-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    await withEnv(
      {
        [BUN_INSTALL_STREAMING_EXTRACT_DISABLE_ENV]: "1",
        BUN_CONFIG_SKIP_SAVE_LOCKFILE: undefined,
        BUN_CONFIG_SKIP_LOAD_LOCKFILE: undefined,
        BUN_CONFIG_SKIP_INSTALL_PACKAGES: undefined,
      },
      async () => {
        const audit = await auditBunInstallConfig(dir);
        expect(audit.ok).toBe(true);
        expect(audit.runtimeCapabilities.streamingExtraction.status).toBe("disabled");
        expect(audit.runtimeCapabilities.streamingExtraction.disableEnvValue).toBe("1");
        expect(audit.runtimeCapabilities.isolatedLinkerFastPath.status).toBe("active");
        expect(audit.envOverrides).toContainEqual({
          name: BUN_INSTALL_STREAMING_EXTRACT_DISABLE_ENV,
          value: "1",
          risky: false,
          diagnostic: true,
        });
      }
    );
  });

  test("buildInstallPolicyReport documents Bun 1.3.13 source map memory optimization", async () => {
    const dir = testTempDir("bun-install-source-maps-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    const report = await buildInstallPolicyReport(dir);

    expect(report.runtimeCapabilities.sourceMapsMemory).toEqual({
      status: "optimized",
      releaseUrl: "https://bun.com/blog/bun-v1.3.13",
      notes:
        "Bun 1.3.13+ stores source maps in a compact bit-packed format, reducing memory pressure for large maps during stack lookups and compiled-binary startup.",
    });
  });

  test("auditBunInstallConfig warns when frozenLockfile is false", async () => {
    const dir = testTempDir("bun-install-weak-");
    writeText(
      join(dir, "bunfig.toml"),
      SECURE_BUNFIG.replace("frozenLockfile = true", "frozenLockfile = false")
    );
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    const audit = await auditBunInstallConfig(dir);
    expect(audit.ok).toBe(false);
    expect(audit.tables.lockfile.find((r) => r.key === "frozenLockfile")?.status).toBe("drift");
  });

  test("auditBunInstallConfig passes secure toolchain bunfig", async () => {
    const dir = testTempDir("bun-install-ok-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    await withEnv(
      {
        BUN_CONFIG_SKIP_SAVE_LOCKFILE: undefined,
        BUN_CONFIG_SKIP_LOAD_LOCKFILE: undefined,
        BUN_CONFIG_SKIP_INSTALL_PACKAGES: undefined,
      },
      async () => {
        const audit = await auditBunInstallConfig(dir);
        expect(audit.ok).toBe(true);
        expect(audit.bunfigInstall?.frozenLockfile).toBe(true);
        expect(audit.bunfigInstall?.linker).toBe("isolated");
        expect(audit.runtimeCapabilities.streamingExtraction.status).toBe("enabled");
        expect(audit.runtimeCapabilities.isolatedLinkerFastPath.status).toBe("active");
        expect(audit.bunfigInstall?.globalBinDir).toBe("~/.bun/bin");
      }
    );
  });

  test("auditBunInstallConfig warns when concurrentScripts is unset", async () => {
    const dir = testTempDir("bun-install-no-concurrent-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG.replace("concurrentScripts = 8\n", ""));
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    const audit = await auditBunInstallConfig(dir);
    expect(audit.ok).toBe(false);
    expect(audit.tables.performance.find((r) => r.key === "concurrentScripts")?.status).toBe(
      "missing"
    );
  });

  test("repo root bunfig.toml matches secure install policy", async () => {
    await withEnv(
      {
        BUN_CONFIG_SKIP_SAVE_LOCKFILE: undefined,
        BUN_CONFIG_SKIP_LOAD_LOCKFILE: undefined,
        BUN_CONFIG_SKIP_INSTALL_PACKAGES: undefined,
      },
      async () => {
        const audit = await auditBunInstallConfig(REPO_ROOT);
        expect(audit.ok).toBe(true);
        expect(audit.bunfigInstall?.globalDir).toBe(BUN_GLOBAL_INSTALL_PATHS.globalDir);
        expect(audit.bunfigInstall?.globalBinDir).toBe(BUN_GLOBAL_INSTALL_PATHS.globalBinDir);
        expect(audit.versions.packageManager).toMatch(/^bun@/);
      }
    );
  });
});
