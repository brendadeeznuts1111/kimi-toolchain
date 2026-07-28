import { describe, expect, test } from "bun:test";
import { join } from "path";
import { getAgentContext } from "../src/lib/dx-config-agents.ts";
import { runSubagent } from "../src/lib/subagent-orchestrator.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("subagent-orchestrator", () => {
  test("AgentContext parses subagents from dx config", () => {
    const doc = {
      agents: {
        firstRead: ["docs/README.md"],
        subagents: {
          linter: {
            toolPath: "scripts/lint.ts",
            args: ["--fix"],
            timeoutMs: 60_000,
            label: "lint",
          },
          doctor: {
            toolPath: "scripts/doctor.ts",
          },
        },
      },
    };
    const ctx = getAgentContext(doc);
    expect(ctx.subagents).toBeDefined();
    expect(ctx.subagents?.linter).toBeDefined();
    expect(ctx.subagents?.linter?.toolPath).toBe("scripts/lint.ts");
    expect(ctx.subagents?.linter?.args).toEqual(["--fix"]);
    expect(ctx.subagents?.linter?.timeoutMs).toBe(60_000);
    expect(ctx.subagents?.linter?.label).toBe("lint");
    expect(ctx.subagents?.doctor?.toolPath).toBe("scripts/doctor.ts");
  });

  test("AgentContext ignores malformed subagent entries", () => {
    const doc = {
      agents: {
        subagents: {
          valid: { toolPath: "scripts/ok.ts" },
          missingTool: { args: ["--help"] },
          notAnObject: "nope",
        },
      },
    };
    const ctx = getAgentContext(doc);
    expect(ctx.subagents?.valid).toBeDefined();
    expect(ctx.subagents?.missingTool).toBeUndefined();
    expect(ctx.subagents?.notAnObject).toBeUndefined();
  });

  test("runSubagent executes a tool and reports ok", async () => {
    const dir = `${REPO_ROOT}/test/fixtures/subagent-flow`;
    await Bun.write(join(dir, "echo-tool.ts"), 'console.log("hello from subagent");\n');
    const result = await runSubagent({
      toolPath: join(dir, "echo-tool.ts"),
      args: [],
      label: "echo-test",
    });
    await Bun.write(join(dir, "echo-tool.ts"), "void 0;\n");
    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe("hello from subagent");
    expect(result.exitCode).toBe(0);
  });

  test("runSubagent reports not-ok on failing tool", async () => {
    const dir = `${REPO_ROOT}/test/fixtures/subagent-flow`;
    await Bun.write(join(dir, "fail-tool.ts"), 'console.error("oops"); process.exit(1);\n');
    const result = await runSubagent({
      toolPath: join(dir, "fail-tool.ts"),
      args: [],
      label: "fail-test",
    });
    await Bun.write(join(dir, "fail-tool.ts"), "void 0;\n");
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  test("runSubagent respects custom timeout", async () => {
    const dir = `${REPO_ROOT}/test/fixtures/subagent-flow`;
    await Bun.write(join(dir, "slow-tool.ts"), 'await Bun.sleep(50); console.log("done");\n');
    const result = await runSubagent({
      toolPath: join(dir, "slow-tool.ts"),
      args: [],
      timeoutMs: 500,
      label: "slow-test",
    });
    await Bun.write(join(dir, "slow-tool.ts"), "void 0;\n");
    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe("done");
  });
});
