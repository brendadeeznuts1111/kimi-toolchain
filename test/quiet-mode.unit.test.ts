import { describe, expect, it } from "bun:test";
import { ensureQuietEnv, isQuietMode, parseBunTestSummary } from "../src/lib/quiet-mode.ts";
import { withClearedEnv, withEnv } from "./helpers.ts";

const QUIET_KEYS = ["KIMI_QUIET", "KIMI_AGENT_SESSION"] as const;

describe("quiet-mode", () => {
  it("should enable quiet mode when KIMI_QUIET is set", () => {
    withClearedEnv(QUIET_KEYS, () => {
      withEnv({ KIMI_QUIET: "1" }, () => {
        expect(isQuietMode()).toBe(true);
      });
    });
  });

  it("should auto-enable quiet mode for agent sessions", () => {
    withClearedEnv(QUIET_KEYS, () => {
      withEnv({ KIMI_AGENT_SESSION: "agent-1" }, () => {
        ensureQuietEnv();
        expect(Bun.env.KIMI_QUIET).toBe("1");
        expect(isQuietMode()).toBe(true);
      });
    });
  });

  it("should parse bun test summary footer", () => {
    const summary = parseBunTestSummary(`
test/foo.unit.test.ts:
(pass) foo > bar

 419 pass
 0 fail
Ran 419 tests across 48 files. [3.08s]
`);
    expect(summary).toMatchObject({ pass: 419, fail: 0, files: 48, ms: 3080 });
  });
});
