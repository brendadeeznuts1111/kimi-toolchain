import { describe, expect, test } from "bun:test";
import { REPO_ROOT } from "./helpers.ts";
import {
  compareOrchestratorConfigParity,
  validateOrchestratorAllowlistCoversRoutes,
} from "../src/lib/scope-preflight.ts";
import { resolveOrchestratorConfig } from "../src/lib/herdr-orchestrator-config.ts";
import { discoverHerdrProjectConfig } from "../src/lib/herdr-project-config.ts";
import { TOML } from "bun";
import { readText } from "../src/lib/bun-io.ts";

describe("scope-preflight", () => {
  test("validateOrchestratorAllowlistCoversRoutes fails when event missing", () => {
    const result = validateOrchestratorAllowlistCoversRoutes(["workspace.updated"]);
    expect(result.ok).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  test("compareOrchestratorConfigParity matches dx.config.toml for repo", () => {
    const herdr = discoverHerdrProjectConfig(REPO_ROOT);
    expect(herdr).not.toBeNull();
    const doc = herdr?.sourcePath
      ? (TOML.parse(readText(herdr.sourcePath)) as Record<string, unknown>)
      : null;
    const expected = resolveOrchestratorConfig({ ...herdr!, projectPath: REPO_ROOT }, doc);
    const parity = compareOrchestratorConfigParity(REPO_ROOT, {
      enabled: expected.enabled,
      handoffFrom: expected.handoffFrom,
      handoffTo: expected.handoffTo,
      contextOnIdle: expected.contextOnIdle,
      events: expected.events,
    });
    expect(parity.ok).toBe(true);
  });

  test("repo allowlist from config covers routed events", () => {
    const herdr = discoverHerdrProjectConfig(REPO_ROOT);
    expect(herdr).not.toBeNull();
    const doc = herdr?.sourcePath
      ? (TOML.parse(readText(herdr.sourcePath)) as Record<string, unknown>)
      : null;
    const expected = resolveOrchestratorConfig({ ...herdr!, projectPath: REPO_ROOT }, doc);
    const routes = validateOrchestratorAllowlistCoversRoutes(expected.events.allowlist ?? []);
    expect(routes.ok).toBe(true);
  });
});
