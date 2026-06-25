import { describe, expect, test } from "bun:test";
import { parseTestAgentMode, testAgentCommand } from "../src/lib/herdr-test-agent.ts";

describe("herdr-test-agent", () => {
  test("parseTestAgentMode selects check, ci, and once", () => {
    expect(parseTestAgentMode(["--check"])).toBe("check");
    expect(parseTestAgentMode(["--ci"])).toBe("ci");
    expect(parseTestAgentMode(["--once"])).toBe("once");
    expect(parseTestAgentMode([])).toBe("once");
  });

  test("parseTestAgentMode prefers ci over once when both present", () => {
    expect(parseTestAgentMode(["--once", "--ci"])).toBe("ci");
  });

  test("testAgentCommand maps modes to gate commands", () => {
    expect(testAgentCommand("check").label).toBe("check:fast");
    expect(testAgentCommand("check").cmd).toEqual(["bun", "run", "scripts/check.ts", "--fast"]);
    expect(testAgentCommand("ci").label).toBe("ci:quality");
    expect(testAgentCommand("once").label).toBe("test:fast");
    expect(testAgentCommand("once").cmd[0]).toBe("bun");
    expect(testAgentCommand("once").cmd[1]).toBe("test");
  });
});
