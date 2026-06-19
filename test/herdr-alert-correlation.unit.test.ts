import { describe, expect, test } from "bun:test";
import { dirname, join } from "path";
import { makeDir, pathExists, writeText } from "../src/lib/bun-io.ts";
import {
  applyAlertDedupe,
  correlateAgentStatusChanged,
  loadAlertDedupeState,
} from "../src/lib/herdr-alert-correlation.ts";
import type { TaxonomyHit } from "../src/lib/herdr-log-classify.ts";
import {
  herdrAlertDedupeLedgerPath,
  herdrServerLogPath,
  herdrTaxonomyHitsLedgerPath,
} from "../src/lib/paths.ts";
import { cleanupPath, REPO_ROOT, withIsolatedHome } from "./helpers.ts";

const TAXONOMY_PATH = join(REPO_ROOT, "error-taxonomy.yml");

describe("herdr-alert-correlation", () => {
  test("applyAlertDedupe is read-only without recordEmits", () => {
    const map = new Map<string, number>();
    const hits: TaxonomyHit[] = [
      {
        taxonomyId: "herdr_socket_saturation",
        categoryName: "Herdr socket saturation",
        severity: "warn",
        pid: 42,
        classifiedAt: new Date().toISOString(),
        source: "herdr-server",
      },
    ];
    const correlated = applyAlertDedupe(hits, map, 1_000_000, false);
    expect(correlated[0]?.alertEligible).toBe(true);
    expect(map.size).toBe(0);
  });

  test("correlateAgentStatusChanged ingests server log and attaches hits", async () => {
    await withIsolatedHome(async (home) => {
      const logPath = herdrServerLogPath(home);
      makeDir(join(home, ".config", "herdr"), { recursive: true });
      writeText(
        logPath,
        "herdr: protocol error: I/O error: Resource temporarily unavailable (os error 35)\n"
      );

      const correlation = await correlateAgentStatusChanged(
        { pane_id: "wB:p6F", agent_status: "idle", workspace_id: "wB" },
        { home, tail: 20, dedupeState: new Map(), taxonomyPath: TAXONOMY_PATH }
      );

      expect(correlation.paneId).toBe("wB:p6F");
      expect(correlation.agentStatus).toBe("idle");
      expect(correlation.hits.some((h) => h.taxonomyId === "herdr_socket_saturation")).toBe(true);
      expect(pathExists(herdrTaxonomyHitsLedgerPath())).toBe(true);
      cleanupPath(join(home, ".config"));
      cleanupPath(join(home, ".kimi-code"));
    });
  });

  test("loadAlertDedupeState restores bucket timestamps", async () => {
    await withIsolatedHome(async () => {
      const path = herdrAlertDedupeLedgerPath();
      makeDir(dirname(path), { recursive: true });
      writeText(
        path,
        `${JSON.stringify({
          bucketKey: "herdr_socket_saturation:42:1",
          taxonomyId: "herdr_socket_saturation",
          pid: 42,
          emittedAtMs: 9_000_000,
        })}\n`
      );
      const state = loadAlertDedupeState(path);
      expect(state.get("herdr_socket_saturation:42:1")).toBe(9_000_000);
      cleanupPath(join(path, ".."));
    });
  });
});
