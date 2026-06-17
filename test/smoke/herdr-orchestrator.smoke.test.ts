import { describe, expect, test } from "bun:test";
import { join } from "path";
import { invokeTool } from "../../src/lib/tool-runner.ts";
import { REPO_ROOT } from "../helpers.ts";
import {
  compareOrchestratorConfigParity,
  validateOrchestratorAllowlistCoversRoutes,
} from "../../src/lib/scope-preflight.ts";

const ORCHESTRATOR = join(REPO_ROOT, "src/bin/herdr-orchestrator.ts");

describe("herdr-orchestrator smoke", () => {
  test("status --json reports enabled orchestrator for kimi-toolchain", async () => {
    const result = await invokeTool(ORCHESTRATOR, ["status", ".", "--json"], {
      cwd: REPO_ROOT,
      timeoutMs: 30_000,
    });
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout.trim()) as {
      ok: boolean;
      projectPath: string;
      config: {
        enabled: boolean;
        handoffFrom: string;
        handoffTo: string;
        events: { enabled: boolean; allowlist: string[] };
      };
      agents: unknown[];
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.projectPath).toContain("kimi-toolchain");
    expect(parsed.config.enabled).toBe(true);
    expect(parsed.config.handoffFrom).toBe("kimi");
    expect(parsed.config.handoffTo).toBe("codex");
    expect(parsed.config.events.enabled).toBe(true);
    expect(parsed.config.events.allowlist).toContain("pane.agent_status_changed");

    const parity = compareOrchestratorConfigParity(REPO_ROOT, parsed.config);
    expect(parity.ok).toBe(true);

    const routes = validateOrchestratorAllowlistCoversRoutes(parsed.config.events.allowlist);
    expect(routes.ok).toBe(true);
  }, 30_000);

  test("status lists agents when HERDR_ENV=1", async () => {
    if (Bun.env.HERDR_ENV !== "1") return;

    const result = await invokeTool(ORCHESTRATOR, ["status", "."], {
      cwd: REPO_ROOT,
      timeoutMs: 30_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Handoff:");
    expect(result.stdout).toMatch(/kimi|codex/);
  }, 30_000);
});
