import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join, dirname } from "path";
import { lintSecretsRegistry } from "../src/lib/secrets-registry-lint.ts";
import { SECRETS_POLICY_FILE, SECRETS_REGISTRY_DOC } from "../src/lib/secrets-constants.ts";
import { writeText, makeDir, removePath, testTempDir } from "./helpers.ts";

const MINIMAL_REGISTRY = `# Secrets registry

| Constant | Service id | Purpose |
| -------- | ---------- | ------- |
| \`Services.KIMI_TOOLCHAIN\` | \`kimi-toolchain\` | Cloudflare |
| \`Services.CLI\` | \`com.herdr.cli\` | CLI |
| \`Services.DASHBOARD\` | \`com.herdr.dashboard\` | Dashboard |
| \`Services.SECURITY\` | \`com.herdr.security\` | Security |
| \`Services.CI\` | \`com.herdr.ci\` | CI |
`;

describe("secrets-registry-lint", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = testTempDir("secrets-lint-");
    const registryPath = join(tempRoot, SECRETS_REGISTRY_DOC);
    makeDir(dirname(registryPath), { recursive: true });
    writeText(registryPath, MINIMAL_REGISTRY);
  });

  afterEach(() => {
    removePath(tempRoot, { recursive: true, force: true });
  });

  test("passes when repo policy and docs align", async () => {
    const repoRoot = join(import.meta.dir, "..");
    const issues = await lintSecretsRegistry(repoRoot);
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  test("errors when SecretKeys entry missing from policy", async () => {
    writeText(
      join(tempRoot, SECRETS_POLICY_FILE),
      JSON.stringify({
        $schema: "v1",
        "kimi-toolchain": {
          "cloudflare-account-id": {
            allowedConsumers: ["kimi-doctor"],
            rotationDays: 365,
            lastRotated: null,
            version: 1,
          },
        },
      })
    );

    const issues = await lintSecretsRegistry(tempRoot);
    expect(issues.some((i) => i.message.includes("SecretKeys missing policy entry"))).toBe(true);
  });

  test("errors when CI secret lacks env-fallback tier", async () => {
    writeText(
      join(tempRoot, SECRETS_POLICY_FILE),
      JSON.stringify({
        $schema: "v1",
        "com.herdr.ci": {
          "github-token": {
            allowedConsumers: ["cli-tool"],
            rotationDays: 1,
            lastRotated: null,
            version: 1,
          },
        },
      })
    );

    const issues = await lintSecretsRegistry(tempRoot);
    expect(issues.some((i) => i.message.includes('storageTier: "env-fallback"'))).toBe(true);
  });
});
