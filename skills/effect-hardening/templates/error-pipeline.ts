/**
 * Module 2 — Structured error pipeline (reference template).
 * Exemplar in repo: src/lib/effect/errors.ts, src/lib/herdr-orchestrator.ts
 */
import { Data, Effect, Schedule, pipe } from "effect";

// ── Tagged errors ──

export class SshError extends Data.TaggedError("SshError")<{
  readonly host: string;
  readonly code: "timeout" | "refused" | "auth_failed" | "not_found";
  readonly stderr: string;
  readonly retryable: boolean;
}> {}

export class HandoffError extends Data.TaggedError("HandoffError")<{
  readonly from: string;
  readonly to: string;
  readonly reason: "agent_dead" | "rule_mismatch" | "unsafe_role";
  readonly context?: unknown;
}> {}

type HandoffResult =
  | { readonly _tag: "Success"; readonly rule: string }
  | { readonly _tag: "Skipped"; readonly rule: string; readonly reason: string };

// ── Infrastructure (would call governedSpawn at the edge) ──

declare const sshExec: (host: string, command: string[]) => Effect.Effect<string, SshError>;

declare function evaluateRule(rule: string): Effect.Effect<HandoffResult, HandoffError>;

// ── Retry with bounded schedule ──

export const sshWithRetry = (host: string, command: string[]) =>
  pipe(
    sshExec(host, command),
    Effect.retry({
      schedule: Schedule.exponential("1 second").pipe(Schedule.intersect(Schedule.recurs(3))),
      while: (error) => error.retryable,
    }),
    Effect.tapError((error) =>
      Effect.sync(() => {
        console.error(`[ssh] ${host}: ${error.code} — ${error.stderr}`);
      })
    )
  );

// ── Parallel aggregation ──

export const evaluateAllRules = (rules: string[]) =>
  pipe(
    Effect.forEach(rules, evaluateRule, { concurrency: "unbounded" }),
    Effect.map((results) =>
      results.filter((r): r is HandoffResult & { _tag: "Success" } => r._tag === "Success")
    ),
    Effect.tap((passed) =>
      Effect.sync(() => {
        console.log(`[handoff] ${passed.length}/${rules.length} rules passed`);
      })
    )
  );
