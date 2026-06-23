import { describe, expect, test } from "bun:test";
import {
  buildBunDocsWebViewOptions,
  BUN_DOCS_ROOT_URL,
  extractBunDocsUrl,
  resolveBunDocsUrlFromSearch,
} from "../src/lib/bun-docs-webview.ts";

describe("bun-docs-webview", () => {
  test("extractBunDocsUrl finds the first bun.com/docs URL", () => {
    expect(extractBunDocsUrl("Link: https://bun.com/docs/runtime/child-process")).toBe(
      "https://bun.com/docs/runtime/child-process"
    );
  });

  test("extractBunDocsUrl ignores trailing punctuation", () => {
    expect(extractBunDocsUrl("See https://bun.com/docs/guides/process/spawn, then continue.")).toBe(
      "https://bun.com/docs/guides/process/spawn"
    );
  });

  test("extractBunDocsUrl returns undefined when no docs URL is present", () => {
    expect(extractBunDocsUrl("No docs link here.")).toBeUndefined();
  });

  test("resolveBunDocsUrlFromSearch extracts URL from string content", () => {
    const result = resolveBunDocsUrlFromSearch({
      ok: true,
      content: "Link: https://bun.com/docs/api/spawn\nContent...",
      latencyMs: 100,
    });
    expect(result.url).toBe("https://bun.com/docs/api/spawn");
    expect(result.fallback).toBe(false);
  });

  test("resolveBunDocsUrlFromSearch extracts URL from text blocks", () => {
    const result = resolveBunDocsUrlFromSearch({
      ok: true,
      content: [
        { type: "text", text: "Title: spawn\nLink: https://bun.com/docs/guides/process/spawn" },
      ],
      latencyMs: 100,
    });
    expect(result.url).toBe("https://bun.com/docs/guides/process/spawn");
    expect(result.fallback).toBe(false);
  });

  test("resolveBunDocsUrlFromSearch falls back to root when search fails", () => {
    const result = resolveBunDocsUrlFromSearch({
      ok: false,
      error: "network error",
      latencyMs: 0,
    });
    expect(result.url).toBe(BUN_DOCS_ROOT_URL);
    expect(result.fallback).toBe(true);
    expect(result.error).toBe("network error");
  });

  test("resolveBunDocsUrlFromSearch falls back to root when no URL is found", () => {
    const result = resolveBunDocsUrlFromSearch({
      ok: true,
      content: "No docs link in this result.",
      latencyMs: 100,
    });
    expect(result.url).toBe(BUN_DOCS_ROOT_URL);
    expect(result.fallback).toBe(true);
  });

  test("buildBunDocsWebViewOptions fills defaults", () => {
    const options = buildBunDocsWebViewOptions("https://bun.com/docs/api/spawn");
    expect(options.url).toBe("https://bun.com/docs/api/spawn");
    expect(options.width).toBe(1280);
    expect(options.height).toBe(800);
    expect(options.console).toBe(globalThis.console);
  });

  test("buildBunDocsWebViewOptions respects overrides", () => {
    const options = buildBunDocsWebViewOptions("https://bun.com/docs/api/spawn", {
      width: 1600,
      height: 900,
      backend: "webkit",
    });
    expect(options.width).toBe(1600);
    expect(options.height).toBe(900);
    expect(options.backend).toBe("webkit");
  });
});
