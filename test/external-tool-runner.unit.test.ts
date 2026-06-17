import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { REPO_ROOT } from "./helpers.ts";
import {
  listExternalToolAdapters,
  runExternalToolAdapterEffect,
} from "../src/lib/external-tool-runner.ts";

describe("external-tool-runner adapters", () => {
  test("lists registered adapters", () => {
    const adapters = listExternalToolAdapters();
    expect(adapters).toContain("effect-gates");
    expect(adapters).toContain("guardian");
    expect(adapters).toContain("governance");
    expect(adapters).toContain("oxlint");
    expect(adapters).toContain("typecheck");
  });

  test("typecheck adapter returns AdapterOutput with ok check", async () => {
    const output = await Effect.runPromise(runExternalToolAdapterEffect("typecheck", REPO_ROOT));
    expect(output.adapterName).toBe("typecheck");
    expect(output.durationMs).toBeGreaterThanOrEqual(0);
    expect(output.checks.length).toBeGreaterThan(0);
    expect(output.checks[0]?.name).toBe("typecheck");
    expect(output.checks[0]?.status).toBe("ok");
  }, 30_000);

  test("effect-gates adapter returns ok when clean", async () => {
    const output = await Effect.runPromise(runExternalToolAdapterEffect("effect-gates", REPO_ROOT));
    expect(output.adapterName).toBe("effect-gates");
    const check = output.checks.find((c) => c.name === "effect-gates");
    expect(check?.status).toBe("ok");
    expect(check?.message).toContain("clean");
  }, 60_000);

  test("guardian and governance adapters return checks", async () => {
    const guardian = await Effect.runPromise(runExternalToolAdapterEffect("guardian", REPO_ROOT));
    expect(guardian.adapterName).toBe("guardian");
    expect(guardian.checks.length).toBeGreaterThan(0);

    const governance = await Effect.runPromise(
      runExternalToolAdapterEffect("governance", REPO_ROOT)
    );
    expect(governance.adapterName).toBe("governance");
    expect(governance.checks.length).toBeGreaterThan(0);
  }, 30_000);

  test("unknown adapter returns error check", async () => {
    const output = await Effect.runPromise(runExternalToolAdapterEffect("not-real", REPO_ROOT));
    expect(output.adapterName).toBe("not-real");
    expect(output.checks[0]?.status).toBe("error");
    expect(output.checks[0]?.message).toContain("unknown adapter");
  });

  test("adapter timeout returns timeout category", async () => {
    const output = await Effect.runPromise(
      runExternalToolAdapterEffect("typecheck", REPO_ROOT, { timeoutMs: 1 })
    );
    expect(output.checks[0]?.status).toBe("error");
    expect(output.checks[0]?.category).toBe("doctor_adapter_timeout");
    expect(output.checks[0]?.message).toContain("timed out");
  }, 10_000);
});
