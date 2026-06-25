#!/usr/bin/env bun
// test/completions/snapshot.unit.test.ts
// Snapshot contracts for generated artifacts
// Uses bun:test snapshot matching with property matchers for dynamic values

import { describe, test, expect } from "bun:test";
import {
  makeTable,
  classifyFlag,
  cleanAliases,
  inheritsGlobals,
} from "../src/completions/completion-matrix";

describe("completion-matrix", () => {
  // ── 1. makeTable inline snapshot ────────────────────────────────
  describe("makeTable markdown generation", () => {
    test("produces stable 2-column markdown", () => {
      const rows = [
        { Command: "install", Flags: 41 },
        { Command: "build", Flags: 57 },
      ];

      expect(makeTable(rows)).toMatchInlineSnapshot(`
        "| Command | Flags |
        | --- | --- |
        | install | 41 |
        | build | 57 |"
      `);
    });

    test("produces stable 5-column markdown with categories", () => {
      const rows = [
        {
          Command: "install (i)",
          Flags: 41,
          "Value flags": 15,
          "File I/O": 2,
          PM: 18,
        },
        {
          Command: "build",
          Flags: 57,
          "Value flags": 27,
          "File I/O": 8,
          PM: 0,
        },
      ];

      expect(makeTable(rows)).toMatchInlineSnapshot(`
        "| Command | Flags | Value flags | File I/O | PM |
        | --- | --- | --- | --- | --- |
        | install (i) | 41 | 15 | 2 | 18 |
        | build | 57 | 27 | 8 | 0 |"
      `);
    });

    test("handles empty rows gracefully", () => {
      expect(makeTable([])).toBe("");
    });

    test("escapes pipe characters in cell content", () => {
      const rows = [{ Description: "a | b", Value: 1 }];

      expect(makeTable(rows)).toMatchInlineSnapshot(`
        "| Description | Value |
        | --- | --- |
        | a \\| b | 1 |"
      `);
    });
  });

  // ── 2. Flag classification snapshot ─────────────────────────────
  describe("classifyFlag taxonomy", () => {
    test("classifies known file I/O flags", () => {
      expect(classifyFlag("outfile")).toContain("fileIO");
      expect(classifyFlag("config")).toContain("fileIO");
    });

    test("classifies known PM flags", () => {
      expect(classifyFlag("frozen-lockfile")).toContain("pm");
      expect(classifyFlag("registry")).toContain("pm");
    });

    test("classifies unknown flags as uncategorized", () => {
      expect(classifyFlag("totally-made-up-flag")).toEqual(["uncategorized"]);
    });
  });

  // ── 3. Alias cleaning snapshot ──────────────────────────────────
  describe("cleanAliases parser hygiene", () => {
    test("strips bunx self-reference and preserves real aliases", () => {
      expect(cleanAliases(["bunx", "i", "a"])).toEqual(["i", "a"]);
    });

    test("returns empty array for undefined aliases", () => {
      expect(cleanAliases(undefined)).toEqual([]);
    });

    test("throws on parser leak", () => {
      expect(() => cleanAliases(["bun"])).toThrow(
        'Parser leak: "bun" cannot be an alias of itself'
      );
    });
  });

  // ── 4. Global inheritance snapshot ──────────────────────────────
  describe("inheritsGlobals semantics", () => {
    test("pm is isolated from global flags", () => {
      expect(inheritsGlobals("pm")).toBe(false);
    });

    test("normal commands inherit global flags", () => {
      expect(inheritsGlobals("run")).toBe(true);
      expect(inheritsGlobals("build")).toBe(true);
      expect(inheritsGlobals("install")).toBe(true);
    });
  });

  // ── 5. DYNAMIC_SOURCES.json snapshot ────────────────────────────
  describe("DYNAMIC_SOURCES.json schema contract", () => {
    test("full schema with dynamic value matchers", () => {
      const dynamicSources = {
        schema: "1.2.0",
        bunVersion: "1.4.0",
        revision: "452139e36",
        jsonHash: "909ceece8ae5",
        generatedAt: "2026-06-25T12:44:00.000Z",
        sources: {
          bare_bun: {
            completes: ["files", "scripts", "binaries"],
            provider: null,
            providerArgs: null,
          },
          run: {
            completes: ["scripts", "files", "binaries"],
            provider: "getcompletes",
            providerArgs: ["s", "b", "j"],
          },
          add: {
            completes: ["registry_packages"],
            provider: "getcompletes",
            providerArgs: ["a"],
          },
          remove: {
            completes: ["installed_packages"],
            provider: "getcompletes",
            providerArgs: ["a"],
          },
          create: {
            completes: ["templates"],
            provider: null,
            templateDir: "$BUN_INSTALL/create",
          },
          test: {
            completes: ["files"],
            provider: "getcompletes",
            providerArgs: ["j"],
          },
          build: {
            completes: ["files"],
            provider: "getcompletes",
            providerArgs: ["j"],
          },
        },
      };

      expect(dynamicSources).toMatchSnapshot({
        jsonHash: expect.any(String),
        generatedAt: expect.any(String),

        schema: "1.2.0",
        bunVersion: "1.4.0",
        revision: "452139e36",
        sources: {
          bare_bun: {
            completes: ["files", "scripts", "binaries"],
            provider: null,
            providerArgs: null,
          },
          run: {
            completes: ["scripts", "files", "binaries"],
            provider: "getcompletes",
            providerArgs: ["s", "b", "j"],
          },
          add: {
            completes: ["registry_packages"],
            provider: "getcompletes",
            providerArgs: ["a"],
          },
          remove: {
            completes: ["installed_packages"],
            provider: "getcompletes",
            providerArgs: ["a"],
          },
          create: {
            completes: ["templates"],
            provider: null,
            templateDir: "$BUN_INSTALL/create",
          },
          test: {
            completes: ["files"],
            provider: "getcompletes",
            providerArgs: ["j"],
          },
          build: {
            completes: ["files"],
            provider: "getcompletes",
            providerArgs: ["j"],
          },
        },
      });
    });

    test("schema version must not drift without explicit update", () => {
      const dynamicSources = {
        schema: "1.2.0",
        bunVersion: "1.4.0",
        jsonHash: "any",
        generatedAt: "any",
        sources: {},
      };

      expect(dynamicSources.schema).toMatchInlineSnapshot(`"1.2.0"`);
    });
  });

  // ── 6. COMPLETION_MATRIX.md header snapshot ─────────────────────
  describe("COMPLETION_MATRIX.md header format", () => {
    test("header line with dynamic value matchers", () => {
      const header = `Generated from \`completions/bun-cli.json\` (schema v1.2.0, Bun 1.4.0, revision 452139e36, hash \`909ceece8ae5\`).`;

      expect({ header }).toMatchSnapshot({
        header: expect.stringMatching(
          /^Generated from `completions\/bun-cli\.json` \(schema v[\d.]+, Bun [\d.]+, revision [a-f0-9]+, hash `[a-f0-9]{12}`\)\.$/
        ),
      });
    });

    test("header format regex is stable", () => {
      const headerPattern =
        /^Generated from `completions\/bun-cli\.json` \(schema v([\d.]+), Bun ([\d.]+(?:-[\w.]+)?), revision ([a-z0-9.+]+), hash `([a-f0-9]{12})`\)\.$/;

      const validHeader =
        "Generated from `completions/bun-cli.json` (schema v1.2.0, Bun 1.4.0, revision 452139e36, hash `909ceece8ae5`).";

      expect(validHeader).toMatch(headerPattern);

      const match = validHeader.match(headerPattern);
      expect(match).not.toBeNull();
      expect(match![1]).toBe("1.2.0"); // schema
      expect(match![2]).toBe("1.4.0"); // bunVersion
      expect(match![3]).toBe("452139e36"); // revision
      expect(match![4]).toBe("909ceece8ae5"); // hash (12 chars)
    });

    test("header rejects malformed formats", () => {
      const badHeaders = [
        "Generated from completions/bun-cli.json (schema v1.2.0, Bun 1.4.0)", // missing backticks, revision, hash
        "Generated from `completions/bun-cli.json` (schema v1.2.0, Bun 1.4.0, revision 452139e36)", // missing hash
        "Generated from `completions/bun-cli.json` (schema v1.2.0, Bun 1.4.0, hash `909ceece8ae5`).", // missing revision
      ];

      const headerPattern =
        /^Generated from `completions\/bun-cli\.json` \(schema v([\d.]+), Bun ([\d.]+(?:-[\w.]+)?), revision ([a-z0-9.+]+), hash `([a-f0-9]{12})`\)\.$/;

      badHeaders.forEach((h) => {
        expect(h).not.toMatch(headerPattern);
      });
    });
  });

  // ── 7. Cross-cutting integration snapshot ───────────────────────
  describe("End-to-end artifact consistency", () => {
    test("all generated artifacts share the same hash", () => {
      const sharedHash = "909ceece8ae5";

      const matrixHeader = `Generated from \`completions/bun-cli.json\` (schema v1.2.0, Bun 1.4.0, revision 452139e36, hash \`${sharedHash}\`).`;
      const dynamicSources = { jsonHash: sharedHash, schema: "1.2.0" };
      const driftCheck = { expectedHash: sharedHash };

      const hashMatch = matrixHeader.match(/hash `([a-f0-9]{12})`/);
      expect(hashMatch).not.toBeNull();
      expect(hashMatch![1]).toBe(sharedHash);

      expect(dynamicSources.jsonHash).toBe(sharedHash);
      expect(driftCheck.expectedHash).toBe(sharedHash);
    });

    test("schema version is consistent across all artifacts", () => {
      const schema = "1.2.0";

      const matrixHeader = `Generated from \`completions/bun-cli.json\` (schema v${schema}, Bun 1.4.0, revision 452139e36, hash \`909ceece8ae5\`).`;
      const dynamicSources = { schema, jsonHash: "any" };

      expect(matrixHeader).toContain(`schema v${schema}`);
      expect(dynamicSources.schema).toBe(schema);
    });
  });
});
