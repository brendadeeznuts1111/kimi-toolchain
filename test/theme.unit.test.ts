import { describe, expect, test } from "bun:test";
import { theme, cssVars, type Theme } from "../src/lib/theme.ts";

// ── Theme Module Tests ───────────────────────────────────────────────

describe("theme > severity colors", () => {
  test("critical resolves to compact CSS", () => {
    expect(theme.severity.critical).toBe("red");
  });

  test("high resolves to compact CSS", () => {
    expect(theme.severity.high).toBe("#f60");
  });

  test("medium resolves to compact CSS", () => {
    expect(theme.severity.medium).toBe("#fc0");
  });

  test("low resolves to compact CSS", () => {
    expect(theme.severity.low).toBe("#06f");
  });

  test("unknown resolves to compact CSS", () => {
    expect(theme.severity.unknown).toBe("#888");
  });
});

describe("theme > status colors", () => {
  test("ok resolves to compact CSS", () => {
    expect(theme.status.ok).toBe("#0f0");
  });

  test("missing resolves to compact CSS", () => {
    expect(theme.status.missing).toBe("red");
  });

  test("stale resolves to compact CSS", () => {
    expect(theme.status.stale).toBe("#fc0");
  });
});

describe("theme > UI colors", () => {
  test("primary resolves to CSS", () => {
    expect(theme.ui.primary).toBe("#007acc");
  });

  test("danger resolves to compact CSS", () => {
    expect(theme.ui.danger).toBe("#f44");
  });

  test("success resolves to compact CSS", () => {
    expect(theme.ui.success).toBe("#0c6");
  });

  test("background resolves to CSS", () => {
    expect(theme.ui.background).toBe("#f5f5f5");
  });

  test("surface resolves to compact CSS", () => {
    expect(theme.ui.surface).toBe("#fff");
  });

  test("text resolves to CSS", () => {
    expect(theme.ui.text).toBe("#1a1a1a");
  });
});

describe("theme > cssVars", () => {
  test("contains :root block", () => {
    expect(cssVars).toContain(":root");
  });

  test("contains all severity custom properties", () => {
    expect(cssVars).toContain("--severity-critical: red");
    expect(cssVars).toContain("--severity-high: #f60");
    expect(cssVars).toContain("--severity-medium: #fc0");
    expect(cssVars).toContain("--severity-low: #06f");
    expect(cssVars).toContain("--severity-unknown: #888");
  });

  test("contains all status custom properties", () => {
    expect(cssVars).toContain("--status-ok: #0f0");
    expect(cssVars).toContain("--status-missing: red");
    expect(cssVars).toContain("--status-stale: #fc0");
  });

  test("contains all UI custom properties", () => {
    expect(cssVars).toContain("--ui-primary: #007acc");
    expect(cssVars).toContain("--ui-danger: #f44");
    expect(cssVars).toContain("--ui-success: #0c6");
    expect(cssVars).toContain("--ui-background: #f5f5f5");
  });

  test("is a valid CSS string with closing brace", () => {
    expect(cssVars.trim().endsWith("}")).toBe(true);
  });
});

describe("theme > type", () => {
  test("Theme type has severity, status, ui", () => {
    const t: Theme = theme;
    expect(t.severity).toBeDefined();
    expect(t.status).toBeDefined();
    expect(t.ui).toBeDefined();
  });
});
