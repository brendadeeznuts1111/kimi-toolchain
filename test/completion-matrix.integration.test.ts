import { describe, test, expect } from "bun:test";
import { pathExists, readText } from "../src/lib/bun-io.ts";

const ROOT = `${import.meta.dir}/..`;
const COMPLETIONS_DIR = `${ROOT}/completions`;
const JSON_PATH = `${COMPLETIONS_DIR}/bun-cli.json`;
const MATRIX_PATH = `${COMPLETIONS_DIR}/COMPLETION_MATRIX.md`;
const DYNAMIC_PATH = `${COMPLETIONS_DIR}/DYNAMIC_SOURCES.json`;

async function runScript(
  script: string
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", script], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  const stdout = await Bun.readableStreamToText(proc.stdout);
  const stderr = await Bun.readableStreamToText(proc.stderr);
  return { exit, stdout, stderr };
}

describe("completion-matrix integration", () => {
  test("matrix and dynamic sources are generated from bun-cli.json", async () => {
    const gen = await runScript("completions:generate");
    expect(gen.exit).toBe(0);

    const matrix = await runScript("completions:matrix");
    expect(matrix.exit).toBe(0);

    expect(pathExists(MATRIX_PATH)).toBe(true);
    expect(pathExists(DYNAMIC_PATH)).toBe(true);

    const md = readText(MATRIX_PATH);
    expect(md).toContain("# Bun CLI Completion Behavior Matrix");
    expect(md).toContain("## Top-level commands");
    expect(md).toContain("## `bun pm` subcommands");
    expect(md).toMatch(/hash `[a-f0-9]{12}`/);

    const dynamic = JSON.parse(readText(DYNAMIC_PATH));
    expect(dynamic).toMatchSnapshot({
      bunVersion: expect.any(String),
      jsonHash: expect.any(String),
      generatedAt: expect.any(String),
    });
  });

  test("bun-cli.json command list is stable", async () => {
    await runScript("completions:generate");
    const data = JSON.parse(readText(JSON_PATH));
    expect(Object.keys(data.commands).sort()).toMatchSnapshot();
  });

  test("global flag names are stable", async () => {
    await runScript("completions:generate");
    const data = JSON.parse(readText(JSON_PATH));
    const names = data.globalFlags.map((f: { name: string }) => f.name).sort();
    expect(names).toMatchSnapshot();
  });
});
