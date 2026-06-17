import { describe, expect, test } from "bun:test";
import { join } from "path";
import { parseFrontmatterFile, parseFrontmatterText } from "../src/lib/frontmatter.ts";
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
});
