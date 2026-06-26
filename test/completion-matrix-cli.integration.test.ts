import { describe, test, expect } from "bun:test";
import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

const ROOT = `${import.meta.dir}/..`;
const JSON_PATH = `${ROOT}/completions/bun-cli.json`;

async function runScript(
  script: string,
  args: string[] = [],
  cwd: string = ROOT
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const scriptPath = script.startsWith("/") ? script : `${ROOT}/${script}`;
  const proc = Bun.spawn(["bun", "run", scriptPath, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  const stdout = await Bun.readableStreamToText(proc.stdout);
  const stderr = await Bun.readableStreamToText(proc.stderr);
  return { exit, stdout, stderr };
}

async function setupTempWorkspace(): Promise<string> {
  const tmp = `${Bun.env.TMPDIR || "/tmp"}/completion-matrix-cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  makeDir(`${tmp}/completions`, { recursive: true });
  const json = await Bun.file(JSON_PATH).text();
  writeText(`${tmp}/completions/bun-cli.json`, json);
  return tmp;
}

describe("completion-matrix-cli", () => {
  test("default writes md, json, csv, and html", async () => {
    const tmp = await setupTempWorkspace();
    try {
      const result = await runScript("scripts/make-completion-matrix.ts", [], tmp);
      expect(result.exit).toBe(0);
      expect(result.stdout).toContain("Wrote completions/COMPLETION_MATRIX.md");
      expect(result.stdout).toContain("Wrote completions/DYNAMIC_SOURCES.json");
      expect(result.stdout).toContain("Wrote completions/COMPLETION_MATRIX.csv");
      expect(result.stdout).toContain("Wrote completions/COMPLETION_MATRIX.html");

      const md = await Bun.file(`${tmp}/completions/COMPLETION_MATRIX.md`).text();
      expect(md).toContain("# Bun CLI Completion Behavior Matrix");
    } finally {
      removePath(tmp, { recursive: true });
    }
  });

  test("--no-csv --no-html only writes md and json", async () => {
    const tmp = await setupTempWorkspace();
    try {
      const result = await runScript(
        "scripts/make-completion-matrix.ts",
        ["--no-csv", "--no-html"],
        tmp
      );
      expect(result.exit).toBe(0);
      expect(result.stdout).toContain("Wrote completions/COMPLETION_MATRIX.md");
      expect(result.stdout).toContain("Wrote completions/DYNAMIC_SOURCES.json");
      expect(result.stdout).not.toContain("Wrote completions/COMPLETION_MATRIX.csv");
      expect(result.stdout).not.toContain("Wrote completions/COMPLETION_MATRIX.html");
    } finally {
      removePath(tmp, { recursive: true });
    }
  });

  test("--dry-run does not write files", async () => {
    const tmp = await setupTempWorkspace();
    try {
      const before = await Bun.file(`${tmp}/completions/bun-cli.json`).text();
      const result = await runScript("scripts/make-completion-matrix.ts", ["--dry-run"], tmp);
      expect(result.exit).toBe(0);
      expect(result.stdout).toContain("Dry run: would write completions/COMPLETION_MATRIX.md");
      expect(result.stdout).toContain("Dry run: would write completions/COMPLETION_MATRIX.csv");
      expect(result.stdout).toContain("Dry run: would write completions/COMPLETION_MATRIX.html");

      // Only the source JSON should exist
      const after = await Bun.file(`${tmp}/completions/bun-cli.json`).text();
      expect(after).toBe(before);
      const mdExists = await Bun.file(`${tmp}/completions/COMPLETION_MATRIX.md`).exists();
      expect(mdExists).toBe(false);
    } finally {
      removePath(tmp, { recursive: true });
    }
  });

  test("--check passes when artifacts are up to date", async () => {
    const tmp = await setupTempWorkspace();
    try {
      await runScript("scripts/make-completion-matrix.ts", [], tmp);
      const check = await runScript("scripts/make-completion-matrix.ts", ["--check"], tmp);
      expect(check.exit).toBe(0);
      expect(check.stdout).toContain("✅ Check passed");
    } finally {
      removePath(tmp, { recursive: true });
    }
  });

  test("--check fails when matrix is stale", async () => {
    const tmp = await setupTempWorkspace();
    try {
      await runScript("scripts/make-completion-matrix.ts", [], tmp);
      writeText(`${tmp}/completions/COMPLETION_MATRIX.md`, "# stale");
      const check = await runScript("scripts/make-completion-matrix.ts", ["--check"], tmp);
      expect(check.exit).toBe(1);
      expect(check.stdout).toContain("❌ Matrix out of date");
      expect(check.stdout).toContain("❌ Check failed");
    } finally {
      removePath(tmp, { recursive: true });
    }
  });
});
