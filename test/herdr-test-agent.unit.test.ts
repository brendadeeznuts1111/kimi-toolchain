import { describe, expect, test } from "bun:test";
import {
  parseTestAgentMode,
  testAgentCommand,
  TEST_AGENT_WATCH_DIRS,
  watchPaths,
} from "../src/lib/herdr-test-agent.ts";

describe("herdr-test-agent", () => {
  test("parseTestAgentMode selects watch, check, ci, and once", () => {
    expect(parseTestAgentMode(["--watch"])).toBe("watch");
    expect(parseTestAgentMode(["--check"])).toBe("check");
    expect(parseTestAgentMode(["--ci"])).toBe("ci");
    expect(parseTestAgentMode(["--once"])).toBe("once");
    expect(parseTestAgentMode([])).toBe("once");
  });

  test("parseTestAgentMode prefers ci over watch when both present", () => {
    expect(parseTestAgentMode(["--watch", "--ci"])).toBe("ci");
  });

  test("testAgentCommand maps modes to gate commands", () => {
    expect(testAgentCommand("check").label).toBe("check:fast");
    expect(testAgentCommand("check").cmd).toEqual(["bun", "run", "scripts/check.ts", "--fast"]);
    expect(testAgentCommand("ci").label).toBe("ci:quality");
    expect(testAgentCommand("once").label).toBe("test:fast");
    expect(testAgentCommand("once").cmd[0]).toBe("bun");
    expect(testAgentCommand("once").cmd[1]).toBe("test");
  });

  test("watchPaths includes src, test, and scripts", () => {
    const paths = watchPaths("/repo");
    expect(paths).toHaveLength(TEST_AGENT_WATCH_DIRS.length);
    expect(paths.some((row) => row.endsWith("/repo/src"))).toBe(true);
  });
});
