import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { auditSecretsStorage } from "../src/lib/secrets-manager.ts";
import { writeText } from "./helpers.ts";

describe("secrets-probe", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "secrets-probe-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("auditSecretsStorage warns on env-fallback with secure-tier secrets", async () => {
    writeText(
      join(tempRoot, "secrets-policy.json5"),
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

    const checks = await auditSecretsStorage(tempRoot, {
      detectBackend: async () => "env-fallback",
    });

    const backend = checks.find((c) => c.name === "secrets:storage-backend");
    expect(backend?.status).toBe("warn");

    const mismatch = checks.find((c) => c.name === "secrets:tier-mismatch");
    expect(mismatch?.status).toBe("warn");
    expect(mismatch?.message).toContain("1 secret(s)");
  });

  test("auditSecretsStorage ok when env-fallback secrets are registered", async () => {
    writeText(
      join(tempRoot, "secrets-policy.json5"),
      JSON.stringify({
        $schema: "v1",
        "com.herdr.ci": {
          "github-token": {
            allowedConsumers: ["cli-tool"],
            storageTier: "env-fallback",
            rotationDays: 1,
            lastRotated: null,
            version: 1,
          },
        },
      })
    );

    const checks = await auditSecretsStorage(tempRoot, {
      detectBackend: async () => "env-fallback",
    });

    const mismatch = checks.find((c) => c.name === "secrets:tier-mismatch");
    expect(mismatch?.status).toBe("ok");
    expect(mismatch?.message).toContain("1 env-fallback tier");
  });
});
