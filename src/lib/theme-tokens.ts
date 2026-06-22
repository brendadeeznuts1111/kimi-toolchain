/**
 * theme-tokens.ts — Centralized color token definitions for the kimi-toolchain.
 *
 * These tokens are consumed by:
 *   - `cli-format.ts` for terminal output (ANSI format)
 *   - `scripts/build-theme.ts` for CSS generation (CSS format via Bun.color macro)
 *   - Frontend React components via CSS custom properties
 *
 * All tokens use hex strings as the canonical source format. Bun.color()
 * converts them to the appropriate output format (css, ansi, hex, HEX) at
 * build time or runtime.
 */

// ── Severity Colors ──────────────────────────────────────────────────

export const SEVERITY_TOKENS = {
  critical: "#ff0000",
  high: "#ff6600",
  medium: "#ffcc00",
  low: "#0066ff",
  unknown: "#888888",
} as const;

// ── Status Colors ────────────────────────────────────────────────────

export const STATUS_TOKENS = {
  ok: "#00ff00",
  present: "#00ff00",
  missing: "#ff0000",
  stale: "#ffcc00",
  unregistered: "#ff6600",
} as const;

// ── UI Semantic Colors ───────────────────────────────────────────────

export const UI_TOKENS = {
  primary: "#007acc",
  danger: "#ff4444",
  success: "#00cc66",
  warning: "#ffcc00",
  info: "#00aaff",
  background: "#f5f5f5",
  surface: "#ffffff",
  text: "#1a1a1a",
  textMuted: "#888888",
  border: "#e0e0e0",
} as const;

// ── Terminal Colors (for cli-format.ts) ──────────────────────────────

export const TERMINAL_TOKENS = {
  error: "#ff0000",
  warn: "#ffcc00",
  success: "#00ff00",
  info: "#00aaff",
  dim: "#888888",
} as const;

// ── Full Theme Definition ────────────────────────────────────────────

export interface ThemeToken {
  name: string;
  value: string;
  category: "severity" | "status" | "ui" | "terminal";
}

export function allTokens(): ThemeToken[] {
  return [
    ...Object.entries(SEVERITY_TOKENS).map(([name, value]) => ({
      name: `severity-${name}`,
      value,
      category: "severity" as const,
    })),
    ...Object.entries(STATUS_TOKENS).map(([name, value]) => ({
      name: `status-${name}`,
      value,
      category: "status" as const,
    })),
    ...Object.entries(UI_TOKENS).map(([name, value]) => ({
      name: `ui-${name}`,
      value,
      category: "ui" as const,
    })),
    ...Object.entries(TERMINAL_TOKENS).map(([name, value]) => ({
      name: `terminal-${name}`,
      value,
      category: "terminal" as const,
    })),
  ];
}

// ── CSS Variable Name Convention ─────────────────────────────────────

/** Convert a token name to a CSS custom property name. */
export function cssVarName(tokenName: string): string {
  return `--${tokenName.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
}

/** Build a CSS custom property declaration string. */
export function cssVarDeclaration(tokenName: string, value: string): string {
  return `  ${cssVarName(tokenName)}: ${value};`;
}
