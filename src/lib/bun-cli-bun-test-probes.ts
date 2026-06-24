/**
 * Runtime probes ported from oven-sh/bun `test/cli/test/bun-test.test.ts` (subset).
 */

import { join } from "path";
import { cliProbe, spawnCliInDir, withCliFixture, withCliFixtureDir } from "./bun-cli-fixture.ts";

export interface CliContractProbeResult {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

function testOutput(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}${result.stderr}`;
}

async function runBunTest(
  label: string,
  files: Record<string, string>,
  args: string[] = [],
  env?: Record<string, string | undefined>
) {
  return withCliFixture(label, files, ["test", ...args], env);
}

export async function runBunTestContractProbes(): Promise<CliContractProbeResult[]> {
  const probes: CliContractProbeResult[] = [];

  const missing = await withCliFixtureDir("bun-test-missing", {}, async (dir) => {
    const missingPath = join(dir, "non-existent.test.ts");
    return spawnCliInDir(dir, ["test", missingPath]);
  });
  probes.push(
    cliProbe(
      "cli.test.bun-test.missing-path",
      missing.exitCode === 1,
      missing.exitCode === 1 ? "exit 1" : `exit=${missing.exitCode}`
    )
  );

  for (const [suffix, args, pattern] of [
    ["bail-foo", ["--bail=foo"], /expects a number/i],
    ["bail-neg", ["--bail=-1"], /expects a number/i],
    ["bail-zero", ["--bail=0"], /expects a number/i],
    ["timeout-foo", ["--timeout", "foo"], /Invalid timeout/i],
    ["timeout-neg", ["--timeout", "-1"], /Invalid timeout/i],
  ] as const) {
    const result = await runBunTest(`bun-test-${suffix}`, {}, [...args]);
    const out = testOutput(result);
    probes.push(
      cliProbe(
        `cli.test.bun-test.${suffix}`,
        result.exitCode !== 0 && pattern.test(out),
        result.exitCode !== 0 ? "validation error" : `exit=${result.exitCode}`
      )
    );
  }

  const todoDefault = await runBunTest(
    "bun-test-todo-off",
    {
      "todo.test.ts": `import { test } from "bun:test"; test.todo("todo", () => { console.error("should not run"); });`,
    },
    ["todo.test.ts"]
  );
  probes.push(
    cliProbe(
      "cli.test.bun-test.todo-default",
      !testOutput(todoDefault).includes("should not run"),
      "todo skipped"
    )
  );

  const todoEnabled = await runBunTest(
    "bun-test-todo-on",
    {
      "todo.test.ts": `import { test } from "bun:test"; test.todo("todo", () => { console.error("should run"); });`,
    },
    ["--todo", "todo.test.ts"]
  );
  probes.push(
    cliProbe(
      "cli.test.bun-test.todo-enabled",
      testOutput(todoEnabled).includes("should run"),
      "todo executed"
    )
  );

  const onlyNested = await runBunTest(
    "bun-test-only-nested",
    {
      "only.test.ts": `import { test, describe } from "bun:test";
describe("outer", () => {
  describe.only("inner (nested)", () => {
    test("test", () => { console.error("reachable"); });
  });
  describe("inner (skipped)", () => {
    test("test", () => { console.error("unreachable"); });
  });
});`,
    },
    ["only.test.ts"],
    { CI: "false" }
  );
  const onlyOut = testOutput(onlyNested);
  probes.push(
    cliProbe(
      "cli.test.bun-test.only-nested",
      onlyOut.includes("reachable") && !onlyOut.includes("unreachable"),
      onlyNested.exitCode === 0 ? "only nested" : `exit=${onlyNested.exitCode}`
    )
  );

  const bailDefault = await runBunTest(
    "bun-test-bail-default",
    {
      "bail.test.ts": `import { test, expect } from "bun:test";
test("test #1", () => { expect(true).toBe(false); });
test("test #2", () => { expect(true).toBe(true); });`,
    },
    ["--bail", "bail.test.ts"]
  );
  const bailDefaultOut = testOutput(bailDefault);
  probes.push(
    cliProbe(
      "cli.test.bun-test.bail-default",
      bailDefaultOut.includes("Bailed out after 1 failure") && !bailDefaultOut.includes("test #2"),
      bailDefaultOut.includes("Bailed out after 1 failure") ? "bail 1" : "no bail"
    )
  );

  const bailThree = await runBunTest(
    "bun-test-bail-three",
    {
      "bail3.test.ts": `import { test, expect } from "bun:test";
test("test #1", () => { expect(true).toBe(false); });
test("test #2", () => { expect(true).toBe(false); });
test("test #3", () => { expect(true).toBe(false); });
test("test #4", () => { expect(true).toBe(true); });`,
    },
    ["--bail=3", "bail3.test.ts"]
  );
  const bailThreeOut = testOutput(bailThree);
  probes.push(
    cliProbe(
      "cli.test.bun-test.bail-three",
      bailThreeOut.includes("Bailed out after 3 failures") && !bailThreeOut.includes("test #4"),
      bailThreeOut.includes("Bailed out after 3 failures") ? "bail 3" : "no bail"
    )
  );

  const noArgs = await runBunTest("bun-test-no-args", {
    "a.test.ts": `import { test, expect } from "bun:test"; test("test #1", () => { expect(true).toBe(true); });`,
    "b.test.ts": `import { test, expect } from "bun:test"; test("test #3", () => { expect(true).toBe(false); });`,
  });
  const noArgsOut = testOutput(noArgs);
  probes.push(
    cliProbe(
      "cli.test.bun-test.no-args",
      noArgsOut.includes("Ran 2 tests across 2 files") &&
        noArgsOut.includes("1 pass") &&
        noArgsOut.includes("test #3"),
      noArgsOut.includes("Ran 2 tests across 2 files") ? "discovered" : "missing tests"
    )
  );

  const dirFilter = await runBunTest(
    "bun-test-dir-filter",
    {
      "foo.test.js": `import { test, expect } from "bun:test"; test("foo", () => { expect(1).toBe(1); });`,
      "bar/bar1.spec.ts": `import { test, expect } from "bun:test"; test("bar1", () => { expect(1).toBe(1); });`,
      "bar/bar2.spec.ts": `import { test, expect } from "bun:test"; test("bar2", () => { expect(1).toBe(1); });`,
    },
    ["./bar"]
  );
  const dirOut = testOutput(dirFilter);
  probes.push(
    cliProbe(
      "cli.test.bun-test.dir-filter",
      dirOut.includes("2 pass") && !dirOut.includes("foo"),
      dirFilter.exitCode === 0 ? "bar only" : `exit=${dirFilter.exitCode}`
    )
  );

  const noMatch = await runBunTest(
    "bun-test-no-match",
    {
      "some.test.ts": `import { test } from "bun:test"; test("example", () => {});`,
    },
    ["-t", "nonexistent-filter-xyz"]
  );
  const noMatchOut = testOutput(noMatch);
  probes.push(
    cliProbe(
      "cli.test.bun-test.no-match",
      noMatch.exitCode === 1 && /No tests found|0 tests/i.test(noMatchOut),
      noMatch.exitCode === 1 ? "no match" : `exit=${noMatch.exitCode}`
    )
  );

  const requireOk = await runBunTest(
    "bun-test-require",
    {
      "t.test.js": `const { test, expect } = require("bun:test"); test("test #1", () => { expect().pass(); });`,
    },
    ["t.test.js"]
  );
  probes.push(
    cliProbe(
      "cli.test.bun-test.require",
      requireOk.exitCode === 0,
      requireOk.exitCode === 0 ? "require" : `exit=${requireOk.exitCode}`
    )
  );

  const cjsRequire = await runBunTest("bun-test-cjs", {
    "test.test.cjs": `const { test, expect } = require("bun:test"); test("test #1", () => { expect().pass(); });`,
  });
  probes.push(
    cliProbe(
      "cli.test.bun-test.cjs-require",
      cjsRequire.exitCode === 0,
      cjsRequire.exitCode === 0 ? "cjs" : `exit=${cjsRequire.exitCode}`
    )
  );

  const relativeFile = await runBunTest(
    "bun-test-relative",
    {
      "path/to/relative.test.ts": `import { test, expect } from "bun:test"; test("path/to/relative.test.ts", () => { expect(true).toBe(true); });`,
    },
    ["path/to/relative.test.ts"]
  );
  probes.push(
    cliProbe(
      "cli.test.bun-test.relative-file",
      relativeFile.exitCode === 0 && testOutput(relativeFile).includes("1 pass"),
      relativeFile.exitCode === 0 ? "relative" : `exit=${relativeFile.exitCode}`
    )
  );

  const skipOnly = await runBunTest(
    "bun-test-skip-only",
    {
      "only.test.ts": `import { test, describe } from "bun:test";
test("test #1", () => { console.error("unreachable"); });
test.only("test #2", () => { console.error("reachable"); });
test("test #3", () => { console.error("unreachable"); });
describe.only("describe #2", () => {
  test("test #8", () => { console.error("reachable"); });
});`,
    },
    ["only.test.ts"],
    { CI: "false" }
  );
  const skipOnlyOut = testOutput(skipOnly);
  probes.push(
    cliProbe(
      "cli.test.bun-test.skip-only",
      skipOnlyOut.includes("reachable") &&
        !skipOnlyOut.includes("unreachable") &&
        (skipOnlyOut.match(/reachable/g)?.length ?? 0) === 2,
      skipOnlyOut.includes("reachable") ? "only" : "fail"
    )
  );

  return probes;
}
