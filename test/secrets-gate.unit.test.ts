import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join, dirname } from "path";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import {
  runSecretsStorageGate,
  SECRETS_STORAGE_TIER_MISMATCH_TAXONOMY,
} from "../src/lib/secrets-manager.ts";
import { SECRETS_POLICY_FILE } from "../src/lib/secrets-constants.ts";
import { writeText } from "./helpers.ts";

describe("secrets-gate", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "secrets-gate-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("passes on secure backend", async () => {
    writeText(
      join(tempRoot, SECRETS_POLICY_FILE),
      JSON.stringify({
        $schema: "v1",
        "com.herdr.dashboard": {
          "jwt-secret": {
            allowedConsumers: ["identity-service"],
            rotationDays: 30,
            lastRotated: null,
            version: 1,
          },
        },
      })
    );

    const result = await runSecretsStorageGate(tempRoot, {
      detectBackend: async () => "keychain",
    });
    expect(result.ok).toBe(true);
  });

  test("fails when env-fallback backend has secure-tier secrets", async () => {
    const policyPath = join(tempRoot, SECRETS_POLICY_FILE);
    mkdirSync(dirname(policyPath), { recursive: true });
    writeText(
      policyPath,
      JSON.stringify({
        $schema: "v1",
        "com.herdr.dashboard": {
          "jwt-secret": {
            allowedConsumers: ["identity-service"],
            rotationDays: 30,
            lastRotated: null,
            version: 1,
          },
        },
      })
    );

    const result = await runSecretsStorageGate(tempRoot, {
      detectBackend: async () => "env-fallback",
    });
    expect(result.ok).toBe(false);
    expect(result.taxonomyId).toBe(SECRETS_STORAGE_TIER_MISMATCH_TAXONOMY);
    expect(result.insecureSecretCount).toBe(1);
  });
});
