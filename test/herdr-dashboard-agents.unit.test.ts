import { describe, expect, test } from "bun:test";
import { getDashboardAgents } from "../src/lib/herdr-dashboard-agents.ts";
import { parseOrchestratorDashboardSection } from "../src/lib/herdr-orchestrator-config.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("herdr-dashboard-agents", () => {
  test("getDashboardAgents returns payload for kimi-toolchain", async () => {
    const payload = await getDashboardAgents(REPO_ROOT);
    expect(payload.projectPath).toBe(REPO_ROOT);
    expect(Array.isArray(payload.agents)).toBe(true);
    expect(typeof payload.fetchedAt).toBe("string");
  });

  test("parseOrchestratorDashboardSection reads stale_ms, sse_poll_ms, and poll_hint_ms", () => {
    const parsed = parseOrchestratorDashboardSection({
      stale_ms: 20_000,
      sse_poll_ms: 3_000,
      poll_hint_ms: 8_000,
    });
    expect(parsed.staleMs).toBe(20_000);
    expect(parsed.ssePollMs).toBe(3_000);
    expect(parsed.pollHintMs).toBe(8_000);
  });

  test("parseOrchestratorDashboardSection falls back sse_poll_ms to poll_hint_ms", () => {
    const parsed = parseOrchestratorDashboardSection({ poll_hint_ms: 12_000 });
    expect(parsed.ssePollMs).toBe(12_000);
    expect(parsed.pollHintMs).toBe(12_000);
  });

  test("parseOrchestratorDashboardSection reads persist_profile and profile_dir", () => {
    const parsed = parseOrchestratorDashboardSection({
      persist_profile: true,
      profile_dir: "/tmp/herdr-dashboard-profile",
    });
    expect(parsed.persistProfile).toBe(true);
    expect(parsed.profileDir).toBe("/tmp/herdr-dashboard-profile");
  });

  test("parseOrchestratorDashboardSection reads webview default", () => {
    const parsed = parseOrchestratorDashboardSection({ webview: true });
    expect(parsed.webview).toBe(true);
  });
});
