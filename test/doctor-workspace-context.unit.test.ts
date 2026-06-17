import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { appendEffectGatesSnapshot, buildEffectGatesReport } from "../src/lib/effect-gates.ts";
import { testTempDir } from "./helpers.ts";
import {
  buildWorkspaceContextReport,
  writeWorkspaceContextJsonFile,
  workspaceContextJsonPayload,
} from "../src/lib/doctor-workspace-context.ts";
import { extractHerdrProjectSection } from "../src/lib/herdr-project-config.ts";

describe("doctor-workspace-context", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = testTempDir("doctor-workspace-context-");
    makeDir(projectRoot, { recursive: true });
  });

  afterEach(() => {
    removePath(projectRoot, { recursive: true, force: true });
  });

  test("buildWorkspaceContextReport includes git, effect-gates, and next steps", async () => {
    writeText(
      join(projectRoot, "dx.config.toml"),
      `[agents]
iterate = "bun run check:fast"
handoff = ["bun run sync && bun run sync:verify"]
`
    );
    Bun.spawnSync(["git", "init"], { cwd: projectRoot, stdout: "ignore", stderr: "ignore" });
    Bun.spawnSync(["git", "commit", "--allow-empty", "-m", "init"], {
      cwd: projectRoot,
      stdout: "ignore",
      stderr: "ignore",
      env: {
        ...Bun.env,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "t@test",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "t@test",
      },
    });

    const report = await buildEffectGatesReport({ projectRoot, tool: "test" });
    await appendEffectGatesSnapshot(projectRoot, report);

    const brief = await buildWorkspaceContextReport({ projectRoot, brief: true });

    expect(brief.schemaVersion).toBe(1);
    expect(brief.mode).toBe("workspace-context");
    expect(brief.markdown).toContain("# Workspace context:");
    expect(brief.markdown).toContain("## Effect gates");
    expect(brief.nextSteps).toContain("bun run check:fast");
    expect(brief.effectGates?.tool).toBe("test");
    expect(brief.git.isRepo).toBe(true);

    const jsonPath = writeWorkspaceContextJsonFile(brief);
    const payload = workspaceContextJsonPayload(brief);
    expect(jsonPath).toContain("workspace-context.json");
    expect("markdown" in payload).toBe(false);
    expect(payload.project).toBe(brief.project);
  });

  test("extractHerdrProjectSection parses agentsTab pane context", () => {
    const config = extractHerdrProjectSection(
      {
        herdr: {
          enabled: true,
          agentsTab: {
            label: "agents",
            panes: [
              {
                role: "primary",
                agent: "kimi",
                context: "kimi-doctor --workspace-context --brief",
              },
              { role: "shell", split: "right" },
            ],
          },
        },
      },
      "dx.config.toml"
    );

    expect(config?.agentsTab?.panes[0]?.context).toBe("kimi-doctor --workspace-context --brief");
  });
});
