import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { ensureQuietEnv, isQuietMode, parseBunTestSummary } from "../src/lib/quiet-mode.ts";

describe("quiet-mode", () => {
  let savedQuiet: string | undefined;
  let savedAgent: string | undefined;

  beforeEach(() => {
    savedQuiet = Bun.env.KIMI_QUIET;
    savedAgent = Bun.env.KIMI_AGENT_SESSION;
    delete Bun.env.KIMI_QUIET;
    delete Bun.env.KIMI_AGENT_SESSION;
  });

  afterEach(() => {
    if (savedQuiet === undefined) delete Bun.env.KIMI_QUIET;
    else Bun.env.KIMI_QUIET = savedQuiet;
    if (savedAgent === undefined) delete Bun.env.KIMI_AGENT_SESSION;
    else Bun.env.KIMI_AGENT_SESSION = savedAgent;
  });

  it("should enable quiet mode when KIMI_QUIET is set", () => {
    Bun.env.KIMI_QUIET = "1";
    expect(isQuietMode()).toBe(true);
  });

  it("should auto-enable quiet mode for agent sessions", () => {
    Bun.env.KIMI_AGENT_SESSION = "agent-1";
    ensureQuietEnv();
    expect(Bun.env.KIMI_QUIET).toBe("1");
    expect(isQuietMode()).toBe(true);
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
