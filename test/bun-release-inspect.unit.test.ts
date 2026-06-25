import { inspect } from "bun";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import consoleTableJsonFixture from "../test/fixtures/console-table-json-fixture.json";
import { buildReleaseHistoryRows } from "../src/lib/bun-release-registry.ts";
import {
  formatReleaseHistoryTable,
  RELEASE_BREAKING_PROPERTIES,
  RELEASE_HISTORY_SUMMARY_PROPERTIES,
  RELEASE_TABLE_PRINTER_OPTS,
  renderReleaseTable,
  resolveReleaseTableProperties,
} from "../src/lib/bun-release-inspect.ts";

const rows = buildReleaseHistoryRows();

const propertyVariants: Array<[string, readonly string[] | undefined]> = [
  ["full", undefined],
  ["summary", RELEASE_HISTORY_SUMMARY_PROPERTIES],
  ["breaking", RELEASE_BREAKING_PROPERTIES],
  ["version+tag", ["version", "tag"]],
];

describe("bun-release-inspect resolve-release-table-properties", () => {
  test("--breaking expands to breaking preset", () => {
    expect(resolveReleaseTableProperties(undefined, { breaking: true })).toEqual(
      RELEASE_BREAKING_PROPERTIES
    );
  });

  test("--properties version,breaking expands to breaking preset", () => {
    expect(resolveReleaseTableProperties(["version", "breaking"])).toEqual(
      RELEASE_BREAKING_PROPERTIES
    );
  });

  test("breaking preset preserves extra columns", () => {
    expect(resolveReleaseTableProperties(["version", "breaking", "tag"])).toEqual([
      ...RELEASE_BREAKING_PROPERTIES,
      "tag",
    ]);
  });

  test("--summary expands to summary preset", () => {
    expect(resolveReleaseTableProperties(undefined, { summary: true })).toEqual(
      RELEASE_HISTORY_SUMMARY_PROPERTIES
    );
  });
});

describe("renderReleaseTable (TablePrinter depth:0)", () => {
  propertyVariants.forEach(([label, properties]) => {
    test(`${label} matches inspect.table with depth 0`, () => {
      const opts = { colors: false, sorted: true, depth: 0 };
      const rendered = renderReleaseTable(rows, properties, opts);
      const expected =
        properties === undefined
          ? inspect.table(rows, opts)
          : inspect.table(rows, [...properties], opts);
      expect(rendered).toBe(expected);
    });
  });

  test("non-object number follows console.table fallback", () => {
    expect(renderReleaseTable(42)).toBe(`${inspect(42)}\n`);
    expect(inspect.table(42 as never)).toBe("");
  });

  test("non-object string follows console.table fallback", () => {
    expect(renderReleaseTable("bun")).toBe("bun");
    expect(inspect.table("bun" as never)).toBe("");
  });

  test("console.table json fixture matches upstream TablePrinter output", () => {
    const actualOutput = renderReleaseTable(consoleTableJsonFixture, undefined, {
      colors: false,
      sorted: true,
      depth: 0,
    }).replaceAll("`", "'");
    expect(actualOutput).toContain("title");
    expect(actualOutput).toContain("state");
    expect(actualOutput).toContain("2060630898");
  });

  test("repeat 50 yields stable output", () => {
    const expected = renderReleaseTable(rows, RELEASE_HISTORY_SUMMARY_PROPERTIES, {
      colors: false,
      sorted: true,
      depth: 0,
    });
    for (let i = 0; i < 50; i++) {
      expect(
        renderReleaseTable(rows, RELEASE_HISTORY_SUMMARY_PROPERTIES, {
          colors: false,
          sorted: true,
          depth: 0,
        })
      ).toBe(expected);
    }
  });
});

describe("formatReleaseHistoryTable", () => {
  propertyVariants.forEach(([label, properties]) => {
    test(`${label} plain sorted table`, () => {
      const table = formatReleaseHistoryTable(rows, properties, RELEASE_TABLE_PRINTER_OPTS);
      const stripped = Bun.stripANSI(table);
      expect(stripped).toContain("version");
      expect(stripped).toContain(rows[0]!.version);
      expect(stripped).toContain(rows.at(-1)!.version);
      if (label === "breaking") expect(stripped).toContain("breakingCount");
      if (label === "version+tag") expect(stripped).toContain(rows.at(-1)!.tag);
    });
  });
});

describe("formatReleaseHistoryTable (ansi)", () => {
  test("summary with colors", () => {
    const table = formatReleaseHistoryTable(rows, RELEASE_HISTORY_SUMMARY_PROPERTIES, {
      colors: true,
      sorted: true,
      depth: 0,
    });
    expect(table).toContain("\x1b[0m\x1b[1mversion\x1b[0m");
    expect(Bun.stripANSI(table)).toContain(rows.at(-1)!.version);
  });
});

describe("formatReleaseHistoryTable (bad inputs)", () => {
  const badInputs: unknown[] = [null, undefined, true, false, Symbol(), "", "foobar", []];

  for (const input of badInputs) {
    test(`returns empty string for bad input (${String(input)})`, () => {
      expect(formatReleaseHistoryTable(input as never)).toBe("");
    });
  }

  test("returns empty string when called with no rows argument", () => {
    // @ts-expect-error — runtime guard
    expect(formatReleaseHistoryTable()).toBe("");
  });
});

describe.concurrent("release:info CLI", () => {
  const repoRoot = join(import.meta.dirname, "..");

  test("--properties version,breaking expands to breaking preset table", async () => {
    await using proc = Bun.spawn({
      cmd: [
        process.execPath,
        "run",
        "scripts/inspect-release-registry.ts",
        "--",
        "--properties",
        "version,breaking",
        "--quiet",
      ],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });

    const out = Bun.stripANSI(stdout);
    expect(out).toContain("breakingCount");
    expect(out).toContain("—");
    expect(out).toContain("bun build --compile NAPI regression");
    const current = rows.find((row) => row.role === "current")!;
    const previous = rows.find((row) => row.role === "previous")!;
    expect(out).toContain(
      `→ current ${current.version} · ${current.breakingCount === 0 ? "clean" : `${current.breakingCount} breaking`} · previous ${previous.version} (${previous.breakingCount === 0 ? "clean" : `${previous.breakingCount} breaking`})`
    );
    expect(out).toContain(
      formatReleaseHistoryTable(
        rows,
        RELEASE_BREAKING_PROPERTIES,
        RELEASE_TABLE_PRINTER_OPTS
      ).trim()
    );
  });
});
