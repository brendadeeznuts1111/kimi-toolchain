import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  buildRoleTabAgentStartArgs,
  grokRoleTabCliSequence,
  parseGrokRoleTabCommand,
  planGrokRoleTabAgent,
  tabCommandStrategy,
  tokenizeShellCommand,
} from "../src/lib/herdr-role-tab.ts";
import type { HerdrProjectConfig } from "../src/lib/herdr-project-config.ts";

const V2_TEST_COMMAND = "grok --role test-agent --cwd . -- bun run scripts/test-agent.ts --watch";

function baseConfig(overrides: Partial<HerdrProjectConfig> = {}): HerdrProjectConfig {
  return {
    schemaVersion: 2,
    enabled: true,
    workspaceLabel: "demo",
    primaryAgent: "kimi",
    secondaryAgents: ["codex"],
    shellPane: true,
    shellSplit: "right",
    bootstrap: [],
    session: "",
    agentsTab: null,
    tabs: [],
    sourcePath: ".dx/herdr.toml",
    projectPath: "/tmp/demo",
    ...overrides,
  };
}

function loadDxConfigV2TestCommand(): string {
  const templatePath = join(
    import.meta.dir,
    "../../dx-config/config/dx/templates/herdr.project.toml"
  );
  try {
    const raw = readFileSync(templatePath, "utf8");
    const match = raw.match(/label = "test"\ncommand = "([^"]+)"/);
    if (match?.[1]) return match[1];
  } catch {
    // dx-config sibling repo optional in CI — fall back to constant
  }
  return V2_TEST_COMMAND;
}

describe("herdr-role-tab", () => {
  test("parseGrokRoleTabCommand parses scaffold v2 test tab", () => {
    const command = loadDxConfigV2TestCommand();
    const parsed = parseGrokRoleTabCommand(command);
    expect(parsed).not.toBeNull();
    expect(parsed?.role).toBe("test-agent");
    expect(parsed?.cwd).toBe(".");
    expect(parsed?.payload).toBe("bun run scripts/test-agent.ts --watch");
    expect(parsed?.argv[0]).toBe("grok");
    expect(tabCommandStrategy(command)).toBe("grok_role_agent");
  });

  test("parseGrokRoleTabCommand rejects plain bun commands", () => {
    expect(parseGrokRoleTabCommand("bun run check:fast")).toBeNull();
    expect(tabCommandStrategy("bun run dev")).toBe("pane_run");
  });

  test("tokenizeShellCommand respects quoted segments", () => {
    expect(tokenizeShellCommand(`echo "hello world"`)).toEqual(["echo", "hello world"]);
  });

  test("planGrokRoleTabAgent builds rename and report-agent metadata", () => {
    const config = baseConfig();
    const plan = planGrokRoleTabAgent(config, V2_TEST_COMMAND, { tabLabel: "test" });
    expect(plan).not.toBeNull();
    expect(plan?.agent).toBe("grok");
    expect(plan?.role).toBe("test-agent");
    expect(plan?.cwd).toBe("/tmp/demo");
    expect(plan?.renameTo).toBe("test-agent");
    expect(plan?.reportAgent?.customStatus).toBe("test");
    expect(plan?.argv).toContain("--role");
    expect(plan?.argv).toContain("test-agent");
  });

  test("buildRoleTabAgentStartArgs uses agent start with tab target", () => {
    const config = baseConfig();
    const plan = planGrokRoleTabAgent(config, V2_TEST_COMMAND, { tabLabel: "test" });
    expect(plan).not.toBeNull();
    const args = buildRoleTabAgentStartArgs(config, "wB", plan!, { tabId: "wB:t9" });
    expect(args).toContain("agent");
    expect(args).toContain("start");
    expect(args).toContain("grok");
    expect(args).toContain("--tab");
    expect(args).toContain("wB:t9");
    expect(args).toContain("--workspace");
    expect(args).toContain("wB");
    expect(args).toContain("--");
    expect(args.indexOf("--")).toBeLessThan(args.indexOf("--role"));
  });

  test("grokRoleTabCliSequence orders agent start, rename, and report-agent", () => {
    const config = baseConfig();
    const sequence = grokRoleTabCliSequence(config, "wB", V2_TEST_COMMAND, {
      tabId: "wB:t1J",
      paneId: "wB:p24",
      tabLabel: "test",
    });
    expect(sequence).not.toBeNull();
    expect(sequence!.start).toEqual(
      buildRoleTabAgentStartArgs(
        config,
        "wB",
        planGrokRoleTabAgent(config, V2_TEST_COMMAND, { tabLabel: "test" })!,
        { tabId: "wB:t1J", paneId: "wB:p24" }
      )
    );
    expect(sequence!.rename).toEqual(["agent", "rename", "wB:p24", "test-agent"]);
    expect(sequence!.reportAgent).toEqual([
      "pane",
      "report-agent",
      "wB:p24",
      "--source",
      "kimi-toolchain:herdr-project",
      "--agent",
      "test-agent",
      "--state",
      "working",
      "--custom-status",
      "test",
    ]);
  });
});
