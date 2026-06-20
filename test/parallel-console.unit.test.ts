import { describe, expect, test } from "bun:test";
import { join } from "path";
import { writeText } from "../src/lib/bun-io.ts";
import { withTempDir } from "./helpers.ts";

function parallelConsoleFixture(label: string, delayMs: number): string {
  return `import { expect, test } from "bun:test";

test("${label} logs are buffered", async () => {
  console.log("${label}:start");
  await Bun.sleep(${delayMs});
  console.log("${label}:middle");
  await Bun.sleep(${delayMs});
  console.log("${label}:end");
  expect(true).toBe(true);
});
`;
}

function markerBlockIsContiguous(output: string, label: string, otherLabel: string): boolean {
  const start = output.indexOf(`${label}:start`);
  const middle = output.indexOf(`${label}:middle`);
  const end = output.indexOf(`${label}:end`);
  expect(start, `${label}:start marker missing`).toBeGreaterThanOrEqual(0);
  expect(middle, `${label}:middle marker missing`).toBeGreaterThan(start);
  expect(end, `${label}:end marker missing`).toBeGreaterThan(middle);

  const block = output.slice(start, end);
  return (
    !block.includes(`${otherLabel}:start`) &&
    !block.includes(`${otherLabel}:middle`) &&
    !block.includes(`${otherLabel}:end`)
  );
}

describe("parallel-console", () => {
  test("bun test --parallel flushes each file's console output without interleaving", () =>
    withTempDir("parallel-console-", (dir) => {
      writeText(join(dir, "alpha.unit.test.ts"), parallelConsoleFixture("alpha", 25));
      writeText(join(dir, "beta.unit.test.ts"), parallelConsoleFixture("beta", 10));

      const result = Bun.spawnSync({
        cmd: [
          "bun",
          "test",
          "--parallel=2",
          "--isolate",
          "alpha.unit.test.ts",
          "beta.unit.test.ts",
        ],
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: undefined,
        },
      });

      const stdout = new TextDecoder().decode(result.stdout);
      const stderr = new TextDecoder().decode(result.stderr);
      const output = `${stdout}\n${stderr}`;

      expect(result.exitCode, output).toBe(0);
      expect(markerBlockIsContiguous(output, "alpha", "beta")).toBe(true);
      expect(markerBlockIsContiguous(output, "beta", "alpha")).toBe(true);
    }));
});
