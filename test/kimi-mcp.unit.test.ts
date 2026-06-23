import { describe, expect, test } from "bun:test";
import {
  argValue,
  argValues,
  coerceCliValue,
  hasFlag,
  parseKeyValueArgs,
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

    test("parseKeyValueArgs extracts key=value positional args", () => {
      const argv = [
        "bun",
        "kimi-mcp",
        "call",
        "bun-docs",
        "search_bun",
        "query=Bun.spawn",
        "limit=5",
      ];
      expect(parseKeyValueArgs(argv, 5)).toEqual({ query: "Bun.spawn", limit: 5 });
    });

    test("parseKeyValueArgs skips flags and their values", () => {
      const argv = [
        "bun",
        "kimi-mcp",
        "call",
        "bun-docs",
        "search_bun",
        "query=test",
        "--json",
        "--timeout",
        "30000",
        "--refresh",
      ];
      expect(parseKeyValueArgs(argv, 5)).toEqual({ query: "test" });
    });

    test("parseKeyValueArgs ignores tokens without equals sign", () => {
      const argv = ["bun", "kimi-mcp", "call", "server", "tool", "notkeyvalue", "key=value"];
      expect(parseKeyValueArgs(argv, 5)).toEqual({ key: "value" });
    });

    test("coerceCliValue coerces numeric and boolean literals", () => {
      expect(coerceCliValue("5")).toBe(5);
      expect(coerceCliValue("-3")).toBe(-3);
      expect(coerceCliValue("3.14")).toBe(3.14);
      expect(coerceCliValue("true")).toBe(true);
      expect(coerceCliValue("false")).toBe(false);
      expect(coerceCliValue("hello")).toBe("hello");
    });

    test("parseKeyValueArgs last key wins for duplicates", () => {
      const argv = ["bun", "kimi-mcp", "call", "srv", "tool", "limit=1", "limit=5"];
      expect(parseKeyValueArgs(argv, 5)).toEqual({ limit: 5 });
    });

    test("parseKeyValueArgs preserves values with embedded equals signs", () => {
      const argv = ["bun", "kimi-mcp", "call", "srv", "tool", "expr=a=b"];
      expect(parseKeyValueArgs(argv, 5)).toEqual({ expr: "a=b" });
    });
  });

  describe("dispatch-and-help", () => {
    test("global --help prints command list and exits 0", async () => {
      const { stdout, exitCode } = await runBunScript("src/bin/kimi-mcp.ts", ["--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("kimi-mcp commands");
      expect(stdout).toContain("bun-docs");
      expect(stdout).toContain("call");
      expect(stdout).toContain("version-policy");
      expect(stdout).toContain("--top N");
      expect(stdout).toContain("--webview");
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
      expect(stdout).toContain("--webview");
    });

    test("call without server or tool errors and shows usage", async () => {
      const { stdout, exitCode } = await runBunScript("src/bin/kimi-mcp.ts", ["call"]);
      expect(exitCode).toBe(1);
      expect(stdout).toContain("Usage: kimi-mcp call");
    });

    test("call --help prints subcommand usage", async () => {
      const { stdout, exitCode } = await runBunScript("src/bin/kimi-mcp.ts", ["call", "--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("call");
      expect(stdout).toContain("Usage: kimi-mcp call");
      expect(stdout).toContain("coerce");
    });

    test("call bun-docs search_bun returns results", async () => {
      if (Bun.env.KIMI_SKIP_NETWORK_PROBE === "1") return;
      const { stdout, exitCode } = await runBunScript("src/bin/kimi-mcp.ts", [
        "call",
        "bun-docs",
        "search_bun",
        "query=Bun.spawn",
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Bun.spawn");
    });

    test("call bun-docs --json returns structured output", async () => {
      if (Bun.env.KIMI_SKIP_NETWORK_PROBE === "1") return;
      const { stdout, exitCode } = await runBunScript("src/bin/kimi-mcp.ts", [
        "call",
        "bun-docs",
        "search_bun",
        "query=Bun.spawn",
        "--json",
      ]);
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.server).toBe("bun-docs");
      expect(parsed.mcpTool).toBe("search_bun");
      expect(parsed.tool).toBe("kimi-mcp");
      expect(parsed.args).toEqual({ query: "Bun.spawn" });
    });
  });
});
