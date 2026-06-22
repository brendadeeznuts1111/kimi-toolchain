import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import {
  cmdSecretsList,
  cmdSecretsStorage,
  cmdSecretsGate,
  cmdSecretsDoctor,
} from "../src/lib/secrets-cli.ts";
import { writeText } from "./helpers.ts";

describe("secrets-cli", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "secrets-cli-"));
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

  test("cmdSecretsList exits 0 and reports policy entries", async () => {
    const code = await cmdSecretsList({ projectRoot: tempRoot, json: true });
    expect(code).toBe(0);
  });

  test("cmdSecretsStorage reports backend", async () => {
    const code = await cmdSecretsStorage({ projectRoot: tempRoot, json: true });
    expect(code).toBe(0);
  });

  test("cmdSecretsGate passes with env-fallback opt-in policy", async () => {
    const code = await cmdSecretsGate({ projectRoot: tempRoot, json: true });
    expect(code).toBe(0);
  });

  test("cmdSecretsDoctor returns health checks", async () => {
    const code = await cmdSecretsDoctor({ projectRoot: tempRoot, json: true });
    expect(code).toBe(0);
  });
});
