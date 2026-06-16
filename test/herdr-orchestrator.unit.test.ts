import { describe, expect, test } from "bun:test";
import {
  parseHerdrOrchestratorSection,
  resolveOrchestratorConfig,
} from "../src/lib/herdr-orchestrator-config.ts";
import type { HerdrProjectConfig } from "../src/lib/herdr-project-config.ts";

describe("herdr-orchestrator", () => {
  test("parseHerdrOrchestratorSection reads nested orchestrator block", () => {
    const parsed = parseHerdrOrchestratorSection({
      orchestrator: {
        enabled: true,
        contextOnIdle: true,
        handoffFrom: "kimi",
        handoffTo: "codex",
        reviewerTab: "reviewer",
      },
    });
    expect(parsed?.handoffFrom).toBe("kimi");
    expect(parsed?.handoffTo).toBe("codex");
    expect(parsed?.reviewerTab).toBe("reviewer");
  });

  test("resolveOrchestratorConfig falls back to agentsTab roles", () => {
    const config = {
      schemaVersion: 1,
      enabled: true,
      workspaceLabel: "demo",
      primaryAgent: null,
      secondaryAgents: [],
      shellPane: true,
      shellSplit: "right" as const,
      bootstrap: [],
      session: "",
      agentsTab: {
        label: "agents",
        panes: [
          { role: "primary" as const, agent: "kimi" },
          { role: "secondary" as const, agent: "codex" },
        ],
      },
      tabs: [],
      sourcePath: null,
    } satisfies HerdrProjectConfig;

    const resolved = resolveOrchestratorConfig(config);
    expect(resolved.handoffFrom).toBe("kimi");
    expect(resolved.handoffTo).toBe("codex");
    expect(resolved.contextOnIdle).toBe(true);
  });
});
