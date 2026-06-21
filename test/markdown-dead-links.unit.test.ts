import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  auditMarkdownDeadLinks,
  classifyMarkdownHref,
  extractMarkdownLinks,
  resolveInternalMarkdownTarget,
} from "../src/lib/markdown-dead-links-lint.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("markdown-dead-links-lint", () => {
  test("extractMarkdownLinks collects link and image targets", async () => {
    const links = await extractMarkdownLinks(
      "See [AGENTS](AGENTS.md) and ![x](./img.png).\n<https://bun.com/docs>\n"
    );
    expect(links).toContain("AGENTS.md");
    expect(links).toContain("./img.png");
    expect(links.some((l) => l.includes("bun.com"))).toBe(true);
  });

  test("classifyMarkdownHref distinguishes internal and external", () => {
    expect(classifyMarkdownHref("#intro")).toBe("fragment");
    expect(classifyMarkdownHref("mailto:a@b.c")).toBe("mailto");
    expect(classifyMarkdownHref("https://bun.com/docs")).toBe("external");
    expect(classifyMarkdownHref("./foo.md")).toBe("internal");
    expect(classifyMarkdownHref("~/.kimi-code/AGENTS.md")).toBe("home_path");
  });

  test("resolveInternalMarkdownTarget resolves relative paths", () => {
    const target = resolveInternalMarkdownTarget(REPO_ROOT, "test/testing.md", "../AGENTS.md");
    expect(target).toBe(join(REPO_ROOT, "AGENTS.md"));
  });

  test("flags missing internal links", async () => {
    const issues = await auditMarkdownDeadLinks(REPO_ROOT, {
      paths: ["test/testing.md"],
      online: false,
    });
    const missing = issues.filter((i) => i.status === "missing_internal");
    expect(missing.every((i) => i.severity === "error")).toBe(true);
  });

  test("agent docs pass offline internal link gate", async () => {
    const issues = await auditMarkdownDeadLinks(REPO_ROOT, { full: false, online: false });
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });
});
