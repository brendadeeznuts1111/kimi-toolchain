import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { buildSecretsApiResponse } from "../src/lib/secrets-api.ts";
import { writeText } from "./helpers.ts";

describe("secrets-api", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "secrets-api-"));
    writeText(
      join(tempRoot, "secrets-policy.json5"),
      JSON.stringify({
        $schema: "v1",
        "com.herdr.ci": {
          "github-token": {
            allowedConsumers: ["cli-tool"],
            storageTier: "env-fallback",
            rotationDays: 1,
            lastRotated: "2026-06-21",
            version: 1,
          },
        },
      })
    );
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("buildSecretsApiResponse never includes secret values", async () => {
    const payload = await buildSecretsApiResponse(tempRoot);
    const json = JSON.stringify(payload);
    expect(json).not.toContain("ghp_");
    expect(payload.secrets).toHaveLength(1);
    expect(payload.secrets[0]?.name).toBe("github-token");
    expect(payload.storage.backend).toBeDefined();
    expect(payload.methods.get).toBe(typeof Bun.secrets?.get === "function");
  });
});
