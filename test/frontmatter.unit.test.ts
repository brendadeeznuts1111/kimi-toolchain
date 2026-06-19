import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  formatFrontmatterCell,
  formatFrontmatterTable,
  frontmatterTableRows,
  parseFrontmatterCliArgs,
  parseFrontmatterFile,
  parseFrontmatterText,
} from "../src/lib/frontmatter.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("frontmatter", () => {
  test("parseFrontmatterText returns empty data when no block", () => {
    const result = parseFrontmatterText("# Title\n\nBody", "doc.md");
    expect(result.meta.format).toBe("none");
    expect(result.data).toEqual({});
    expect(result.body).toBe("# Title\n\nBody");
  });

  test("parseFrontmatterText parses YAML --- blocks", () => {
    const text = `---
name: demo
layer: L1
trigger:
  - one
  - two
---
# Heading
`;
    const result = parseFrontmatterText(text, "skill.md");
    expect(result.meta.format).toBe("yaml");
    expect(result.meta.delimiter).toBe("---");
    expect(result.data.name).toBe("demo");
    expect(result.data.layer).toBe("L1");
    expect(result.data.trigger).toEqual(["one", "two"]);
    expect(result.body).toBe("# Heading\n");
  });

  test("parseFrontmatterText parses YAML blocks with CRLF line endings", () => {
    const text = "---\r\nname: crlf\r\n---\r\n# Body\r\n";
    const result = parseFrontmatterText(text, "crlf.md");
    expect(result.meta.format).toBe("yaml");
    expect(result.data.name).toBe("crlf");
    expect(result.body).toBe("# Body\r\n");
  });

  test("parseFrontmatterText parses TOML +++ blocks", () => {
    const text = `+++
title = "Post"
draft = false
+++

Content here.
`;
    const result = parseFrontmatterText(text, "post.md");
    expect(result.meta.format).toBe("toml");
    expect(result.data.title).toBe("Post");
    expect(result.data.draft).toBe(false);
    expect(result.body).toBe("Content here.\n");
  });

  test("parseFrontmatterFile reads effect-discipline skill", async () => {
    const path = join(REPO_ROOT, "skills/effect-discipline/SKILL.md");
    const result = await parseFrontmatterFile(path);
    expect(result.meta.format).toBe("yaml");
    expect(result.data.name).toBe("effect-discipline");
    expect(result.data.layer).toBe("L1+L2");
    expect(result.body).toContain("# Effect Discipline");
  });

  test("formatFrontmatterCell shows nested values without [Object]", () => {
    const cell = formatFrontmatterCell({ nested: { deep: { leaf: 1 } }, list: [1, 2] });
    expect(cell).toContain("nested");
    expect(cell).toContain("leaf");
    expect(cell).not.toContain("[Object]");
  });

  test("frontmatterTableRows skips underscore keys and sorts", () => {
    const rows = frontmatterTableRows({ z: 1, _hidden: true, a: { b: 2 } });
    expect(rows.map((row) => row.Key)).toEqual(["a", "z"]);
    expect(rows[0]?.Value).toContain("b");
  });

  test("formatFrontmatterTable renders Key and Value columns", () => {
    const table = formatFrontmatterTable(
      { name: "demo", trigger: ["one", "two"] },
      { colors: false }
    );
    expect(table).toContain("Key");
    expect(table).toContain("Value");
    expect(table).toContain("name");
    expect(table).toContain("trigger");
    expect(table).toContain("one");
  });

  test("formatFrontmatterCell truncates nested values at shallow depth", () => {
    const shallow = formatFrontmatterCell({ a: { b: { c: "deep" } } }, 1);
    expect(shallow).toContain("[Object");
    const deep = formatFrontmatterCell({ a: { b: { c: "deep" } } }, 10);
    expect(deep).toContain("deep");
    expect(deep).not.toContain("[Object");
  });

  test("parseFrontmatterCliArgs parses file, json, and depth", () => {
    expect(parseFrontmatterCliArgs(["doc.md", "--json", "--depth", "5"])).toEqual({
      file: "doc.md",
      json: true,
      depth: 5,
    });
    expect(parseFrontmatterCliArgs(["--depth", "0", "other.md"])).toEqual({
      file: "other.md",
      json: false,
      depth: 0,
    });
    expect(parseFrontmatterCliArgs([])).toEqual({ error: "Missing file path" });
    expect(parseFrontmatterCliArgs(["--nope"])).toEqual({ error: "Unknown flag: --nope" });
  });
});
