import { describe, expect, test } from "bun:test";
import { readSecretFromEnv, secretEnvCandidates, secretEnvKey } from "../src/lib/secrets-env.ts";
import { SecretKeys } from "../src/lib/secrets-constants.ts";

describe("secrets-env", () => {
  test("secretEnvKey derives canonical env var name", () => {
    expect(secretEnvKey("com.herdr.ci", "github-token")).toBe("COM_HERDR_CI_GITHUB_TOKEN");
  });

  test("secretEnvCandidates includes aliases for known secrets", () => {
    const candidates = secretEnvCandidates(
      SecretKeys.CLOUDFLARE_API_TOKEN.service,
      SecretKeys.CLOUDFLARE_API_TOKEN.name
    );
    expect(candidates).toContain("CLOUDFLARE_API_TOKEN");
  });

  test("readSecretFromEnv resolves canonical and alias keys", () => {
    expect(
      readSecretFromEnv("com.herdr.ci", "github-token", {
        COM_HERDR_CI_GITHUB_TOKEN: "from-canonical",
      })
    ).toBe("from-canonical");

    expect(
      readSecretFromEnv(SecretKeys.GITHUB_TOKEN.service, SecretKeys.GITHUB_TOKEN.name, {
        GH_TOKEN: "from-alias",
      })
    ).toBe("from-alias");
  });

  test("readSecretFromEnv returns null when unset", () => {
    expect(readSecretFromEnv("com.herdr.ci", "github-token", {})).toBeNull();
  });
});
