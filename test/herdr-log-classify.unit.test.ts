import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
import { loadTaxonomy } from "../src/lib/error-taxonomy.ts";
import {
  classifyHerdrServerLogTail,
  classifyLogBlob,
  parsePidFromLogText,
} from "../src/lib/herdr-log-classify.ts";
import { herdrServerLogPath } from "../src/lib/paths.ts";
import { cleanupPath, REPO_ROOT, withIsolatedHome } from "./helpers.ts";

const TAXONOMY_PATH = join(REPO_ROOT, "error-taxonomy.yml");

describe("herdr-log-classify", () => {
  test("parsePidFromLogText reads herdr structured pid field", () => {
    expect(parsePidFromLogText('event="app.startup" pid=67151')).toBe(67151);
    expect(parsePidFromLogText("no pid here")).toBeNull();
  });

  test("classifyLogBlob batches and dedupes taxonomy categories", async () => {
    const taxonomy = await loadTaxonomy(TAXONOMY_PATH);
    const lines = [
      "noise line",
      "herdr: protocol error: I/O error: Resource temporarily unavailable (os error 35)",
      "duplicate saturation mention os error 35",
    ];
    const hits = classifyLogBlob(lines, taxonomy, { batchSize: 2, source: "herdr-server" });
    expect(hits.some((h) => h.taxonomyId === "herdr_socket_saturation")).toBe(true);
    expect(hits.filter((h) => h.taxonomyId === "herdr_socket_saturation")).toHaveLength(1);
  });

  test("classifyHerdrServerLogTail reads configured log path", async () => {
    await withIsolatedHome(async (home) => {
      const logPath = herdrServerLogPath(home);
      makeDir(join(home, ".config", "herdr"), { recursive: true });
      writeText(
        logPath,
        "INFO herdr pid=12345\nherdr: protocol error: I/O error: Resource temporarily unavailable (os error 35)\n"
      );
      const taxonomy = await loadTaxonomy(TAXONOMY_PATH);
      const { hits } = await classifyHerdrServerLogTail(taxonomy, { tail: 10, home });
      expect(hits.some((h) => h.taxonomyId === "herdr_socket_saturation")).toBe(true);
      expect(hits[0]?.pid).toBe(12345);
      cleanupPath(join(home, ".config"));
    });
  });
});
