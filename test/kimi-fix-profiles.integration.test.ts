import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FINISH_WORK_CONFIG_TEMPLATE,
  FINISH_WORK_HERDR_TEMPLATE,
  FINISH_WORK_TEMPLATE,
  REVIEWER_PANE_TEMPLATE,
  renderDxConfig,
} from "../src/lib/scaffold-profiles.ts";
import { injectMissingScripts } from "../src/lib/scaffold-quality.ts";
import { homeDir } from "../src/lib/paths.ts";

describe("kimi-fix-profiles profile artifacts", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `kimi-fix-profile-${Bun.randomUUIDv7()}`);
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "profile-demo", version: "0.0.0", scripts: {} }, null, 2)
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test("app profile dx.config has no broken toolchain-only references", async () => {
    const content = renderDxConfig("app", "profile-demo", homeDir());
    await Bun.write(join(projectRoot, "dx.config.toml"), content);
    await injectMissingScripts(projectRoot, true, () => {}, "app");

    const dxConfig = await Bun.file(join(projectRoot, "dx.config.toml")).text();
    expect(dxConfig).toContain("dx setup");
    expect(dxConfig).not.toContain("[sync]");
    expect(dxConfig).not.toContain("[github.ci.local]");
    expect(dxConfig).not.toContain("[finishWork]");
  });

  test("toolchain profile artifacts match kimi-fix output shape", async () => {
    await Bun.write(
      join(projectRoot, "dx.config.toml"),
      renderDxConfig("toolchain", "profile-demo", homeDir())
    );
    mkdirSync(join(projectRoot, "scripts"), { recursive: true });
    await Bun.write(
      join(projectRoot, "scripts", "finish-work-config.ts"),
      FINISH_WORK_CONFIG_TEMPLATE
    );
    await Bun.write(
      join(projectRoot, "scripts", "finish-work-herdr.ts"),
      FINISH_WORK_HERDR_TEMPLATE
    );
    await Bun.write(join(projectRoot, "scripts", "finish-work.ts"), FINISH_WORK_TEMPLATE);
    await Bun.write(join(projectRoot, "scripts", "reviewer-pane.ts"), REVIEWER_PANE_TEMPLATE);
    await injectMissingScripts(projectRoot, false, () => {}, "toolchain");

    const dxConfig = await Bun.file(join(projectRoot, "dx.config.toml")).text();
    expect(dxConfig).toContain("[finishWork]");
    expect(dxConfig).toContain("[herdr]");
    expect(existsSync(join(projectRoot, "scripts/finish-work.ts"))).toBe(true);
    expect(existsSync(join(projectRoot, "scripts/reviewer-pane.ts"))).toBe(true);
    expect(dxConfig).toContain("single source of truth");

    const pkg = (await Bun.file(join(projectRoot, "package.json")).json()) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["finish-work"]).toBe("bun run scripts/finish-work.ts");
  });
});
