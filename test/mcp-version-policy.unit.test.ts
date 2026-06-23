import { describe, expect, test } from "bun:test";
import { join } from "path";
import { writeText } from "../src/lib/bun-io.ts";
import {
  BUN_INSTALL_ENGINES_BUN_HARDENED,
  BUN_INSTALL_POLICY_MIN_BUN,
  BUN_SEMVER_DOC_URL,
} from "../src/lib/bun-install-config.ts";
import { buildMcpVersionPolicyReport } from "../src/lib/mcp-version-policy.ts";
import { BUN_DOCS_MCP_WORKFLOW } from "../src/lib/mcp-endpoints-metadata.ts";
import { testTempDir, withEnv, CLEAN_INSTALL_AUDIT_ENV } from "./helpers.ts";

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
globalStore = true
globalDir = "~/.bun/install/global"
globalBinDir = "~/.bun/bin"
minimumReleaseAge = 259200
minimumReleaseAgeExcludes = ["@types/bun", "@types/node", "typescript"]

[install.cache]
disable = false
disableManifest = false
`;

describe("mcp-version-policy", () => {
  test("buildMcpVersionPolicyReport returns semver doc and policy rows", async () => {
    const dir = testTempDir("mcp-version-policy-");
    writeText(join(dir, "bunfig.toml"), SECURE_BUNFIG);
    writeText(
      join(dir, "package.json"),
      JSON.stringify(
        {
          name: "demo",
          version: "1.0.0",
          packageManager: `bun@${BUN_INSTALL_POLICY_MIN_BUN}`,
          engines: { bun: BUN_INSTALL_ENGINES_BUN_HARDENED },
          trustedDependencies: [],
        },
        null,
        2
      )
    );

    await withEnv(CLEAN_INSTALL_AUDIT_ENV, async () => {
      const report = await buildMcpVersionPolicyReport(dir);
      expect(report.semverDocUrl).toBe(BUN_SEMVER_DOC_URL);
      expect(report.policy.runtimeSatisfiesEngines).toBe(true);
      expect(report.packageJsonPolicy.find((r) => r.key === "engines.bun")?.status).toBe("ok");
      expect(report.packageJsonPolicy.find((r) => r.key === "packageManager")?.status).toBe("ok");
    });
  });

  test("BUN_DOCS_MCP_WORKFLOW documents semver discovery paths", () => {
    expect(BUN_DOCS_MCP_WORKFLOW.semverDocPath).toBe("runtime/semver.mdx");
    expect(BUN_DOCS_MCP_WORKFLOW.semverSearchQueries[0]).toContain("semver.satisfies");
  });
});
