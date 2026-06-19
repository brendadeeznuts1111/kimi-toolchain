import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "path";
import { applyEffectHealFix } from "../src/lib/effect-heal-fix.ts";
import { DEFAULT_KIMI_MODULES, parseKimiModules } from "../src/lib/scaffold-modules.ts";

describe("effect-heal-fix", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join("/tmp", `effect-heal-fix-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(tmpDir, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("rewrites .then chains to Effect.tryPromise", async () => {
    await writeFile(
      join(tmpDir, "src", "service.ts"),
      `import { Effect } from "effect";
export function load() {
  return fetch("/x").then(r => r.json());
}
`
    );

    const result = await applyEffectHealFix({ projectRoot: tmpDir, dryRun: false });
    expect(result.filesTouched).toBe(1);
    const text = await Bun.file(join(tmpDir, "src", "service.ts")).text();
    expect(text).toContain("Effect.tryPromise");
    expect(text).not.toContain(".then(");
  });

  test("dry-run does not write files", async () => {
    await writeFile(
      join(tmpDir, "src", "service.ts"),
      `export function load() { return fetch("/x").then(r => r.json()); }`
    );
    await applyEffectHealFix({ projectRoot: tmpDir, dryRun: true });
    const text = await Bun.file(join(tmpDir, "src", "service.ts")).text();
    expect(text).toContain(".then(");
  });
});

describe("scaffold-modules", () => {
  test("parseKimiModules defaults to doctor", () => {
    expect(parseKimiModules({})).toEqual(["doctor"]);
    expect(parseKimiModules({ KIMI_MODULES: "image,trace" })).toEqual(["image", "trace"]);
  });

  test("DEFAULT_KIMI_MODULES includes doctor", () => {
    expect(DEFAULT_KIMI_MODULES).toContain("doctor");
  });
});
