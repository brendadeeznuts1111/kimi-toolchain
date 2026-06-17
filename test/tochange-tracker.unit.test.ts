// .implemented:peek-tests
import { describe, expect, test } from "bun:test";
import { dedupInflight, peekPromise, peekPromiseStatus } from "../src/lib/bun-utils.ts";
import { cachedDoctor, clearGovernorCacheInflight } from "../src/lib/governor-cache.ts";
import { clearProcessCache, getCachedPsAsync } from "../src/lib/proc-cache.ts";
import { clearInvokeCommandInflight, invokeCommand } from "../src/lib/tool-runner.ts";
import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";
import { join } from "path";
import { testTempDir } from "./helpers.ts";
import {
  auditTochangeMarkers,
  auditPeekAdoption,
  PEEK_ADOPTION_REGISTRY,
  scanTochangeMarkers,
} from "../src/lib/tochange-tracker.ts";

const REPO_ROOT = import.meta.dir + "/..";

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

  test("scanTochangeMarkers finds peek adoption markers", async () => {
    const markers = await scanTochangeMarkers(REPO_ROOT);
    const ids = new Set(markers.map((m) => m.id));
    for (const id of [
      "peek-wrapper",
      "tool-runner-inflight",
      "governor-cache-dedup",
      "proc-cache-async",
      "memory-budget-peek",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  test("auditPeekAdoption registry is complete with zero pending", async () => {
    const report = await auditPeekAdoption(REPO_ROOT);
    expect(report.missingMarkers).toEqual([]);
    expect(report.orphanMarkers).toEqual([]);
    expect(report.duplicateIds).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.pending).toHaveLength(0);
    expect(report.implemented.map((m) => m.id)).toContain("peek-wrapper");
    expect(report.implemented.map((m) => m.id)).toContain("tool-runner-inflight");
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
      `const n = parseInt(await Bun.file(process.env.COUNTER_FILE!).text());
await Bun.write(process.env.COUNTER_FILE!, String(n + 1));
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

  test("auditTochangeMarkers flags missing registry ids", () => {
    const report = auditTochangeMarkers(
      [{ id: "peek-wrapper", kind: "implemented", file: "x.ts", line: 1, text: "" }],
      PEEK_ADOPTION_REGISTRY
    );
    expect(report.missingMarkers.length).toBeGreaterThan(0);
    expect(report.ok).toBe(false);
  });
});
