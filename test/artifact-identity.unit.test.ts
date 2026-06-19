import { describe, expect, test } from "bun:test";
import { resolveIdentityContext } from "../src/lib/artifact-identity.ts";
import { generateRunId } from "../src/lib/artifact-store.ts";

describe("artifact-identity", () => {
  test("resolveIdentityContext always returns a runId", () => {
    const prev = Bun.env.KIMI_RUN_ID;
    delete Bun.env.KIMI_RUN_ID;
    try {
      const ctx = resolveIdentityContext();
      expect(ctx.runId).toMatch(/^run_/);
    } finally {
      if (prev === undefined) delete Bun.env.KIMI_RUN_ID;
      else Bun.env.KIMI_RUN_ID = prev;
    }
  });

  test("resolveIdentityContext prefers explicit runId over env", () => {
    const prev = Bun.env.KIMI_RUN_ID;
    Bun.env.KIMI_RUN_ID = "run_from_env";
    try {
      expect(resolveIdentityContext({ runId: "run_explicit" }).runId).toBe("run_explicit");
    } finally {
      if (prev === undefined) delete Bun.env.KIMI_RUN_ID;
      else Bun.env.KIMI_RUN_ID = prev;
    }
  });

  test("resolveIdentityContext reads session and Herdr fields from env", () => {
    const prev = {
      KIMI_CODE_SESSION: Bun.env.KIMI_CODE_SESSION,
      HERDR_WORKSPACE_ID: Bun.env.HERDR_WORKSPACE_ID,
      HERDR_PANE_ID: Bun.env.HERDR_PANE_ID,
      KIMI_RUN_ID: Bun.env.KIMI_RUN_ID,
    };
    Bun.env.KIMI_CODE_SESSION = "sess_1";
    Bun.env.HERDR_WORKSPACE_ID = "ws_1";
    Bun.env.HERDR_PANE_ID = "pane_1";
    Bun.env.KIMI_RUN_ID = generateRunId();
    try {
      const ctx = resolveIdentityContext();
      expect(ctx.sessionId).toBe("sess_1");
      expect(ctx.workspaceId).toBe("ws_1");
      expect(ctx.paneId).toBe("pane_1");
      expect(ctx.agentId).toBe("pane_1");
      expect(ctx.runId).toBe(Bun.env.KIMI_RUN_ID);
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete Bun.env[key];
        else Bun.env[key] = value;
      }
    }
  });
});
