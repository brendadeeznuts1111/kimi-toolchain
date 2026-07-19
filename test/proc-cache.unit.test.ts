import { describe, expect, test } from "bun:test";
import { collectOrphanCandidates, isOrphanCandidateCommand } from "../src/lib/proc-cache.ts";

describe("proc-cache", () => {
  describe("isOrphanCandidateCommand", () => {
    test("matches bun test variants", () => {
      expect(isOrphanCandidateCommand("bun test")).toBe(true);
      expect(isOrphanCandidateCommand("bun --no-orphans test --timeout 30000 --dots")).toBe(true);
      expect(isOrphanCandidateCommand("/Users/x/.bun/bin/bun test --isolate")).toBe(true);
      expect(isOrphanCandidateCommand("/private/tmp/bun-node-deadbeef/bun test --timeout 0")).toBe(
        true
      );
      expect(isOrphanCandidateCommand("bun test --test-worker --isolate")).toBe(true);
    });

    test("matches gate entry points", () => {
      expect(isOrphanCandidateCommand("bun run test")).toBe(true);
      expect(isOrphanCandidateCommand("bun run test:fast")).toBe(true);
      expect(isOrphanCandidateCommand("bun run check:fast")).toBe(true);
      expect(isOrphanCandidateCommand("/Users/x/.bun/bin/bun run scripts/check.ts --fast")).toBe(
        true
      );
      expect(isOrphanCandidateCommand("bun run scripts/test-fast.ts")).toBe(true);
    });

    test("matches legacy tool patterns", () => {
      expect(isOrphanCandidateCommand("bun install --frozen-lockfile")).toBe(true);
      expect(isOrphanCandidateCommand("tsc --noEmit")).toBe(true);
      expect(isOrphanCandidateCommand("bun run kimi-doctor --quick")).toBe(true);
    });

    test("rejects non-candidates and self", () => {
      expect(isOrphanCandidateCommand("vim test.ts")).toBe(false);
      expect(isOrphanCandidateCommand("bunx oxfmt --check .")).toBe(false);
      expect(isOrphanCandidateCommand("bun run src/bin/kimi-orphan-kill.ts")).toBe(false);
      expect(isOrphanCandidateCommand("/bin/bash -c bun test")).toBe(true); // wrapper still matches
    });
  });

  describe("collectOrphanCandidates", () => {
    const alive = () => true;
    const dead = () => false;

    test("flags parent-dead bun test processes past the age threshold", () => {
      const ps = [
        " 101 1 92.0 300 bun test",
        " 102 1 10.0 10 bun test", // too young
      ].join("\n");
      const orphans = collectOrphanCandidates(ps, { pidAlive: alive });
      expect(orphans.map((o) => o.pid)).toEqual([101]);
    });

    test("flags processes whose parent pid is dead", () => {
      const ps = " 201 5555 50.0 60 /Users/x/.bun/bin/bun --no-orphans test --dots";
      const orphans = collectOrphanCandidates(ps, { pidAlive: dead });
      expect(orphans.map((o) => o.pid)).toEqual([201]);
    });

    test("never flags processes with a live parent", () => {
      const ps = [
        " 301 4444 99.9 9999 bun test", // old + high CPU but parent alive → owned by its gate
        " 302 4444 5.0 9999 tsc --noEmit",
      ].join("\n");
      const orphans = collectOrphanCandidates(ps, { pidAlive: alive });
      expect(orphans).toEqual([]);
    });

    test("skips non-candidate commands and self references", () => {
      const ps = [
        ` ${process.pid} 1 90.0 300 bun test`, // self
        " 401 1 90.0 300 vim test.ts", // not a candidate
        " 402 1 90.0 300 bun run src/bin/kimi-orphan-kill.ts", // excluded
      ].join("\n");
      const orphans = collectOrphanCandidates(ps, { pidAlive: alive });
      expect(orphans).toEqual([]);
    });

    test("fast commands use the shorter age threshold", () => {
      const ps = [
        " 501 1 5.0 50 bun install --frozen-lockfile", // 50s ≥ 45s fast threshold
        " 502 1 5.0 40 bun install", // 40s < 45s
      ].join("\n");
      const orphans = collectOrphanCandidates(ps, { pidAlive: alive });
      expect(orphans.map((o) => o.pid)).toEqual([501]);
    });
  });
});
