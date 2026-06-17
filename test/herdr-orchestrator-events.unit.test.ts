import { describe, expect, test } from "bun:test";
import {
  normalizeHerdrEventName,
  routeOrchestratorEvent,
} from "../src/lib/herdr-orchestrator-events.ts";
import {
  DEFAULT_ORCHESTRATOR_EVENT_ALLOWLIST,
  parseOrchestratorEventsSection,
  resolveOrchestratorConfig,
} from "../src/lib/herdr-orchestrator-config.ts";
import type { HerdrProjectConfig } from "../src/lib/herdr-project-config.ts";

describe("herdr-orchestrator-events", () => {
  test("normalizeHerdrEventName maps snake_case to dot notation", () => {
    expect(normalizeHerdrEventName("workspace_updated")).toBe("workspace.updated");
    expect(normalizeHerdrEventName("pane.agent_status_changed")).toBe("pane.agent_status_changed");
  });

  test("routeOrchestratorEvent maps workspace.updated to context-sync", () => {
    const routed = routeOrchestratorEvent(
      { event: "workspace_updated", data: { workspace_id: "w1" } },
      [...DEFAULT_ORCHESTRATOR_EVENT_ALLOWLIST]
    );
    expect(routed?.action).toBe("context-sync");
  });

  test("routeOrchestratorEvent maps effect.gates.changed metadata to react", () => {
    const routed = routeOrchestratorEvent(
      {
        event: "pane.agent_status_changed",
        data: { custom_status: "effect.gates.changed", workspace_id: "w1" },
      },
      [...DEFAULT_ORCHESTRATOR_EVENT_ALLOWLIST]
    );
    expect(routed?.action).toBe("react");
    expect(routed?.reason).toBe("effect.gates.changed");
  });

  test("routeOrchestratorEvent maps reviewer.feedback.processed to context-sync", () => {
    const routed = routeOrchestratorEvent(
      {
        event: "pane.agent_status_changed",
        data: { custom_status: "reviewer.feedback.processed", pane_id: "wB:p99" },
      },
      [...DEFAULT_ORCHESTRATOR_EVENT_ALLOWLIST]
    );
    expect(routed?.action).toBe("context-sync");
    expect(routed?.reason).toBe("reviewer.feedback.processed");
  });

  test("routeOrchestratorEvent respects allowlist", () => {
    const routed = routeOrchestratorEvent({ event: "pane.agent_status_changed", data: {} }, [
      "workspace.updated",
    ]);
    expect(routed).toBeNull();
  });

  test("parseOrchestratorEventsSection reads nested config", () => {
    const parsed = parseOrchestratorEventsSection({
      enabled: true,
      debounceMs: 1500,
      allowlist: ["workspace.updated"],
      watchGit: false,
    });
    expect(parsed.debounceMs).toBe(1500);
    expect(parsed.allowlist).toEqual(["workspace.updated"]);
    expect(parsed.watchGit).toBe(false);
  });

  test("resolveOrchestratorConfig includes events defaults", () => {
    const config = {
      schemaVersion: 1,
      enabled: true,
      workspaceLabel: "demo",
      primaryAgent: "kimi",
      secondaryAgents: ["codex"],
      shellPane: true,
      shellSplit: "right" as const,
      bootstrap: [],
      session: "",
      agentsTab: null,
      tabs: [],
      sourcePath: null,
    } satisfies HerdrProjectConfig;

    const resolved = resolveOrchestratorConfig(config);
    expect(resolved.events.enabled).toBe(true);
    expect(resolved.events.debounceMs).toBe(2000);
  });
});
