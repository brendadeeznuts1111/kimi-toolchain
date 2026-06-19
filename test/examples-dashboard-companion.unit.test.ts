import { describe, expect, test } from "bun:test";
import {
  DEFAULT_EXAMPLES_DASHBOARD_URL,
  fetchExamplesDashboardHealth,
  resolveExamplesDashboardUrl,
} from "../src/lib/examples-dashboard-companion.ts";
import { REPO_ROOT, withEnv } from "./helpers.ts";

describe("examples-dashboard-companion", () => {
  test("resolveExamplesDashboardUrl prefers HERDR_EXAMPLES_DASHBOARD_URL", async () => {
    await withEnv({ HERDR_EXAMPLES_DASHBOARD_URL: "http://127.0.0.1:9090" }, async () => {
      const url = await resolveExamplesDashboardUrl(REPO_ROOT);
      expect(url).toBe("http://127.0.0.1:9090/");
    });
  });

  test("resolveExamplesDashboardUrl reads dx.config [herdr.orchestrator.dashboard].examplesUrl", async () => {
    await withEnv({ HERDR_EXAMPLES_DASHBOARD_URL: undefined }, async () => {
      const url = await resolveExamplesDashboardUrl(REPO_ROOT);
      expect(url).toBe("http://127.0.0.1:5678/");
    });
  });

  test("resolveExamplesDashboardUrl falls back to default", async () => {
    await withEnv({ HERDR_EXAMPLES_DASHBOARD_URL: undefined }, async () => {
      const url = await resolveExamplesDashboardUrl("/nonexistent-project");
      expect(url).toBe(DEFAULT_EXAMPLES_DASHBOARD_URL);
    });
  });

  test("fetchExamplesDashboardHealth reports invalid URL", async () => {
    const payload = await fetchExamplesDashboardHealth("not-a-url");
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("invalid examples dashboard URL");
  });
});
