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
import { repoRoot } from "../src/lib/globs.ts";

const SECRETS_BIN = join(repoRoot(), "src/bin/kimi-secrets.ts");

async function spawnSecretsCli(
  args: string[],
  cwd: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", SECRETS_BIN, ...args], {
    cwd,
    env: { ...Bun.env, KIMI_QUIET: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

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

  describe("CLI entry point", () => {
    test("storage --json emits backend diagnostics", async () => {
      const { exitCode, stdout } = await spawnSecretsCli(["storage", "--json"], tempRoot);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty("backend");
      expect(parsed).toHaveProperty("securityLevel");
    });

    test("list --json emits policy entries without values", async () => {
      const { exitCode, stdout } = await spawnSecretsCli(["list", "--json"], tempRoot);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed[0]).toHaveProperty("key");
      expect(parsed[0]).toHaveProperty("present");
      expect(parsed[0]).not.toHaveProperty("value");
    });

    test("doctor --json emits health checks", async () => {
      const { exitCode, stdout } = await spawnSecretsCli(["doctor", "--json"], tempRoot);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
    });

    test("gate --json passes with env-fallback opt-in policy", async () => {
      const { exitCode, stdout } = await spawnSecretsCli(["gate", "--json"], tempRoot);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.ok).toBe(true);
    });
  });
});
