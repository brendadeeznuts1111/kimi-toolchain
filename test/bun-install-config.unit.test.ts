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
  BUN_INSTALL_OFFICIAL_ENV_VAR_NAMES,
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

  test("BUN_INSTALL_PLATFORM_POLICY documents cpu and os package selection overrides", async () => {
    const dir = testTempDir("bun-install-platform-targets-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    const report = await buildInstallPolicyReport(dir);
    const targetCpu = report.tables.platform.find((row) => row.key === "targetCpu");
    const targetOs = report.tables.platform.find((row) => row.key === "targetOs");

    expect(targetCpu).toMatchObject({
      cliFlag: "--cpu",
      officialDefault: "runtime arch",
      hardenedDefault: "runtime arch",
      current: process.arch,
      status: "n/a",
    });
    expect(targetCpu?.notes).toContain("Override CPU for platform-specific package selection");
    expect(targetCpu?.docsUrl).toContain("platform-specific-dependencies");

    expect(targetOs).toMatchObject({
      cliFlag: "--os",
      officialDefault: "runtime os",
      hardenedDefault: "runtime os",
      current: process.platform,
      status: "n/a",
    });
    expect(targetOs?.notes).toContain("Override OS for platform-specific package selection");
    expect(targetOs?.notes).toContain("sunos");
    expect(targetOs?.docsUrl).toContain("platform-specific-dependencies");
  });

  test("BUN_INSTALL_ENV_VARS documents risky skip flags", () => {
    const risky = BUN_INSTALL_ENV_VARS.filter((row) => row.risky).map((row) => row.name);
    expect(risky).toContain("BUN_CONFIG_SKIP_SAVE_LOCKFILE");
    expect(risky).toContain("BUN_CONFIG_SKIP_LOAD_LOCKFILE");
    expect(BUN_INSTALL_ENV_VARS.map((row) => row.name)).toContain(
      BUN_INSTALL_STREAMING_EXTRACT_DISABLE_ENV
    );
  });

  test("BUN_INSTALL_ENV_VARS documents official higher-priority env overrides", async () => {
    const dir = testTempDir("bun-install-env-priority-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    const names = BUN_INSTALL_ENV_VARS.map((row) => row.name);
    expect(BUN_INSTALL_OFFICIAL_ENV_VAR_NAMES).toEqual([
      "BUN_CONFIG_REGISTRY",
      "BUN_CONFIG_TOKEN",
      "BUN_CONFIG_YARN_LOCKFILE",
      "BUN_CONFIG_LINK_NATIVE_BINS",
      "BUN_CONFIG_SKIP_SAVE_LOCKFILE",
      "BUN_CONFIG_SKIP_LOAD_LOCKFILE",
      "BUN_CONFIG_SKIP_INSTALL_PACKAGES",
    ]);
    for (const name of BUN_INSTALL_OFFICIAL_ENV_VAR_NAMES) {
      expect(names).toContain(name);
    }

    const report = await buildInstallPolicyReport(dir);
    for (const name of BUN_INSTALL_OFFICIAL_ENV_VAR_NAMES) {
      const row = report.envRows.find((env) => env.name === name);
      expect(row?.priority).toBe("higher priority than bunfig.toml");
    }
    expect(report.envRows.find((env) => env.name === "BUN_CONFIG_REGISTRY")?.description).toContain(
      "npm registry"
    );
    expect(
      report.envRows.find((env) => env.name === "BUN_CONFIG_SKIP_INSTALL_PACKAGES")?.description
    ).toContain("don't install any packages");
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

    await withEnv(
      {
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: undefined,
        BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT: undefined,
      },
      async () => {
        const report = await buildInstallPolicyReport(dir);
        const lines = formatInstallPolicyReport(report);
        expect(lines[0]).toContain("policy≥");
        expect(lines.some((l) => l.includes("streamingExtraction: enabled"))).toBe(true);
        expect(lines.some((l) => l.includes("isolatedLinkerFastPath: active"))).toBe(true);
        expect(lines.some((l) => l.includes("sourceMapsMemory: optimized"))).toBe(true);
        expect(lines.some((l) => l.includes("pmPackLifecycleManifest: rereads"))).toBe(true);
        expect(lines.some((l) => l.includes("inspectorProfiler: available"))).toBe(true);
        expect(lines.some((l) => l.includes("ffiCompilerPaths: env-aware"))).toBe(true);
        expect(lines.some((l) => l.includes("packageManagerFixes: tracked"))).toBe(true);
        expect(lines.some((l) => l.includes("parallelConsole: buffered"))).toBe(true);
        expect(lines.some((l) => l.includes("Runtime environment"))).toBe(true);
        expect(lines.some((l) => l.includes("transpilerCache: snapshot-only"))).toBe(true);
        expect(lines.some((l) => l.includes("Platform-specific"))).toBe(true);
        expect(lines.some((l) => l.includes("targetOs"))).toBe(true);
        expect(lines.some((l) => l.includes("Install CLI workflow"))).toBe(true);
        expect(lines.some((l) => l.includes("## Property reference"))).toBe(true);
      }
    );
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
      releaseUrl: "https://bun.com/blog/bun-v1.3.13#source-maps-use-up-to-8x-less-memory",
      notes:
        "Bun 1.3.13+ stores source maps in a compact bit-packed format instead of the older Mapping.List representation, reducing memory pressure for large maps during stack lookups and compiled-binary startup.",
    });
  });

  test("buildInstallPolicyReport documents Bun pm pack lifecycle manifest reread", async () => {
    const dir = testTempDir("bun-install-pack-lifecycle-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    const report = await buildInstallPolicyReport(dir);

    expect(report.runtimeCapabilities.pmPackLifecycleManifest).toEqual({
      status: "rereads-package-json",
      command: "bun pm pack",
      lifecycleScripts: ["prepack", "prepare", "prepublishOnly"],
      packageJsonBehavior: "re-read after lifecycle scripts",
      notes:
        "Bun re-reads package.json after pack lifecycle scripts, so clean-package style mutations are reflected in the produced tarball.",
    });
  });

  test("buildInstallPolicyReport documents node inspector Profiler API", async () => {
    const dir = testTempDir("bun-install-inspector-profiler-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    const report = await buildInstallPolicyReport(dir);

    expect(report.runtimeCapabilities.inspectorProfiler).toEqual({
      status: "available",
      module: "node:inspector/promises",
      methods: [
        "Profiler.enable",
        "Profiler.disable",
        "Profiler.start",
        "Profiler.stop",
        "Profiler.setSamplingInterval",
      ],
      profileFormat: "Chrome DevTools Protocol",
      notes:
        "Bun implements the node:inspector Profiler API for CPU profiling and returns Chrome DevTools Protocol profile payloads.",
    });
  });

  test("buildInstallPolicyReport documents bun:ffi compiler path env support", async () => {
    const dir = testTempDir("bun-install-ffi-compiler-paths-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    await withEnv({ C_INCLUDE_PATH: undefined, LIBRARY_PATH: undefined }, async () => {
      const report = await buildInstallPolicyReport(dir);

      expect(report.runtimeCapabilities.ffiCompilerPaths).toEqual({
        status: "env-aware",
        module: "bun:ffi",
        env: {
          C_INCLUDE_PATH: null,
          LIBRARY_PATH: null,
        },
        appliesTo: "Bun built-in C compiler",
        platformUse: "NixOS and non-FHS systems",
        notes:
          "Bun's built-in C compiler respects standard C_INCLUDE_PATH and LIBRARY_PATH values when resolving headers and libraries for bun:ffi.",
      });
    });
  });

  test("buildInstallPolicyReport captures bun:ffi compiler path env overrides", async () => {
    const dir = testTempDir("bun-install-ffi-compiler-env-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    await withEnv(
      {
        C_INCLUDE_PATH: "/nix/store/demo-include/include",
        LIBRARY_PATH: "/nix/store/demo-lib/lib",
      },
      async () => {
        const report = await buildInstallPolicyReport(dir);

        expect(report.runtimeCapabilities.ffiCompilerPaths.env).toEqual({
          C_INCLUDE_PATH: "/nix/store/demo-include/include",
          LIBRARY_PATH: "/nix/store/demo-lib/lib",
        });
      }
    );
  });

  test("buildInstallPolicyReport tracks Bun package-manager regression fixes", async () => {
    const dir = testTempDir("bun-install-pm-fixes-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    const report = await buildInstallPolicyReport(dir);
    const fixes = report.runtimeCapabilities.packageManagerFixes.fixes;
    const byId = new Map(fixes.map((fix) => [fix.id, fix]));

    expect(report.runtimeCapabilities.packageManagerFixes.status).toBe("tracked");
    expect([...byId.keys()]).toEqual([
      "update-interactive-latest-toggle",
      "install-yarn-workspace-lockfile",
      "frozen-lockfile-scope-registry",
      "file-path-stale-lockfile-error",
      "add-network-metadata-panic",
    ]);
    expect(byId.get("update-interactive-latest-toggle")?.command).toBe(
      BUN_INSTALL_CLI.updateInteractive
    );
    expect(byId.get("install-yarn-workspace-lockfile")?.command).toBe("bun install --yarn");
    expect(byId.get("install-yarn-workspace-lockfile")?.regression).toContain("workspace:*");
    expect(byId.get("frozen-lockfile-scope-registry")?.command).toBe(BUN_INSTALL_CLI.frozenInstall);
    expect(byId.get("frozen-lockfile-scope-registry")?.expected).toContain(
      "scope-specific registries"
    );
    expect(byId.get("file-path-stale-lockfile-error")?.expected).toContain("dependency name");
    expect(byId.get("add-network-metadata-panic")?.regression).toContain(
      "Expected metadata to be set"
    );
  });

  test("buildInstallPolicyReport documents Bun parallel console buffering", async () => {
    const dir = testTempDir("bun-install-parallel-console-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    const report = await buildInstallPolicyReport(dir);

    expect(report.runtimeCapabilities.parallelConsole).toEqual({
      status: "buffered",
      appliesTo: "bun test --parallel",
      flush: "per-file atomic",
      streams: ["console.log", "console.error"],
      notes:
        "Bun buffers console output per test file under --parallel and flushes each file atomically so concurrent files do not interleave.",
    });
  });

  test("buildInstallPolicyReport documents HTML static console echo", async () => {
    const dir = testTempDir("bun-install-html-console-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    const report = await buildInstallPolicyReport(dir);

    expect(report.runtimeCapabilities.htmlStaticConsoleEcho).toEqual({
      status: "available",
      command: "bun ./index.html --console",
      appliesTo: "Bun HTML static dev server",
      flag: "--console",
      streams: ["console.log", "console.error"],
      transport: "HMR WebSocket",
      docsUrl:
        "https://bun.com/docs/bundler/html-static#echo-console-logs-from-browser-to-terminal",
      agentUse: "browser logs visible in the terminal that started the dev server",
    });
  });

  test("buildInstallPolicyReport audits runtime environment defaults", async () => {
    const dir = testTempDir("bun-install-runtime-env-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    await withEnv(
      {
        BUN_FEATURE_FLAG_NO_ORPHANS: undefined,
        BUN_INSTALL_GLOBAL_STORE: undefined,
        BUN_FEATURE_FLAG_DISABLE_BUN_JSX: undefined,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: undefined,
        BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT: undefined,
      },
      async () => {
        const report = await buildInstallPolicyReport(dir);
        expect(report.ok).toBe(true);
        expect(report.runtimeEnvironment.noOrphans).toMatchObject({
          status: process.platform === "win32" ? "inactive" : "active",
          env: "BUN_FEATURE_FLAG_NO_ORPHANS",
          value: process.platform === "win32" ? null : "1",
          parentValue: null,
          source: "src/lib/bun-spawn-env.ts",
        });
        expect(report.runtimeEnvironment.globalStore).toMatchObject({
          status: "default",
          env: "BUN_INSTALL_GLOBAL_STORE",
          value: null,
          bunfigValue: null,
          documented: "docs/references/bun-runtime-scaffold.md",
        });
        expect(report.runtimeEnvironment.jsxDisable).toMatchObject({
          status: "enabled",
          env: "BUN_FEATURE_FLAG_DISABLE_BUN_JSX",
          value: null,
        });
        expect(report.runtimeEnvironment.transpilerCache.status).toBe("snapshot-only");
        expect(report.runtimeEnvironment.experimentalHttp2Client.status).toBe("advisor-only");
        expect(report.runtimeEnvironmentAdvisories).toContain(
          "BUN_RUNTIME_TRANSPILER_CACHE_PATH is snapshot-only, not policy-audited"
        );
        expect(report.runtimeEnvironmentAdvisories).toContain(
          "BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT is advisor-only until adopted"
        );
      }
    );
  });

  test("buildInstallPolicyReport audits runtime environment overrides", async () => {
    const dir = testTempDir("bun-install-runtime-env-overrides-");
    writeText(
      join(dir, "bunfig.toml"),
      SECURE_BUNFIG.replace("[install.cache]", "globalStore = true\n\n[install.cache]")
    );
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    await withEnv(
      {
        BUN_FEATURE_FLAG_NO_ORPHANS: "0",
        BUN_INSTALL_GLOBAL_STORE: "1",
        BUN_FEATURE_FLAG_DISABLE_BUN_JSX: "1",
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "/tmp/bun-transpiler-cache",
        BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT: "1",
      },
      async () => {
        const report = await buildInstallPolicyReport(dir);
        expect(report.runtimeEnvironment.noOrphans.parentValue).toBe("0");
        expect(report.runtimeEnvironment.noOrphans.value).toBe(
          process.platform === "win32" ? "0" : "1"
        );
        expect(report.runtimeEnvironment.globalStore).toMatchObject({
          status: "configured",
          value: "1",
          bunfigValue: true,
        });
        expect(report.runtimeEnvironment.jsxDisable).toMatchObject({
          status: "disabled",
          value: "1",
        });
        expect(report.runtimeEnvironment.transpilerCache).toMatchObject({
          status: "configured",
          value: "/tmp/bun-transpiler-cache",
        });
        expect(report.runtimeEnvironment.experimentalHttp2Client).toMatchObject({
          status: "enabled",
          value: "1",
          source: "src/lib/upgrade-advisor.ts",
        });
        expect(report.runtimeEnvironmentAdvisories).toEqual([]);
      }
    );
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
