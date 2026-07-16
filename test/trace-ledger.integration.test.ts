import { describe, expect, test } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { invokeTool } from "../src/lib/tool-runner.ts";
import { buildTraceGraph } from "../src/lib/trace-ledger.ts";
import { REPO_ROOT, makeDir, removePath, writeText } from "./helpers.ts";
const HOOK = join(REPO_ROOT, "src/kimi-hooks/log-tool-failure.ts");
const TRACE = join(REPO_ROOT, "src/bin/kimi-trace.ts");

describe("trace ledger", () => {
  test("reconstructs root cause for a hook failure inside a nested subprocess", async () => {
    const dir = join(tmpdir(), `kimi-trace-${Bun.randomUUIDv7()}`);
    const oldHome = Bun.env.HOME;
    const rootTraceId = crypto.randomUUID();
    makeDir(join(dir, ".kimi-code", "var"), { recursive: true });
    await Bun.write(
      join(dir, ".kimi-code", "error-taxonomy.yml"),
      await Bun.file(join(REPO_ROOT, "error-taxonomy.yml")).text()
    );
    const nested = join(dir, "nested-hook.ts");
    writeText(
      nested,
      `
const hook = Bun.argv[2];
const parent = Bun.env.KIMI_TRACE_ID || crypto.randomUUID();
const hookTrace = crypto.randomUUID();
const proc = Bun.spawn(["bun", "run", hook], {
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
  env: {
    ...Bun.env,
    KIMI_TRACE_ID: hookTrace,
    KIMI_PARENT_TRACE_ID: parent,
    KIMI_TRACE_STARTED_AT: new Date().toISOString()
  }
});
const payload = {
  hook_event_name: "PostToolUseFailure",
  session_id: "trace-test",
  tool_name: "NestedTool",
  error: "HASH MISMATCH for bun.lock"
};
proc.stdin.write(JSON.stringify(payload));
proc.stdin.end();
process.exit(await proc.exited);
`
    );

    try {
      Bun.env.HOME = dir;
      const result = await invokeTool(nested, [HOOK], {
        cwd: REPO_ROOT,
        env: { HOME: dir, KIMI_TRACE_ID: rootTraceId },
      });
      expect(result.exitCode).toBe(0);

      const graph = await buildTraceGraph(rootTraceId, {
        tracePath: join(dir, ".kimi-code", "var", "trace-events.jsonl"),
        failurePath: join(dir, ".kimi-code", "var", "tool-failures.jsonl"),
      });
      expect(graph.found).toBe(true);
      expect(graph.rootCauseChain[0]).toBe(rootTraceId);
      expect(graph.nodes.some((node) => node.failures[0]?.taxonomyId === "lockfile_issue")).toBe(
        true
      );

      const traceCli = await invokeTool(TRACE, [rootTraceId, "--json"], {
        cwd: REPO_ROOT,
        env: { HOME: dir, KIMI_TRACE_ID: rootTraceId },
      });
      const parsed = JSON.parse(traceCli.stdout) as { rootCauseChain: string[]; found: boolean };
      expect(parsed.found).toBe(true);
      expect(parsed.rootCauseChain[0]).toBe(rootTraceId);
    } finally {
      if (oldHome === undefined) delete Bun.env.HOME;
      else Bun.env.HOME = oldHome;
      removePath(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
