// .implemented:peek-tests
import { describe, expect, test } from "bun:test";
import { peekPromise, peekPromiseStatus } from "../src/lib/bun-utils.ts";
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
  });

  test("scanTochangeMarkers finds peek adoption markers", async () => {
    const markers = await scanTochangeMarkers(REPO_ROOT);
    const ids = new Set(markers.map((m) => m.id));
    expect(ids.has("peek-wrapper")).toBe(true);
    expect(ids.has("tool-runner-inflight")).toBe(true);
    expect(ids.has("governor-cache-dedup")).toBe(true);
  });

  test("auditPeekAdoption registry is complete", async () => {
    const report = await auditPeekAdoption(REPO_ROOT);
    expect(report.missingMarkers).toEqual([]);
    expect(report.orphanMarkers).toEqual([]);
    expect(report.duplicateIds).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.implemented.map((m) => m.id)).toContain("peek-wrapper");
    expect(report.pending.map((m) => m.id)).toContain("tool-runner-inflight");
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
