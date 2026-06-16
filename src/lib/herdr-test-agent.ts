import { join } from "node:path";
import { bunTestArgs, FAST_TEST_TIMEOUT_MS } from "./test-gates.ts";

export type HerdrAgentState = "working" | "done" | "idle" | "blocked";
export type TestAgentMode = "watch" | "once" | "check" | "ci";

export const TEST_AGENT_WATCH_DIRS = ["src", "test", "scripts"] as const;
export const TEST_AGENT_DEBOUNCE_MS = 800;

export function parseTestAgentMode(argv: string[]): TestAgentMode {
  if (argv.includes("--ci")) return "ci";
  if (argv.includes("--check")) return "check";
  if (argv.includes("--watch")) return "watch";
  if (argv.includes("--once")) return "once";
  return "once";
}

export function testAgentCommand(mode: TestAgentMode): { label: string; cmd: string[] } {
  switch (mode) {
    case "check":
      return { label: "check:fast", cmd: ["bun", "run", "scripts/check.ts", "--fast"] };
    case "ci":
      return {
        label: "ci:quality",
        cmd: ["bun", "run", "scripts/ci-local.ts", "--job", "quality"],
      };
    case "watch":
    case "once":
    default:
      return {
        label: "test:fast",
        cmd: [
          "bun",
          ...bunTestArgs({
            fast: true,
            timeoutMs: FAST_TEST_TIMEOUT_MS,
            bail: true,
            retry: 2,
          }),
        ],
      };
  }
}

export function watchPaths(repoRoot: string): string[] {
  return TEST_AGENT_WATCH_DIRS.map((dir) => join(repoRoot, dir));
}
