import { describe, expect, test } from "bun:test";
import { dedupInflight, peekPromise, peekPromiseStatus } from "../src/lib/bun-utils.ts";
import { cachedDoctor, clearGovernorCacheInflight } from "../src/lib/governor-cache.ts";
import {
  clearProcessCache,
  getCachedCommandOutputAsync,
  getCachedPsAsync,
} from "../src/lib/proc-cache.ts";
import { clearInvokeCommandInflight, invokeCommand } from "../src/lib/tool-runner.ts";
import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";
import { join } from "path";
import { REPO_ROOT, testTempDir } from "./helpers.ts";
import {
  auditPeekAdoption,
  auditTochangeRegistry,
  PEEK_ADOPTION_REGISTRY,
  scanTochangeMarkers,
} from "../src/lib/tochange-tracker.ts";

describe("tochange-tracker", () => {
  describe("peek wrappers", () => {
    test("peekPromise returns fulfilled value without await", () => {
      const value = peekPromise(Promise.resolve({ ok: true }));
      expect(value).toEqual({ ok: true });
    });

    test("peekPromise passes through pending promise", () => {
      const pending = new Promise(() => {});
      expect(peekPromise(pending)).toBe(pending);
      expect(peekPromiseStatus(pending)).toBe("pending");
    });

    test("peekPromiseStatus reports fulfilled", () => {
      expect(peekPromiseStatus(Promise.resolve(1))).toBe("fulfilled");
    });

    test("peekPromise throws on rejected promise", () => {
      const rejected = Promise.reject(new Error("peek test"));
      rejected.catch(() => {});
      expect(() => peekPromise(rejected)).toThrow("peek test");
      expect(peekPromiseStatus(rejected)).toBe("rejected");
    });

    test("dedupInflight runs once for concurrent callers", async () => {
      const map = new Map<string, Promise<number>>();
      let runs = 0;
      const [a, b] = await Promise.all([
        dedupInflight(map, "k", async () => {
          runs++;
          await Bun.sleep(50);
          return runs;
        }),
        dedupInflight(map, "k", async () => {
          runs++;
          await Bun.sleep(50);
          return runs;
        }),
      ]);
      expect(a).toBe(1);
      expect(b).toBe(1);
      expect(runs).toBe(1);
    });
  });

  test("auditPeekAdoption uses registry probes with zero pending", async () => {
    const report = await auditPeekAdoption(REPO_ROOT);
    expect(report.ok).toBe(true);
    expect(report.registryPending).toHaveLength(0);
    expect(report.registryImplemented.length).toBe(24);
    expect(report.probeFailures).toEqual([]);
    expect(report.orphanMarkers).toEqual([]);
    expect(report.staleTochangeMarkers).toEqual([]);
    expect(report.directStreamReads).toEqual([]);
  });

  test("auditTochangeRegistry flags probe failures", async () => {
    const registry = [
      {
        id: "broken-probe",
        file: "src/lib/bun-utils.ts",
        tier: "required" as const,
        status: "implemented" as const,
        summary: "test",
        probe: "definitely-not-in-file-xyz",
      },
    ];
    const report = await auditTochangeRegistry(REPO_ROOT, [], registry);
    expect(report.probeFailures).toHaveLength(1);
    expect(report.ok).toBe(false);
  });

  test("scanTochangeMarkers ignores registry-only implemented items", async () => {
    const markers = await scanTochangeMarkers(REPO_ROOT);
    const implemented = markers.filter((m) => m.kind === "implemented");
    expect(implemented).toHaveLength(0);
  });

  test("invokeCommand dedups concurrent identical spawns", async () => {
    clearInvokeCommandInflight();
    const dir = testTempDir("peek-inflight-");
    makeDir(dir, { recursive: true });
    const counter = join(dir, "counter.txt");
    writeText(counter, "0");
    const script = join(dir, "script.ts");
    writeText(
      script,
      `const n = parseInt(await Bun.file(Bun.env.COUNTER_FILE!).text());
await Bun.write(Bun.env.COUNTER_FILE!, String(n + 1));
await Bun.sleep(120);
console.log("ok");`
    );

    const cmd = ["bun", "run", script];
    const env = { COUNTER_FILE: counter };
    await Promise.all([
      invokeCommand(cmd, { env, timeoutMs: 5000 }),
      invokeCommand(cmd, { env, timeoutMs: 5000 }),
    ]);
    expect(await Bun.file(counter).text()).toBe("1");
    clearInvokeCommandInflight();
    removePath(dir, { recursive: true, force: true });
  });

  test("getCachedCommandOutputAsync dedups concurrent pgrep fetches", async () => {
    clearProcessCache();
    const [a, b] = await Promise.all([
      getCachedCommandOutputAsync("ps", ["-axo", "pid="]),
      getCachedCommandOutputAsync("ps", ["-axo", "pid="]),
    ]);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
    clearProcessCache();
  });

  test("getCachedPsAsync dedups concurrent fetches", async () => {
    clearProcessCache();
    const [a, b] = await Promise.all([
      getCachedPsAsync(["-axo", "pid="]),
      getCachedPsAsync(["-axo", "pid="]),
    ]);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
    clearProcessCache();
  });

  test("cachedDoctor dedups concurrent misses", async () => {
    clearGovernorCacheInflight();
    const check = `peek-dedup-${Date.now()}`;
    let runs = 0;
    const fn = async () => {
      runs++;
      await Bun.sleep(80);
      return `out-${runs}`;
    };
    const [a, b] = await Promise.all([cachedDoctor(check, fn), cachedDoctor(check, fn)]);
    expect(a).toBe("out-1");
    expect(b).toBe("out-1");
    expect(runs).toBe(1);
    clearGovernorCacheInflight();
  });

  test("PEEK_ADOPTION_REGISTRY has no pending drift", () => {
    expect(PEEK_ADOPTION_REGISTRY.every((e) => e.status !== "pending")).toBe(true);
  });

  test("scanDirectStreamReads finds no feature-code bypasses", async () => {
    const { scanDirectStreamReads } = await import("../src/lib/tochange-tracker.ts");
    const hits = await scanDirectStreamReads(REPO_ROOT);
    expect(hits).toEqual([]);
  });
});
