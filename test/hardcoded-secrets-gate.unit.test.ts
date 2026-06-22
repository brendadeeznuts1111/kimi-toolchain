import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  formatHardcodedSecretsGate,
  hardcodedSecretsGate,
  hardcodedSecretsGateDefinition,
  runHardcodedSecretsGate,
} from "../src/gates/hardcoded-secrets.ts";
import { runGatesWithDependencies } from "../src/gates/runner.ts";
import { pathExists } from "../src/lib/bun-io.ts";
import { cleanupPath, testTempDir } from "./helpers.ts";

describe("hardcoded-secrets-gate", () => {
  test("passes when no credential-like literals are present", async () => {
    const dir = testTempDir("hardcoded-secrets-pass-");
    try {
      await Bun.write(join(dir, "src", "clean.ts"), `const PUBLIC_URL = "https://example.com";\n`);
      const result = await hardcodedSecretsGate(dir);
      expect(result.status).toBe("pass");
      expect(result.count).toBe(0);
      expect(result.ok).toBe(true);
    } finally {
      cleanupPath(dir);
    }
  });

  test("fails when a JWT literal is present", async () => {
    const dir = testTempDir("hardcoded-secrets-fail-");
    try {
      await Bun.write(
        join(dir, "src", "leak.ts"),
        `const token = "eyJhbGciOiJIUzI1NiJ.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";\n`
      );
      const result = await hardcodedSecretsGate(dir);
      expect(result.status).toBe("fail");
      expect(result.count).toBeGreaterThan(0);
      expect(result.findings[0]?.type).toBe("jwt-literal");
      expect(formatHardcodedSecretsGate(result)[0]).toContain("fail: hardcoded-secrets");
    } finally {
      cleanupPath(dir);
    }
  });

  test("runGatesWithDependencies saves hardcoded-secrets artifact", async () => {
    const dir = testTempDir("hardcoded-secrets-artifact-");
    try {
      const { results } = await runGatesWithDependencies([hardcodedSecretsGateDefinition], {
        projectRoot: dir,
        saveArtifact: true,
      });
      const result = results[0];
      expect(result?.status).toBe("pass");
      expect(result?.artifactPath).toBeTruthy();
      expect(pathExists(result!.artifactPath!)).toBe(true);
      expect(result!.artifactPath).toContain(join(dir, ".kimi", "artifacts", "hardcoded-secrets"));
    } finally {
      cleanupPath(dir);
    }
  });

  test("runHardcodedSecretsGate uses projectRoot option", async () => {
    const dir = testTempDir("hardcoded-secrets-opts-");
    try {
      await Bun.write(join(dir, "src", "clean.ts"), `const x = 1;\n`);
      const result = await runHardcodedSecretsGate({ projectRoot: dir });
      expect(result.status).toBe("pass");
    } finally {
      cleanupPath(dir);
    }
  });
});
