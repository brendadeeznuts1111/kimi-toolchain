import { join } from "path";
import { describe, expect, test } from "bun:test";
import { REPO_ROOT } from "./helpers.ts";
import {
  BUN_UPSTREAM_CLI_SECTIONS,
  BUN_UPSTREAM_TEST_CLI_TREE_URL,
  BUN_UPSTREAM_TEST_COMMIT,
  BUN_UPSTREAM_TEST_REFS,
  BUN_UPSTREAM_TEST_TREE_URL,
  buildUpstreamCliSectionRows,
  buildUpstreamTestRefRows,
  upstreamBlobUrl,
  upstreamTreeUrl,
} from "../src/lib/bun-upstream-test-refs.ts";

describe("bun-upstream-test-refs", () => {
  test("pins oven-sh/bun test tree commit", () => {
    expect(BUN_UPSTREAM_TEST_COMMIT).toHaveLength(40);
    expect(BUN_UPSTREAM_TEST_TREE_URL).toContain(BUN_UPSTREAM_TEST_COMMIT);
    expect(BUN_UPSTREAM_TEST_TREE_URL).toEndWith("/test");
    expect(BUN_UPSTREAM_TEST_CLI_TREE_URL).toEndWith("/test/cli");
  });

  test("cli section index covers test/cli top-level entries", () => {
    const rows = buildUpstreamCliSectionRows();
    expect(rows).toHaveLength(BUN_UPSTREAM_CLI_SECTIONS.length);
    expect(BUN_UPSTREAM_CLI_SECTIONS.length).toBe(17);
    expect(rows.some((r) => r.path === "test/cli/update_interactive_formatting.test.ts")).toBe(
      true
    );
    expect(rows.some((r) => r.path === "test/cli/console-depth.test.ts")).toBe(true);
    expect(
      rows.some((r) => r.path === "test/cli/inspect" && r.notes.includes("not Bun.inspect.table"))
    ).toBe(true);
    expect(upstreamTreeUrl("test/cli/run")).toContain("/tree/");
  });

  test("every ref resolves to local kimi module + test", async () => {
    for (const ref of BUN_UPSTREAM_TEST_REFS) {
      expect(await Bun.file(join(REPO_ROOT, ref.kimiModule)).exists()).toBe(true);
      expect(await Bun.file(join(REPO_ROOT, ref.kimiTest)).exists()).toBe(true);
      const fixtures = "kimiFixtures" in ref ? (ref.kimiFixtures ?? []) : [];
      for (const fixture of fixtures) {
        expect(await Bun.file(join(REPO_ROOT, fixture)).exists()).toBe(true);
      }
      expect(ref.upstreamCases.length).toBeGreaterThan(0);
      expect(upstreamBlobUrl(ref.upstreamPath)).toContain(ref.upstreamPath);
    }
  });

  test("buildUpstreamTestRefRows matches catalog size", () => {
    const rows = buildUpstreamTestRefRows();
    expect(rows).toHaveLength(5);
    expect(
      rows.some((r) => r.id === "web.globals" && r.upstreamPath.includes("globals.test.js"))
    ).toBe(true);
    expect(BUN_UPSTREAM_TEST_REFS.find((r) => r.id === "console.table")?.kimiFixtures?.[0]).toBe(
      "test/fixtures/console-table-json-fixture.json"
    );
  });
});
