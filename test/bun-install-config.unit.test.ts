import { describe, expect, test } from "bun:test";
import { join } from "path";
import { writeText } from "../src/lib/bun-io.ts";
import {
  auditBunInstallConfig,
  BUN_GLOBAL_INSTALL_PATHS,
  BUN_INSTALL_DOCS_URL,
  BUN_INSTALL_ENV_VARS,
  SECURE_BUN_INSTALL_POLICY,
} from "../src/lib/bun-install-config.ts";
import { REPO_ROOT, testTempDir, withEnv } from "./helpers.ts";

const SECURE_BUNFIG = `[install]
optional = true
dev = true
peer = true
production = false
saveTextLockfile = true
frozenLockfile = true
dryRun = false
ignoreScripts = false
linker = "isolated"
globalDir = "~/.bun/install/global"
globalBinDir = "~/.bun/bin"
minimumReleaseAge = 259200
minimumReleaseAgeExcludes = ["@types/bun", "@types/node", "typescript"]
`;

describe("bun-install-config", () => {
  test("SECURE_BUN_INSTALL_POLICY matches Bun secure defaults", () => {
    expect(SECURE_BUN_INSTALL_POLICY.frozenLockfile).toBe(true);
    expect(SECURE_BUN_INSTALL_POLICY.linker).toBe("isolated");
    expect(SECURE_BUN_INSTALL_POLICY.minimumReleaseAge).toBe(259_200);
    expect(SECURE_BUN_INSTALL_POLICY.globalDir).toBe(BUN_GLOBAL_INSTALL_PATHS.globalDir);
    expect(SECURE_BUN_INSTALL_POLICY.globalBinDir).toBe(BUN_GLOBAL_INSTALL_PATHS.globalBinDir);
  });

  test("BUN_INSTALL_ENV_VARS documents risky skip flags", () => {
    const risky = BUN_INSTALL_ENV_VARS.filter((row) => row.risky).map((row) => row.name);
    expect(risky).toContain("BUN_CONFIG_SKIP_SAVE_LOCKFILE");
    expect(risky).toContain("BUN_CONFIG_SKIP_LOAD_LOCKFILE");
  });

  test("auditBunInstallConfig warns on risky env overrides", async () => {
    const dir = testTempDir("bun-install-audit-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);

    await withEnv({ BUN_CONFIG_SKIP_SAVE_LOCKFILE: "1" }, async () => {
      const audit = await auditBunInstallConfig(dir);
      expect(audit.ok).toBe(false);
      expect(audit.docsUrl).toBe(BUN_INSTALL_DOCS_URL);
      expect(audit.warnings.some((w) => w.includes("BUN_CONFIG_SKIP_SAVE_LOCKFILE"))).toBe(true);
    });
  });

  test("auditBunInstallConfig warns when frozenLockfile is false", async () => {
    const dir = testTempDir("bun-install-weak-");
    writeText(
      join(dir, "bunfig.toml"),
      SECURE_BUNFIG.replace("frozenLockfile = true", "frozenLockfile = false")
    );

    const audit = await auditBunInstallConfig(dir);
    expect(audit.ok).toBe(false);
    expect(audit.warnings.some((w) => w.includes("frozenLockfile=false"))).toBe(true);
  });

  test("auditBunInstallConfig passes secure toolchain bunfig", async () => {
    const dir = testTempDir("bun-install-ok-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);

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
        expect(audit.bunfigInstall?.globalBinDir).toBe("~/.bun/bin");
      }
    );
  });

  test("auditBunInstallConfig warns when globalBinDir is missing", async () => {
    const dir = testTempDir("bun-install-no-global-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG.replace('globalBinDir = "~/.bun/bin"\n', ""));

    const audit = await auditBunInstallConfig(dir);
    expect(audit.ok).toBe(false);
    expect(audit.warnings.some((w) => w.includes("globalBinDir unset"))).toBe(true);
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
      }
    );
  });
});
