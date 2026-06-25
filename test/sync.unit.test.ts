import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import { computeSyncHashes } from "../src/lib/desktop-sync.ts";
import { sha256File } from "../src/lib/utils.ts";

const REPO_ROOT = import.meta.dir + "/..";

describe("desktop-sync hashes", () => {
  test("computeSyncHashes includes all sync-managed asset classes", async () => {
    const hashes = await computeSyncHashes(REPO_ROOT);
    expect(hashes["tools/kimi-doctor.ts"]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes["lib/utils.ts"]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes["canvases/benchmark.manifest.ts"]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes["gates/registry.ts"]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes["harness/html-reporter.ts"]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes["scripts/lint-banned-terms.ts"]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes["kimi-hooks/log-tool-failure.ts"]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes["templates/scaffold/dx.config.toml"]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes["templates/scaffold/code-references.md"]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes["AGENTS.md"]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes["CODE_REFERENCES.md"]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes["docs/references/testing-execution.md"]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes["docs/handoff-rules.md"]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes["agents-skill/SKILL.md"]).toMatch(/^[a-f0-9]{64}$/);
    expect(hashes["kimi-skill/SKILL.md"]).toMatch(/^[a-f0-9]{64}$/);
  });

  test("computeSyncHashes is stable for unchanged files", async () => {
    const a = await computeSyncHashes(REPO_ROOT);
    const b = await computeSyncHashes(REPO_ROOT);
    expect(a).toEqual(b);
  });

  test("hash matches sha256File for a known tool", async () => {
    const hashes = await computeSyncHashes(REPO_ROOT);
    const path = join(REPO_ROOT, "src/lib/r-score.ts");
    expect(existsSync(path)).toBe(true);
    expect(hashes["lib/r-score.ts"]).toBe(await sha256File(path));
  });
});
