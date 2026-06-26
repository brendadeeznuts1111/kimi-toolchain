import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { recordDecision } from "../src/lib/decision-ledger.ts";
import { buildTraceEvent, recordTraceEvent } from "../src/lib/trace-ledger.ts";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const DECISION = join(REPO_ROOT, "src/bin/kimi-decision.ts");

describe("kimi-decision CLI", () => {
  test("help exits successfully for decision and why aliases", async () => {
    const home = join(tmpdir(), `kimi-decision-help-${Bun.randomUUIDv7()}`);
    mkdirSync(join(home, ".kimi-code", "var"), { recursive: true });
    try {
      const decisionHelp = await spawnDecision(["--help"], home);
      const whyHelp = await spawnWhy(["--help"], home);

      expect(decisionHelp.exitCode).toBe(0);
      expect(whyHelp.exitCode).toBe(0);
      expect(decisionHelp.stdout).toContain("Usage: kimi-decision");
      expect(whyHelp.stdout).toContain("Usage: kimi-decision");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("why returns a seeded decision with its trace root-cause chain", async () => {
    const home = join(tmpdir(), `kimi-decision-cli-${Bun.randomUUIDv7()}`);
    mkdirSync(join(home, ".kimi-code", "var"), { recursive: true });
    try {
      const tracePath = join(home, ".kimi-code", "var", "trace-events.jsonl");
      const decisionPath = join(home, ".kimi-code", "var", "decision-ledger.jsonl");
      const startedAt = new Date().toISOString();
      await recordTraceEvent(
        buildTraceEvent({
          traceId: "trace-root",
          childTraceIds: ["trace-child"],
          eventType: "cli",
          tool: "kimi-heal",
          startedAt,
          endedAt: startedAt,
          durationMs: 1,
          status: "ok",
        }),
        tracePath
      );
      await recordTraceEvent(
        buildTraceEvent({
          traceId: "trace-child",
          parentTraceId: "trace-root",
          eventType: "subprocess",
          tool: "bun run format",
          startedAt,
          endedAt: startedAt,
          durationMs: 2,
          status: "error",
          error: "format check failed",
        }),
        tracePath
      );
      const decision = await recordDecision(
        {
          decisionId: "decision-format-fix",
          key: "self-heal:format",
          action: "heal",
          trigger: "format cluster detected during heal planning",
          traceId: "trace-root",
          clusterId: "format_check_failure",
          rationale: "The format cluster has a deterministic formatter repair.",
          alternativesConsidered: ["inspect files manually"],
          outcome: "success",
        },
        decisionPath
      );

      const why = await spawnDecision(["why", decision.decisionId, "--json"], home);
      const list = await spawnDecision(
        ["log", "--cluster", "format_check_failure", "--limit", "1", "--json"],
        home
      );

      expect(why.exitCode).toBe(0);
      expect(list.exitCode).toBe(0);
      const explanation = JSON.parse(why.stdout) as {
        latest?: { decisionId: string };
        rootCauseChain: string[];
      };
      const log = JSON.parse(list.stdout) as { decisions: Array<{ decisionId: string }> };
      expect(explanation.latest?.decisionId).toBe("decision-format-fix");
      expect(explanation.rootCauseChain).toEqual(["trace-root", "trace-child"]);
      expect(log.decisions[0]?.decisionId).toBe("decision-format-fix");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

async function spawnDecision(
  args: string[],
  home: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", DECISION, ...args], {
    cwd: REPO_ROOT,
    env: { ...Bun.env, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function spawnWhy(
  args: string[],
  home: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", join(REPO_ROOT, "src/bin/kimi-why.ts"), ...args], {
    cwd: REPO_ROOT,
    env: { ...Bun.env, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    Bun.readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}
