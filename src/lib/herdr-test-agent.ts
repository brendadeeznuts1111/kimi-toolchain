import { FAST_TEST_TIMEOUT_MS } from "./test-gates.ts";
import { buildBunTestArgs } from "./test-runtime.ts";

/** Herdr report-agent states (this build: idle | working | blocked | unknown). */
export type HerdrAgentState = "working" | "idle" | "blocked" | "unknown";
export type TestAgentMode = "once" | "check" | "ci";

export function parseTestAgentMode(argv: string[]): TestAgentMode {
  if (argv.includes("--ci")) return "ci";
  if (argv.includes("--check")) return "check";
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
    case "once":
    default:
      return {
        label: "test:fast",
        cmd: [
          "bun",
          ...buildBunTestArgs({
            fast: true,
            timeoutMs: FAST_TEST_TIMEOUT_MS,
            bail: true,
            retry: 2,
          }),
        ],
      };
  }
}
