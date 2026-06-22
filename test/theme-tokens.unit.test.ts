import { describe, expect, test } from "bun:test";
import {
  SEVERITY_TOKENS,
  STATUS_TOKENS,
  UI_TOKENS,
  TERMINAL_TOKENS,
  allTokens,
  cssVarName,
  cssVarDeclaration,
  type ThemeToken,
} from "../src/lib/theme-tokens.ts";
import { generateCss, generateManifest, convertColor, parseArgs } from "../scripts/build-theme.ts";

// ── Theme Token Tests ────────────────────────────────────────────────

describe("theme-tokens > severity tokens", () => {
  test("has all 5 severity levels", () => {
    expect(Object.keys(SEVERITY_TOKENS)).toHaveLength(5);
    expect(SEVERITY_TOKENS.critical).toBe("#ff0000");
    expect(SEVERITY_TOKENS.high).toBe("#ff6600");
    expect(SEVERITY_TOKENS.medium).toBe("#ffcc00");
    expect(SEVERITY_TOKENS.low).toBe("#0066ff");
    expect(SEVERITY_TOKENS.unknown).toBe("#888888");
  });
});

describe("theme-tokens > status tokens", () => {
  test("has all status types", () => {
    expect(STATUS_TOKENS.ok).toBe("#00ff00");
    expect(STATUS_TOKENS.missing).toBe("#ff0000");
    expect(STATUS_TOKENS.stale).toBe("#ffcc00");
  });
});

describe("theme-tokens > UI tokens", () => {
  test("has semantic UI colors", () => {
    expect(UI_TOKENS.primary).toBe("#007acc");
    expect(UI_TOKENS.danger).toBe("#ff4444");
    expect(UI_TOKENS.success).toBe("#00cc66");
    expect(UI_TOKENS.background).toBe("#f5f5f5");
  });
});

describe("theme-tokens > allTokens", () => {
  test("returns all tokens with categories", () => {
    const tokens = allTokens();
    expect(tokens.length).toBe(25);

    const categories = new Set(tokens.map((t) => t.category));
    expect(categories.has("severity")).toBe(true);
    expect(categories.has("status")).toBe(true);
    expect(categories.has("ui")).toBe(true);
    expect(categories.has("terminal")).toBe(true);
  });

  test("each token has name, value, and category", () => {
    const tokens = allTokens();
    for (const t of tokens) {
      expect(t.name).toBeTruthy();
      expect(t.value).toMatch(/^#[0-9a-f]{6}$/i);
      expect(["severity", "status", "ui", "terminal"]).toContain(t.category);
    }
  });
});

// ── CSS Variable Name Tests ──────────────────────────────────────────

describe("theme-tokens > cssVarName", () => {
  test("converts token names to CSS custom property names", () => {
    expect(cssVarName("severity-critical")).toBe("--severity-critical");
    expect(cssVarName("ui-primary")).toBe("--ui-primary");
    expect(cssVarName("status-ok")).toBe("--status-ok");
  });

  test("handles camelCase by inserting hyphens", () => {
    expect(cssVarName("textMuted")).toBe("--text-muted");
  });
});

describe("theme-tokens > cssVarDeclaration", () => {
  test("generates CSS declaration string", () => {
    const decl = cssVarDeclaration("severity-critical", "red");
    expect(decl).toBe("  --severity-critical: red;");
  });
});

// ── Build Theme Tests ────────────────────────────────────────────────

describe("build-theme > convertColor", () => {
  test("converts hex to css format", () => {
    expect(convertColor("#ff0000", "css")).toBe("red");
    expect(convertColor("#0066ff", "css")).toBe("#06f");
  });

  test("converts hex to hex format", () => {
    expect(convertColor("#ff0000", "hex")).toBe("#ff0000");
  });

  test("converts hex to HEX format", () => {
    expect(convertColor("#ff0000", "HEX")).toBe("#FF0000");
  });
});

describe("build-theme > generateCss", () => {
  test("generates valid CSS with :root block", () => {
    const tokens: ThemeToken[] = [
      { name: "severity-critical", value: "#ff0000", category: "severity" },
      { name: "ui-primary", value: "#007acc", category: "ui" },
    ];
    const css = generateCss(tokens, "css");
    expect(css).toContain(":root");
    expect(css).toContain("--severity-critical: red;");
    expect(css).toContain("--ui-primary: #007acc;");
  });

  test("includes token count in header comment", () => {
    const tokens: ThemeToken[] = [{ name: "test-1", value: "#ff0000", category: "severity" }];
    const css = generateCss(tokens, "css");
    expect(css).toContain("Tokens: 1");
  });
});

describe("build-theme > generateManifest", () => {
  test("generates valid JSON manifest", () => {
    const tokens: ThemeToken[] = [
      { name: "severity-critical", value: "#ff0000", category: "severity" },
    ];
    const manifest = generateManifest(tokens, "css");
    const parsed = JSON.parse(manifest);
    expect(parsed["severity-critical"].value).toBe("#ff0000");
    expect(parsed["severity-critical"].css).toBe("red");
    expect(parsed["severity-critical"].category).toBe("severity");
  });
});

describe("build-theme > parseArgs", () => {
  test("defaults to dist and css", () => {
    const args = parseArgs(["bun", "build-theme.ts"]);
    expect(args.outdir).toBe("dist");
    expect(args.format).toBe("css");
  });

  test("parses --outdir", () => {
    const args = parseArgs(["bun", "build-theme.ts", "--outdir", "build"]);
    expect(args.outdir).toBe("build");
  });

  test("parses --format hex", () => {
    const args = parseArgs(["bun", "build-theme.ts", "--format", "hex"]);
    expect(args.format).toBe("hex");
  });

  test("parses --format HEX", () => {
    const args = parseArgs(["bun", "build-theme.ts", "--format", "HEX"]);
    expect(args.format).toBe("HEX");
  });

  test("ignores invalid format", () => {
    const args = parseArgs(["bun", "build-theme.ts", "--format", "invalid"]);
    expect(args.format).toBe("css");
  });
});
