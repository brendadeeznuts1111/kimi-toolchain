import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { tmpdir } from "os";
import { join } from "path";
import {
  KimiCapabilities,
  KimiContract,
  KimiIntrospectionLiveFor,
  KimiTrace,
  MissingSigningKey,
  TraceNotFound,
} from "../../src/lib/effect/kimi-introspection-services.ts";
import { buildTraceEvent, recordTraceEvent } from "../../src/lib/trace-ledger.ts";
import { makeDir, pathExists, removePath, writeText } from "../../src/lib/bun-io.ts";

function makeTempProject(): string {
  const dir = join(tmpdir(), `kimi-introspection-services-${Bun.randomUUIDv7()}`);
  makeDir(join(dir, "contracts"), { recursive: true });
  writeText(
    join(dir, "contracts", "sample.contract.json"),
    JSON.stringify({ schemaVersion: 1, kind: "sample", name: "sample" }, null, 2)
  );
  return dir;
}

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = join(tmpdir(), `kimi-introspection-home-${Bun.randomUUIDv7()}`);
  const oldHome = Bun.env.HOME;
  makeDir(join(home, ".kimi-code"), { recursive: true });
  try {
    Bun.env.HOME = home;
    return await fn(home);
  } finally {
    if (oldHome === undefined) delete Bun.env.HOME;
    else Bun.env.HOME = oldHome;
    removePath(home, { recursive: true, force: true });
  }
}

describe("kimi introspection Effect services", () => {
  test("capabilities service probes readiness without shelling out", async () => {
    const projectRoot = makeTempProject();
    await withTempHome(async (home) => {
      writeText(
        join(home, ".kimi-code", "mcp.json"),
        JSON.stringify({ mcpServers: { "unified-shell": { command: "bun" } } })
      );
      writeText(
        join(home, ".kimi-code", "config.toml"),
        '[[hooks]]\nevent = "PostToolUseFailure"\ncommand = "log-tool-failure"\n'
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const capabilities = yield* KimiCapabilities;
          return yield* capabilities.probe();
        }).pipe(Effect.provide(KimiIntrospectionLiveFor({ projectRoot })))
      );

      expect(result.readiness).toBe(result.readinessScore);
      expect(result.items.map((item) => item.name)).toContain("mcp-config");
      expect(result.items.map((item) => item.name)).toContain("contract-trust");
      expect(result.report.checks.length).toBeGreaterThan(0);
    });
    removePath(projectRoot, { recursive: true, force: true });
  });

  test("trace service returns causal steps and typed not-found failures", async () => {
    await withTempHome(async (home) => {
      const tracePath = join(home, ".kimi-code", "var", "trace-events.jsonl");
      recordTraceEvent(
        buildTraceEvent({
          traceId: "root",
          childTraceIds: ["child"],
          eventType: "cli",
          tool: "kimi-root",
          status: "ok",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: "2026-01-01T00:00:00.010Z",
          durationMs: 10,
        }),
        tracePath
      );
      recordTraceEvent(
        buildTraceEvent({
          traceId: "child",
          parentTraceId: "root",
          eventType: "subprocess",
          tool: "nested-hook",
          status: "error",
          error: "hook failed",
          startedAt: "2026-01-01T00:00:00.011Z",
          endedAt: "2026-01-01T00:00:00.021Z",
          durationMs: 10,
        }),
        tracePath
      );

      const traced = await Effect.runPromise(
        Effect.gen(function* () {
          const traces = yield* KimiTrace;
          return yield* traces.trace("child");
        }).pipe(Effect.provide(KimiIntrospectionLiveFor({ projectRoot: home })))
      );
      expect(traced.rootTraceId).toBe("root");
      expect(traced.steps.map((step) => step.id)).toEqual(["root", "child"]);
      expect(traced.rootCauseChain).toEqual(["root", "child"]);

      const missing = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const traces = yield* KimiTrace;
          return yield* traces.trace("missing");
        }).pipe(Effect.provide(KimiIntrospectionLiveFor({ projectRoot: home })))
      );
      expect(Exit.isFailure(missing)).toBe(true);
      if (Exit.isFailure(missing) && missing.cause._tag === "Fail") {
        expect(missing.cause.error).toBeInstanceOf(TraceNotFound);
      }
    });
  });

  test("contract service validates unsigned contracts and reports missing signing keys", async () => {
    const projectRoot = makeTempProject();
    const oldSigningKey = Bun.env.KIMI_SIGNING_KEY;
    const oldSigningKeyFile = Bun.env.KIMI_SIGNING_KEY_FILE;
    delete Bun.env.KIMI_SIGNING_KEY;
    delete Bun.env.KIMI_SIGNING_KEY_FILE;

    try {
      const validation = await Effect.runPromise(
        Effect.gen(function* () {
          const contracts = yield* KimiContract;
          return yield* contracts.validate("contracts/sample.contract.json");
        }).pipe(Effect.provide(KimiIntrospectionLiveFor({ projectRoot })))
      );
      expect(validation.status).toBe("unsigned");
      expect(validation.trusted).toBe(false);

      const signing = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const contracts = yield* KimiContract;
          return yield* contracts.sign("contracts/sample.contract.json", "schema-team");
        }).pipe(Effect.provide(KimiIntrospectionLiveFor({ projectRoot })))
      );
      expect(Exit.isFailure(signing)).toBe(true);
      if (Exit.isFailure(signing) && signing.cause._tag === "Fail") {
        expect(signing.cause.error).toBeInstanceOf(MissingSigningKey);
      }
      expect(pathExists(join(projectRoot, "contracts", "sample.contract.json.sig"))).toBe(false);
    } finally {
      if (oldSigningKey === undefined) delete Bun.env.KIMI_SIGNING_KEY;
      else Bun.env.KIMI_SIGNING_KEY = oldSigningKey;
      if (oldSigningKeyFile === undefined) delete Bun.env.KIMI_SIGNING_KEY_FILE;
      else Bun.env.KIMI_SIGNING_KEY_FILE = oldSigningKeyFile;
      removePath(projectRoot, { recursive: true, force: true });
    }
  });
});
