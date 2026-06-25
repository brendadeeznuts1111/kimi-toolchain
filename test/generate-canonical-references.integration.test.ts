import { describe, test, expect } from "bun:test";
import { join } from "path";
import { readText } from "../src/lib/bun-io.ts";
import { repoCanonicalReferencesPath } from "../src/lib/canonical-references.ts";

const ROOT = join(import.meta.dir, "..");
const DATA_TS_PATH = join(ROOT, "src/lib/canonical-references-data.ts");
const MANIFEST_PATH = repoCanonicalReferencesPath(ROOT);

async function runGenerate(args: string[] = []): Promise<{
  exit: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(["bun", "run", "scripts/generate-canonical-references.ts", ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  const stdout = await Bun.readableStreamToText(proc.stdout);
  const stderr = await Bun.readableStreamToText(proc.stderr);
  return { exit, stdout, stderr };
}

describe("generate-canonical-references integration", () => {
  test("--check passes when artifacts are fresh", async () => {
    const { exit, stdout } = await runGenerate(["--check"]);
    expect(exit).toBe(0);
    expect(stdout).toContain("canonical-references.toml OK");
    expect(stdout).toContain("canonical-references-data.ts OK");
    expect(stdout).toContain("canonical-references.json OK");
  });

  test("--check fails when data TS is stale", async () => {
    const originalDataTs = readText(DATA_TS_PATH);
    await Bun.write(DATA_TS_PATH, `${originalDataTs}\n// stale-stamp`);
    try {
      const { exit, stderr } = await runGenerate(["--check"]);
      expect(exit).toBe(1);
      expect(stderr).toContain("src/lib/canonical-references-data.ts is stale");
    } finally {
      await Bun.write(DATA_TS_PATH, originalDataTs);
    }
  });

  test("--check fails when JSON manifest is stale", async () => {
    const originalJson = readText(MANIFEST_PATH);
    const json = JSON.parse(originalJson) as { ecosystem?: unknown[] };
    json.ecosystem = [
      ...(json.ecosystem ?? []),
      { id: "stale-trigger", name: "Stale", kind: "docs" },
    ];
    await Bun.write(MANIFEST_PATH, JSON.stringify(json, null, 2));
    try {
      const { exit, stderr } = await runGenerate(["--check"]);
      expect(exit).toBe(1);
      expect(stderr).toContain("canonical-references.json is stale");
    } finally {
      await Bun.write(MANIFEST_PATH, originalJson);
    }
  });

  test("--json produces parseable manifest output", async () => {
    const { exit, stdout, stderr } = await runGenerate(["--json"]);
    expect(exit).toBe(0);
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout) as { schemaVersion?: number; ecosystem?: unknown[] };
    expect(parsed.schemaVersion).toBeGreaterThan(0);
    expect(parsed.ecosystem).toBeDefined();
    expect(parsed.ecosystem?.length).toBeGreaterThan(0);
  });

  test("regenerates stale data TS when run without --check", async () => {
    const originalDataTs = readText(DATA_TS_PATH);
    await Bun.write(DATA_TS_PATH, `${originalDataTs}\n// stale-stamp`);
    try {
      const { exit } = await runGenerate([]);
      expect(exit).toBe(0);
      const regenerated = readText(DATA_TS_PATH);
      expect(regenerated).not.toContain("// stale-stamp");
    } finally {
      await Bun.write(DATA_TS_PATH, originalDataTs);
    }
  });
});
