import { describe, test, expect } from "bun:test";
import { join } from "path";
import { readText } from "../src/lib/bun-io.ts";
import { repoCanonicalReferencesTomlPath } from "../src/lib/canonical-references-toml.ts";

const ROOT = join(import.meta.dir, "..");

async function runLintExamples(): Promise<{
  exit: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(["bun", "run", "scripts/lint-references-examples.ts"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  const stdout = await Bun.readableStreamToText(proc.stdout);
  const stderr = await Bun.readableStreamToText(proc.stderr);
  return { exit, stdout, stderr };
}

describe("lint-references-examples integration", () => {
  test("passes when all example TOML files are valid", async () => {
    const { exit, stdout } = await runLintExamples();
    expect(exit).toBe(0);
    expect(stdout).toContain("example canonical-references lint OK");
  });

  test("fails when an example TOML has a duplicate id", async () => {
    const path = repoCanonicalReferencesTomlPath(join(ROOT, "examples", "dashboard"));
    const original = readText(path);
    await Bun.write(
      path,
      `${original}\n[[ecosystem]]\nid = "bun"\nname = "Duplicate Bun"\nkind = "runtime"\nhomepage = "https://bun.sh"\ndocs = "https://bun.sh/docs"\npackage = "bun"\nusage = "duplicate"\nminVersion = "1.4.0"\nnoRepo = true\n`
    );
    try {
      const { exit, stderr } = await runLintExamples();
      expect(exit).toBe(1);
      expect(stderr).toContain("duplicate id");
    } finally {
      await Bun.write(path, original);
    }
  });
});
