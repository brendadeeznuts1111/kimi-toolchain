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
  extractBunfigScopeRegistries,
  findFrozenLockfileScopeRegistryFallbacks,
  formatInstallCliWorkflow,
  formatInstallPropertyReferenceTable,
  auditBunLinkHealth,
  auditBunPmCliHealth,
  auditRuntimeCapabilitiesHealth,
  auditWorkspaceFilterHealth,
  BUN_CATALOG_PROTOCOL_REFERENCES,
  BUN_PM_CLI_SECTION_DOC_URLS,
  BUN_PM_CLI_SECTIONS,
  BUN_PM_PKG_NOTATION_EXAMPLES,
  BUN_PM_PKG_OPERATIONS,
  evaluateBunInstallProbeHandoffCondition,
  BUN_WORKSPACE_PROTOCOL_PUBLISH_RULES,
  WORKSPACE_FILTER_PROBE_MARKER,
  formatInstallPolicyReport,
  RUNTIME_CAPABILITY_INVENTORY_KEYS,
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
    expect(workspaces?.notes).toContain("negative patterns");
    expect(rootLink?.hardenedDefault).toBe(BUN_WORKSPACE_ROOT_CONSUMER_LINK);
    expect(BUN_INSTALL_CLI.installFilter).toContain("--filter");
    expect(BUN_INSTALL_CLI.installFilterExclude).toContain("!pkg-c");
    expect(BUN_WORKSPACE_PROTOCOL_PUBLISH_RULES.map((row) => row.protocol)).toEqual([
      "workspace:*",
      "workspace:^",
      "workspace:~",
      "workspace:1.0.2",
    ]);
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
    expect(BUN_INSTALL_CLI.runFilter).toContain("--filter");
    expect(BUN_INSTALL_CLI.runWorkspaces).toContain("--workspaces");
    expect(BUN_INSTALL_CLI.pmHash).toBe("bun pm hash");
    expect(formatInstallCliWorkflow().some((l) => l.includes("Workspace filter"))).toBe(true);
    expect(formatInstallCliWorkflow().some((l) => l.includes("bun pm:"))).toBe(true);
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
        expect(lines.some((l) => l.includes("runtimeRegressionFixes: tracked"))).toBe(true);
        expect(lines.some((l) => l.includes("timerIdleStart: node-compatible"))).toBe(true);
        expect(lines.some((l) => l.includes("parallelConsole: buffered"))).toBe(true);
        expect(lines.some((l) => l.includes("runtimeApiDocs: available"))).toBe(true);
        expect(lines.some((l) => l.includes("cpuProfMarkdown: active"))).toBe(true);
        expect(lines.some((l) => l.includes("publicBenchmarks: available"))).toBe(true);
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
      publishCommand: "bun publish",
      lifecycleScripts: ["prepack", "prepare", "prepublishOnly"],
      packageJsonBehavior: "re-read after lifecycle scripts",
      notes:
        "Bun re-reads package.json after pack/publish lifecycle scripts so tarball filename, packed metadata, and registry publish fields reflect prepublishOnly/prepack/prepare mutations (not stale pre-script name/version).",
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

  describe("package-manager-fixes", () => {
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
        "install-security-scanner-ipc",
        "install-proxy-304-hang",
        "install-isolated-peer-warm-cache",
        "npmrc-auth-hostname-match",
        "install-scanner-error-visibility",
        "update-interactive-select-all",
        "pack-publish-lifecycle-manifest",
        "lockfile-binary-broken-pipe",
      ]);
      expect(byId.get("install-security-scanner-ipc")?.expected).toContain("IPC pipe");
      expect(byId.get("install-proxy-304-hang")?.regression).toContain("304");
      expect(byId.get("update-interactive-select-all")?.regression).toContain("select all");
      expect(byId.get("pack-publish-lifecycle-manifest")?.expected).toContain("post-lifecycle");
      expect(byId.get("update-interactive-latest-toggle")?.command).toBe(
        BUN_INSTALL_CLI.updateInteractive
      );
      expect(byId.get("install-yarn-workspace-lockfile")?.command).toBe("bun install --yarn");
      expect(byId.get("install-yarn-workspace-lockfile")?.regression).toContain("workspace:*");
      expect(byId.get("frozen-lockfile-scope-registry")?.command).toBe(
        BUN_INSTALL_CLI.frozenInstall
      );
      expect(byId.get("frozen-lockfile-scope-registry")?.expected).toContain(
        "scope-specific registries"
      );
      expect(byId.get("file-path-stale-lockfile-error")?.expected).toContain("exact missing path");
      expect(byId.get("add-network-metadata-panic")?.regression).toContain(
        "Expected metadata to be set"
      );
    });

    test("buildInstallPolicyReport tracks Bun runtime regression fixes", async () => {
      const dir = testTempDir("bun-install-runtime-fixes-");
      writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
      writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

      const report = await buildInstallPolicyReport(dir);
      const fixes = report.runtimeCapabilities.runtimeRegressionFixes.fixes;
      const byId = new Map(fixes.map((fix) => [fix.id, fix]));

      expect(report.runtimeCapabilities.runtimeRegressionFixes.status).toBe("tracked");
      expect([...byId.keys()]).toEqual([
        "test-diff-empty-string-keys",
        "shell-interpolation-crash",
        "shell-rm-quiet-exit-code",
        "types-s3-content-encoding",
        "run-filter-node-executable",
        "inotify-stale-events-cpu",
        "builtin-proxy-array-crash",
      ]);
      expect(byId.get("test-diff-empty-string-keys")?.regression).toContain('""');
      expect(byId.get("shell-rm-quiet-exit-code")?.expected).toContain("non-zero");
      expect(byId.get("types-s3-content-encoding")?.surface).toContain("S3Options");
      expect(byId.get("run-filter-node-executable")?.command).toContain("--workspaces");
      expect(report.runtimeCapabilities.parallelConsole.notes).toContain("empty-string keys");
    });

    describe("frozen-lockfile-scope-registry", () => {
      test("exposes diagnostic fields for empty scoped registry fallbacks", async () => {
        const dir = testTempDir("bun-install-scoped-registry-fix-");
        writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
        writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

        const report = await buildInstallPolicyReport(dir);
        const fix = report.runtimeCapabilities.packageManagerFixes.fixes.find(
          (row) => row.id === "frozen-lockfile-scope-registry"
        );

        expect(fix).toMatchObject({
          command: BUN_INSTALL_CLI.frozenInstall,
          surface: "scope-specific bunfig registries",
          diagnostic: "findFrozenLockfileScopeRegistryFallbacks",
          lockfileRegistryUrl: '""',
          registrySource: 'bunfig.toml [install.scopes] "@orgname"',
          exampleScope: "@orgname",
        });
        expect(fix?.regression).toContain("empty registry URLs");
        expect(fix?.regression).toContain("default npm registry");
        expect(fix?.expected).toContain("bunfig.toml");
      });

      const scopeRegistryCases: Array<{
        label: string;
        bunfig: string;
        expected: Record<string, string>;
      }> = [
        {
          label: "object scope registry",
          bunfig: `[install.scopes]
"@orgname" = { url = "https://npm.pkg.github.com/" }
`,
          expected: {
            "@orgname": "https://npm.pkg.github.com/",
          },
        },
        {
          label: "string shorthand scope registry",
          bunfig: `[install.scopes]
other = "https://registry.example.test/"
`,
          expected: {
            "@other": "https://registry.example.test/",
          },
        },
      ];

      test.each(scopeRegistryCases)(
        "extractBunfigScopeRegistries reads $label from [install.scopes]",
        ({ bunfig, expected }) => {
          expect(extractBunfigScopeRegistries(bunfig)).toEqual(expected);
        }
      );

      test("reports only scoped packages with empty lockfile registries and matching bunfig registries", () => {
        const bunfig = `[install.scopes]
"@orgname" = { url = "https://npm.pkg.github.com/" }
other = "https://registry.example.test/"
`;
        const bunLock = `{
  "lockfileVersion": 1,
  "packages": {
    "@orgname/package": ["@orgname/package@1.2.3", "", {}, "sha512-demo"],
    "@orgname/filled": ["@orgname/filled@1.2.3", "https://registry.npmjs.org/", {}, "sha512-demo"],
    "@missing/package": ["@missing/package@1.2.3", "", {}, "sha512-demo"],
    "@other/package": ["@other/package@1.2.3", "", {}, "sha512-demo"]
  }
}`;

        expect(findFrozenLockfileScopeRegistryFallbacks(bunLock, bunfig)).toEqual([
          {
            packageName: "@orgname/package",
            scope: "@orgname",
            lockfileRegistryUrl: "",
            bunfigRegistryUrl: "https://npm.pkg.github.com/",
            registrySource: 'bunfig.toml [install.scopes] "@orgname"',
          },
          {
            packageName: "@other/package",
            scope: "@other",
            lockfileRegistryUrl: "",
            bunfigRegistryUrl: "https://registry.example.test/",
            registrySource: 'bunfig.toml [install.scopes] "@other"',
          },
        ]);
      });
    });
  });

  test("buildInstallPolicyReport documents Node-compatible timer _idleStart", async () => {
    const dir = testTempDir("bun-install-timer-idle-start-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(join(dir, "package.json"), JSON.stringify(SECURE_PACKAGE_JSON, null, 2));

    const report = await buildInstallPolicyReport(dir);

    expect(report.runtimeCapabilities.timerIdleStart).toEqual({
      status: "node-compatible",
      property: "_idleStart",
      objects: ["setTimeout", "setInterval"],
      rescheduledBy: ["Timeout.refresh()"],
      timestamp: "monotonic milliseconds",
      compatibility: "Next.js 16 Cache Components",
      notes:
        "Timeout objects returned by setTimeout and setInterval expose Node-compatible _idleStart timestamps; Timeout.refresh updates the timestamp when rescheduled.",
    });
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
        "Bun buffers console output per test file under --parallel and flushes each file atomically so concurrent files do not interleave. expect() diffs and console.log now retain properties with empty-string keys.",
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

  describe("runtimeCapabilities recent Bun additions", () => {
    test("includes markdownTerminalRender", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.markdownTerminalRender).toMatchObject({
        status: "available",
        command: expect.stringContaining("bun ./README.md"),
        docsUrl: expect.stringContaining("docs/runtime/markdown"),
      });
    });

    test("includes wrapAnsi", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      const { wrapAnsi } = report.runtimeCapabilities;
      expect(wrapAnsi).toMatchObject({
        status: "available",
        docsUrl: expect.stringContaining("docs/runtime/utils"),
      });
      expect(wrapAnsi.command).toContain("Bun.wrapAnsi");
      expect(wrapAnsi.command).toContain("long red text that needs wrapping");
    });

    test("includes json5Native", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.json5Native).toMatchObject({
        status: "available",
        command: expect.stringContaining("Bun.JSON5.parse"),
        docsUrl: expect.stringContaining("docs/runtime/json5"),
      });
    });

    test("includes jsonlStreaming", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.jsonlStreaming).toMatchObject({
        status: "available",
        command: expect.stringContaining("Bun.JSONL.parseChunk"),
        docsUrl: expect.stringContaining("docs/runtime/jsonl"),
      });
    });

    test("includes bunx package runner", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.bunx).toMatchObject({
        status: "available",
        command: expect.stringContaining("bunx cowsay"),
        docsUrl: expect.stringContaining("docs/pm/bunx"),
        flags: expect.arrayContaining(["--bun", "--package"]),
        equivalentTo: expect.arrayContaining(["npx"]),
      });
    });

    test("includes webView headless browser automation", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.webView).toMatchObject({
        status: "active",
        command: expect.stringContaining("Bun.WebView"),
        docsUrl: expect.stringContaining("docs/runtime/webview"),
        transport: expect.stringMatching(/^ws:\/\//),
        hmr: false,
      });
    });

    test("includes inProcessCron scheduler", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.inProcessCron).toMatchObject({
        status: "active",
        command: expect.stringContaining("Bun.cron"),
        docsUrl: expect.stringContaining("docs/runtime/cron"),
        hmr: true,
      });
    });

    test("includes bunPublish capability", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.bunPublish).toMatchObject({
        status: "active",
        command: "bun publish --dry-run",
        docsUrl: "https://bun.com/docs/cli/publish",
        streams: ["stdout"],
        hmr: false,
      });
      expect(RUNTIME_CAPABILITY_INVENTORY_KEYS).toContain("bunPublish");
    });

    test("includes workspaceFilter capability", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.workspaceFilter).toMatchObject({
        status: "active",
        installCommand: BUN_INSTALL_CLI.installFilter,
        installFilterMulti: BUN_INSTALL_CLI.installFilterExclude,
        runCommand: BUN_INSTALL_CLI.runFilter,
        runFilterAll: BUN_INSTALL_CLI.runFilterAll,
        workspacesCommand: BUN_INSTALL_CLI.runWorkspaces,
        docsUrl: "https://bun.com/docs/pm/filter",
        filterMatchingDocsUrl: "https://bun.com/docs/pm/filter#matching",
        workspacesDocsUrl: "https://bun.com/docs/pm/workspaces",
        workspacesGuideUrl: "https://bun.com/docs/guides/install/workspaces",
        workspacesGuideMonorepoUrl:
          "https://bun.com/docs/guides/install/workspaces#configuring-a-monorepo-using-workspaces",
        workspacesCatalogsSectionUrl:
          "https://bun.com/docs/pm/workspaces#share-versions-with-catalogs",
        catalogsDocsUrl: "https://bun.com/docs/pm/catalogs#overview",
        globDocsUrl: "https://bun.com/docs/runtime/glob#supported-glob-patterns",
        flags: ["--filter", "--workspaces"],
      });
      expect(report.runtimeCapabilities.workspaceFilter.patterns).toContain("./examples/*");
      expect(report.runtimeCapabilities.workspaceFilter.patterns).toContain("!pkg-c");
      expect(report.runtimeCapabilities.workspaceFilter.parallelFlags).toContain("--parallel");
      expect(report.runtimeCapabilities.workspaceFilter.workspaceProtocols).toHaveLength(4);
      expect(RUNTIME_CAPABILITY_INVENTORY_KEYS).toContain("workspaceFilter");
    });

    test("includes workspaceCatalogs capability", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.workspaceCatalogs).toMatchObject({
        status: "available",
        docsUrl: "https://bun.com/docs/pm/catalogs#overview",
        workspacesSectionUrl: "https://bun.com/docs/pm/workspaces#share-versions-with-catalogs",
        publishBehavior: expect.stringContaining("catalog:"),
      });
      expect(report.runtimeCapabilities.workspaceCatalogs.protocols).toEqual(
        BUN_CATALOG_PROTOCOL_REFERENCES
      );
      expect(RUNTIME_CAPABILITY_INVENTORY_KEYS).toContain("workspaceCatalogs");
    });

    test("includes bunLink capability", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.bunLink).toMatchObject({
        status: "active",
        registerCommand: BUN_INSTALL_CLI.linkRegister,
        consumeCommand: BUN_INSTALL_CLI.linkConsume,
        unlinkCommand: BUN_INSTALL_CLI.linkUnlink,
        versionSpecifier: "link:<pkg>",
        docsUrl: "https://bun.com/docs/pm/cli/link",
      });
      expect(RUNTIME_CAPABILITY_INVENTORY_KEYS).toContain("bunLink");
      const link = await auditBunLinkHealth(REPO_ROOT);
      expect(link.ok).toBe(true);
    });

    test("includes bunPmCli capability", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      const bunPmCli = report.runtimeCapabilities.bunPmCli;
      expect(bunPmCli).toMatchObject({
        status: "active",
        docsUrl: "https://bun.com/docs/pm/cli/pm",
        pkgDocsUrl: "https://bun.com/docs/pm/cli/pm#pkg",
        listAlias: "bun list",
        sections: BUN_PM_CLI_SECTIONS,
        sectionDocs: BUN_PM_CLI_SECTION_DOC_URLS,
        pkgNotationExamples: BUN_PM_PKG_NOTATION_EXAMPLES,
        commands: {
          trust: BUN_INSTALL_CLI.pmTrust,
          trustAll: BUN_INSTALL_CLI.pmTrustAll,
          list: BUN_INSTALL_CLI.pmList,
          listAll: BUN_INSTALL_CLI.pmListAll,
          listTrusted: BUN_INSTALL_CLI.pmListTrusted,
          pack: BUN_INSTALL_CLI.pmPack,
          packQuiet: BUN_INSTALL_CLI.pmPackQuiet,
          packDryRun: BUN_INSTALL_CLI.pmPackDryRun,
          cache: BUN_INSTALL_CLI.pmCache,
          cacheRm: BUN_INSTALL_CLI.pmCacheRm,
          hash: BUN_INSTALL_CLI.pmHash,
          hashString: BUN_INSTALL_CLI.pmHashString,
          hashPrint: BUN_INSTALL_CLI.pmHashPrint,
          bin: BUN_INSTALL_CLI.pmBin,
          binGlobal: BUN_INSTALL_CLI.pmBinGlobal,
          migrate: BUN_INSTALL_CLI.pmMigrate,
          untrusted: BUN_INSTALL_CLI.pmUntrusted,
          defaultTrusted: BUN_INSTALL_CLI.pmDefaultTrusted,
          whoami: BUN_INSTALL_CLI.pmWhoami,
          pkgGet: BUN_INSTALL_CLI.pmPkgGet,
          pkgSet: BUN_INSTALL_CLI.pmPkgSet,
          pkgDelete: BUN_INSTALL_CLI.pmPkgDelete,
          pkgFix: BUN_INSTALL_CLI.pmPkgFix,
          version: BUN_INSTALL_CLI.pmVersion,
        },
      });
      expect(bunPmCli.pkgOperations).toEqual(BUN_PM_PKG_OPERATIONS);
      expect(bunPmCli.subcommands).toEqual(BUN_PM_CLI_SECTIONS.map((section) => section.id));
      expect(bunPmCli.sections.map((section) => section.id)).toEqual([
        "pack",
        "bin",
        "ls",
        "whoami",
        "hash",
        "cache",
        "migrate",
        "untrusted",
        "trust",
        "default-trusted",
        "version",
        "pkg",
      ]);
      const pack = bunPmCli.sections.find((section) => section.id === "pack");
      expect(pack?.flags).toContain("--quiet");
      const version = bunPmCli.sections.find((section) => section.id === "version");
      expect(version?.increments).toContain("from-git");
      expect(RUNTIME_CAPABILITY_INVENTORY_KEYS).toContain("bunPmCli");
    });

    test("auditWorkspaceFilterHealth and auditBunPmCliHealth pass at repo root", async () => {
      const filter = await auditWorkspaceFilterHealth(REPO_ROOT);
      const pm = await auditBunPmCliHealth(REPO_ROOT);
      expect(filter.ok).toBe(true);
      expect(filter.marker).toBe(WORKSPACE_FILTER_PROBE_MARKER);
      expect(pm.ok).toBe(true);
    });

    test("auditRuntimeCapabilitiesHealth runs publish dry-run and registry checks", async () => {
      const health = await auditRuntimeCapabilitiesHealth(REPO_ROOT);
      const dryRun = health.checks.find((check) => check.name === "publish:dry-run");
      const token = health.checks.find((check) => check.name === "publish:registry-token");
      const access = health.checks.find((check) => check.name === "publish:registry-access");
      expect(dryRun?.status).toBe("ok");
      expect(access?.status).toBe("ok");
      expect(token?.status).toMatch(/ok|warn/);
    });

    test("evaluateBunInstallProbeHandoffCondition accepts publish probes", async () => {
      const bunPublish = await evaluateBunInstallProbeHandoffCondition(
        "bun-install:bunPublish",
        REPO_ROOT
      );
      expect(bunPublish.ok).toBe(true);

      const dryRun = await evaluateBunInstallProbeHandoffCondition(
        "bun-install:publish-dry-run",
        REPO_ROOT
      );
      expect(dryRun.ok).toBe(true);
    });

    test("evaluateBunInstallProbeHandoffCondition accepts workspace-filter and bun-pm probes", async () => {
      const workspaceFilter = await evaluateBunInstallProbeHandoffCondition(
        "bun-install:workspace-filter",
        REPO_ROOT
      );
      expect(workspaceFilter.ok).toBe(true);

      const bunPm = await evaluateBunInstallProbeHandoffCondition("bun-install:bun-pm", REPO_ROOT);
      expect(bunPm.ok).toBe(true);

      const catalogs = await evaluateBunInstallProbeHandoffCondition(
        "bun-install:workspace-catalogs",
        REPO_ROOT
      );
      expect(catalogs.ok).toBe(true);

      const bunLink = await evaluateBunInstallProbeHandoffCondition(
        "bun-install:bun-link",
        REPO_ROOT
      );
      expect(bunLink.ok).toBe(true);
    });

    test("includes cpuProfMarkdown profiling output", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      const cap = report.runtimeCapabilities.cpuProfMarkdown;
      expect(cap.status).toBe("active");
      expect(cap.command.includes("--cpu-prof-md")).toBe(true);
      expect(cap.docsUrl).toBe("https://bun.com/docs/project/benchmarking#markdown-output");
      expect(cap.streams).toEqual(["stdout"]);
      expect(cap.hmr).toBe(false);
    });

    test("includes heapProf profiling output", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      const cap = report.runtimeCapabilities.heapProf;
      expect(cap.status).toBe("active");
      expect(cap.command.includes("--heap-prof-md")).toBe(true);
      expect(cap.docsUrl).toBe("https://bun.com/docs/project/benchmarking#markdown-output-2");
    });

    test("includes cgroupAwareParallelism", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(
        report.runtimeCapabilities.cgroupAwareParallelism.command.includes("hardwareConcurrency")
      ).toBe(true);
      expect(report.runtimeCapabilities.cgroupAwareParallelism.status).toBe("active");
    });

    test("includes httpsProxyKeepAlive", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.httpsProxyKeepAlive.command.includes("proxy:")).toBe(true);
      expect(report.runtimeCapabilities.httpsProxyKeepAlive.status).toBe("active");
    });

    test("includes tcpDeferAccept", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.tcpDeferAccept.command.includes("Bun.serve")).toBe(true);
      expect(report.runtimeCapabilities.tcpDeferAccept.status).toBe("active");
    });

    test("includes jscHeapStats", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.jscHeapStats).toMatchObject({
        status: "available",
        module: "bun:jsc",
        methods: ["heapStats"],
        command: expect.stringContaining("heapStats"),
        metrics: expect.arrayContaining(["heapSize", "objectTypeCounts"]),
        nativeHeapEnv: "MIMALLOC_SHOW_STATS=1",
        nativeHeapCommand: "MIMALLOC_SHOW_STATS=1 bun script.js",
        docsUrl: "https://bun.com/docs/project/benchmarking#javascript-heap-stats",
        nativeHeapDocsUrl: "https://bun.com/docs/project/benchmarking#native-heap-stats",
      });
    });

    test("includes measuringTime", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      const { measuringTime } = report.runtimeCapabilities;
      expect(measuringTime).toMatchObject({
        status: "available",
        docsUrl: "https://bun.com/docs/project/benchmarking#measuring-time",
        apis: ["performance.now()", "Bun.nanoseconds()", "performance.timeOrigin"],
      });
      expect(measuringTime.command.includes("Bun.nanoseconds")).toBe(true);
      expect(measuringTime.command.includes("performance.now()")).toBe(true);
    });

    test("includes publicBenchmarks bench repo", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.publicBenchmarks).toMatchObject({
        status: "available",
        repoUrl: "https://github.com/oven-sh/bun/tree/main/bench",
        path: "bench/",
        docsUrl: "https://bun.com/docs/project/benchmarking",
      });
    });

    test("internalOptimizations is informational and excluded from inventory", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.internalOptimizations.informational).toBe(true);
      expect(report.internalOptimizations.runtimeDetected).toBe(true);
      expect(report.internalOptimizations.bunVersion).toBe(Bun.version);
      expect(report.internalOptimizations.bunRevision).toBe(Bun.revision);
      expect(report.internalOptimizations.docs.versionGuide).toBe(
        "https://bun.com/docs/guides/util/version"
      );
      expect(report.internalOptimizations.docs.detectBunGuide).toBe(
        "https://bun.com/docs/guides/util/detect-bun"
      );
      expect(report.internalOptimizations.docs.updateCli).toBe(
        "https://bun.com/docs/pm/cli/update"
      );
      expect(report.internalOptimizations.notes.length).toBeGreaterThan(0);
      expect(RUNTIME_CAPABILITY_INVENTORY_KEYS).not.toContain("internalOptimizations");
      const health = await auditRuntimeCapabilitiesHealth(REPO_ROOT);
      expect(health.capabilityCount).toBe(RUNTIME_CAPABILITY_INVENTORY_KEYS.length);
    });

    test("formatInstallPolicyReport lists internal optimizations for doctor output", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      const lines = formatInstallPolicyReport(report);
      expect(lines.some((line) => line.includes("Internal optimizations (informational"))).toBe(
        true
      );
      expect(lines.some((line) => line.includes("URLPattern"))).toBe(true);
    });

    test("auditRuntimeCapabilitiesHealth passes for toolchain root", async () => {
      const health = await auditRuntimeCapabilitiesHealth(REPO_ROOT);
      expect(health.applicable).toBe(true);
      expect(health.aligned).toBe(true);
      expect(health.capabilityCount).toBe(RUNTIME_CAPABILITY_INVENTORY_KEYS.length);
      expect(health.runtimeApiDocs?.globalsUrl).toBe("https://bun.com/docs/runtime/globals");
    });

    test("evaluateBunInstallProbeHandoffCondition accepts inventory probe", async () => {
      const result = await evaluateBunInstallProbeHandoffCondition(
        "bun-install:capabilities",
        REPO_ROOT
      );
      expect(result.ok).toBe(true);
    });

    test("includes bunImage capability", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.bunImage).toMatchObject({
        status: "available",
        docsUrl: "https://bun.com/docs/runtime/image",
        sourceModule: "src/lib/bun-image.ts",
        dashboardPaths: ["/api/image", "/api/thumbnail", "/api/bun-mark"],
      });
    });

    test("evaluateBunInstallProbeHandoffCondition accepts bun-image probe", async () => {
      const result = await evaluateBunInstallProbeHandoffCondition(
        "bun-install:bun-image",
        REPO_ROOT
      );
      expect(result.ok).toBe(true);
    });

    test("includes runtimeApiDocs", async () => {
      const report = await buildInstallPolicyReport(REPO_ROOT);
      expect(report.runtimeCapabilities.runtimeApiDocs).toMatchObject({
        status: "available",
        globalsUrl: "https://bun.com/docs/runtime/globals",
        bunApisUrl: "https://bun.com/docs/runtime/bun-apis",
        webApisUrl: "https://bun.com/docs/runtime/web-apis",
        apiReferenceUrl: "https://bun.com/reference/bun",
        docsRssUrl: "https://bun.com/rss.xml",
      });
    });
  });
});
