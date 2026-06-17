import { describe, expect, test } from "bun:test";
import { join } from "path";
import { Effect } from "effect";
import {
  buildPropertyTableInventory,
  parseInventoryRootsArg,
  runPropertyTableInventoryEffect,
} from "../src/lib/property-table-inventory.ts";
import { captureStdout, testTempDir } from "./helpers.ts";

function writeInventoryConfig(
  dir: string,
  options: { name: string; schemaVersion: number; endpoints: Array<{ name: string; url: string }> }
): void {
  const lines = [
    `schemaVersion = ${options.schemaVersion}`,
    `name = "${options.name}"`,
    `scope = "project"`,
    "",
    ...options.endpoints.flatMap((endpoint) => [
      "[[endpoints]]",
      `name = "${endpoint.name}"`,
      `url = "${endpoint.url}"`,
      "",
    ]),
  ];
  Bun.write(join(dir, "dx.config.toml"), lines.join("\n"));
}

describe("property-table-inventory", () => {
  test("parseInventoryRootsArg splits comma-separated roots", () => {
    expect(parseInventoryRootsArg("., /tmp/other")).toEqual([".", "/tmp/other"]);
    expect(() => parseInventoryRootsArg("  ")).toThrow(/empty list/);
  });

  test("buildPropertyTableInventory merges rows from multiple roots", async () => {
    const rootA = testTempDir("inv-a-");
    const rootB = testTempDir("inv-b-");
    writeInventoryConfig(rootA, {
      name: "project-a",
      schemaVersion: 2,
      endpoints: [{ name: "alpha", url: "https://a.example/alpha" }],
    });
    writeInventoryConfig(rootB, {
      name: "project-b",
      schemaVersion: 3,
      endpoints: [{ name: "beta", url: "https://b.example/beta" }],
    });

    const payload = await buildPropertyTableInventory({
      table: "endpoints",
      roots: [rootA, rootB],
      argv: ["--add-metadata", "schemaVersion,name"],
    });

    expect(payload.rows).toHaveLength(2);
    expect(payload.columns).toContain("config.name");
    expect(payload.columns).toContain("schemaVersion");
    expect(
      payload.rows.some((row) => row.name === "alpha" && row["config.name"] === "project-a")
    ).toBe(true);
    expect(
      payload.rows.some((row) => row.name === "beta" && row["config.name"] === "project-b")
    ).toBe(true);
  });

  test("runPropertyTableInventoryEffect writes merged CSV to stdout", async () => {
    const rootA = testTempDir("inv-csv-a-");
    const rootB = testTempDir("inv-csv-b-");
    writeInventoryConfig(rootA, {
      name: "project-a",
      schemaVersion: 2,
      endpoints: [{ name: "alpha", url: "https://a.example/alpha" }],
    });
    writeInventoryConfig(rootB, {
      name: "project-b",
      schemaVersion: 3,
      endpoints: [{ name: "beta", url: "https://b.example/beta" }],
    });

    const capture = captureStdout();
    try {
      await Effect.runPromise(
        runPropertyTableInventoryEffect({
          table: "endpoints",
          roots: [rootA, rootB],
          argv: [
            "--add-metadata",
            "schemaVersion,name",
            "--columns",
            "name,schemaVersion,config.name",
          ],
        })
      );
    } finally {
      capture.restore();
    }

    const csv = capture.lines.join("");
    expect(csv).toContain("name,schemaVersion,config.name");
    expect(csv).toContain("alpha,2,project-a");
    expect(csv).toContain("beta,3,project-b");
  });

  test("runPropertyTableInventoryEffect requires --add-metadata", async () => {
    const root = testTempDir("inv-no-meta-");
    writeInventoryConfig(root, {
      name: "solo",
      schemaVersion: 1,
      endpoints: [{ name: "solo", url: "https://solo.example" }],
    });

    await expect(
      Effect.runPromise(
        runPropertyTableInventoryEffect({
          table: "endpoints",
          roots: [root],
          argv: [],
        })
      )
    ).rejects.toThrow(/requires --add-metadata/);
  });
});
