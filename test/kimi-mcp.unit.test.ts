import { describe, expect, test } from "bun:test";
import {
  argValue,
  argValues,
  hasFlag,
  parseTopArg,
  positionalArgs,
  trimBunDocsOutput,
} from "../src/bin/kimi-mcp.ts";
import { runBunScript } from "./helpers.ts";

describe("kimi-mcp", () => {
  describe("argument-parsing-helpers", () => {
    test("argValue reads --flag value", () => {
      const argv = ["bun", "kimi-mcp", "add", "srv", "--command", "bun", "--url", "http://x"];
      expect(argValue(argv, "--command")).toBe("bun");
      expect(argValue(argv, "--url")).toBe("http://x");
    });

    test("argValue reads --flag=value", () => {
      const argv = ["bun", "kimi-mcp", "scaffold", "x", "--kind=filesystem"];
      expect(argValue(argv, "--kind")).toBe("filesystem");
    });

    test("argValue returns undefined for missing flag", () => {
      const argv = ["bun", "kimi-mcp", "list"];
      expect(argValue(argv, "--command")).toBeUndefined();
    });

    test("argValues collects repeatable flags", () => {
      const argv = ["bun", "kimi-mcp", "add", "srv", "--args", "run", "--args", "script.ts"];
      expect(argValues(argv, "--args")).toEqual(["run", "script.ts"]);
    });

    test("hasFlag detects boolean flags", () => {
      const argv = ["bun", "kimi-mcp", "bun-docs", "spawn", "--json", "--refresh"];
      expect(hasFlag(argv, "--json")).toBe(true);
      expect(hasFlag(argv, "--refresh")).toBe(true);
      expect(hasFlag(argv, "--quiet")).toBe(false);
    });

    test("positionalArgs ignores flags and their values", () => {
      const argv = ["bun", "kimi-mcp", "query", "Buffer.concat", "--tool", "search_bun", "--json"];
      expect(positionalArgs(argv, 3)).toBe("Buffer.concat");
    });

    test("positionalArgs joins multiple positional tokens", () => {
      const argv = ["bun", "kimi-mcp", "fs", "cat", "runtime/utils.mdx"];
      expect(positionalArgs(argv, 3)).toBe("cat runtime/utils.mdx");
    });

    test("parseTopArg reads --top N", () => {
      const argv = ["bun", "kimi-mcp", "fs", "rg foo", "--top", "5"];
      expect(parseTopArg(argv)).toBe(5);
    });

    test("trimBunDocsOutput limits lines", () => {
      expect(trimBunDocsOutput("a\nb\nc", 2)).toBe("a\nb");
      expect(trimBunDocsOutput("a\nb", undefined)).toBe("a\nb");
    });
  });

  describe("dispatch-and-help", () => {
    test("global --help prints command list and exits 0", async () => {
      const { stdout, exitCode } = await runBunScript("src/bin/kimi-mcp.ts", ["--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("kimi-mcp commands");
      expect(stdout).toContain("bun-docs");
      expect(stdout).toContain("version-policy");
      expect(stdout).toContain("--top N");
    });

    test("unknown command prints error and exits 1", async () => {
      const { stdout, exitCode } = await runBunScript("src/bin/kimi-mcp.ts", ["unknown-cmd"]);
      expect(exitCode).toBe(1);
      expect(stdout).toContain("Unknown command: unknown-cmd");
      expect(stdout).toContain("kimi-mcp commands");
    });
  });

  describe("subcommand-validation", () => {
    test("add without --command or --url errors and shows usage", async () => {
      const { stdout, exitCode } = await runBunScript("src/bin/kimi-mcp.ts", ["add", "myserver"]);
      expect(exitCode).toBe(1);
      expect(stdout).toContain("Either --command or --url is required");
    });

    test("scaffold with invalid --kind errors", async () => {
      const { stdout, exitCode } = await runBunScript("src/bin/kimi-mcp.ts", [
        "scaffold",
        "x",
        "--kind",
        "invalid",
      ]);
      expect(exitCode).toBe(1);
      expect(stdout).toContain("Invalid --kind: invalid");
    });

    test("query without text errors and shows usage", async () => {
      const { stdout, exitCode } = await runBunScript("src/bin/kimi-mcp.ts", ["query"]);
      expect(exitCode).toBe(1);
      expect(stdout).toContain("Usage: kimi-mcp query");
    });

    test("bun-docs --help prints subcommand usage", async () => {
      const { stdout, exitCode } = await runBunScript("src/bin/kimi-mcp.ts", [
        "bun-docs",
        "--help",
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("bun-docs");
      expect(stdout).toContain("Usage: kimi-mcp bun-docs");
    });
  });
});
