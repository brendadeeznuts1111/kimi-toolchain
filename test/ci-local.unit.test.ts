import { describe, expect, test } from "bun:test";
import { join, resolve } from "path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const CI_LOCAL = join(REPO_ROOT, "scripts/ci-local.ts");

describe("ci-local", () => {
  test("quality dry-run exposes the unified CI contract", async () => {
    const proc = Bun.spawn(["bun", "run", CI_LOCAL, "--dry-run", "--json", "--job", "quality"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      Bun.readableStreamToText(proc.stdout),
      Bun.readableStreamToText(proc.stderr),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as {
      mergeGate?: string;
      job?: string;
      steps?: Array<{ name?: string; cmd?: string }>;
    };
    expect(parsed.mergeGate).toBe("local-ci");
    expect(parsed.job).toBe("quality");
    expect(parsed.steps?.map((step) => step.name)).toEqual([
      "format:check:ci",
      "lint",
      "typecheck",
      "build:compile",
      "test:coverage:ci",
      "test:smoke",
      "effect-gates",
      "effect-benchmark",
      "effect-benchmark-auto-train",
      "probe-cards",
      "config-status",
    ]);
    expect(parsed.steps?.find((step) => step.name === "build:compile")?.cmd).toBe(
      "bun run build:compile"
    );
  });
});
