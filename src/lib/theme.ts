/**
 * theme.ts — Client-side theme module using Bun.color macro.
 *
 * This module uses `import { color } from "bun" with { type: "macro" }` to
 * convert hex color values to compact CSS strings at BUILD TIME. The macro
 * calls are replaced by static string literals in the output bundle — zero
 * runtime overhead, no color parsing code shipped to the client.
 *
 * Usage in client-side code:
 *   import { theme } from "./theme.ts";
 *   console.log(theme.severity.critical); // "red" (static string in bundle)
 *
 * To regenerate the CSS file:
 *   bun run scripts/build-theme.ts --outdir dist
 *
 * @see src/lib/theme-tokens.ts for the canonical hex token definitions
 * @see scripts/build-theme.ts for the CSS generation script
 */

import { color } from "bun" with { type: "macro" };

// ── Severity Colors (build-time resolved) ────────────────────────────

const severity = {
  critical: color("#ff0000", "css"),
  high: color("#ff6600", "css"),
  medium: color("#ffcc00", "css"),
  low: color("#0066ff", "css"),
  unknown: color("#888888", "css"),
} as const;

// ── Status Colors (build-time resolved) ──────────────────────────────

const status = {
  ok: color("#00ff00", "css"),
  present: color("#00ff00", "css"),
  missing: color("#ff0000", "css"),
  stale: color("#ffcc00", "css"),
  unregistered: color("#ff6600", "css"),
} as const;

// ── UI Semantic Colors (build-time resolved) ─────────────────────────

const ui = {
  primary: color("#007acc", "css"),
  danger: color("#ff4444", "css"),
  success: color("#00cc66", "css"),
  warning: color("#ffcc00", "css"),
  info: color("#00aaff", "css"),
  background: color("#f5f5f5", "css"),
  surface: color("#ffffff", "css"),
  text: color("#1a1a1a", "css"),
  textMuted: color("#888888", "css"),
  border: color("#e0e0e0", "css"),
} as const;

// ── Exported Theme Object ────────────────────────────────────────────

export const theme = {
  severity,
  status,
  ui,
} as const;

export type Theme = typeof theme;

// ── CSS Custom Properties String ─────────────────────────────────────

/** CSS :root block with all theme tokens as custom properties. */
export const cssVars = `:root {
  --severity-critical: ${severity.critical};
  --severity-high: ${severity.high};
  --severity-medium: ${severity.medium};
  --severity-low: ${severity.low};
  --severity-unknown: ${severity.unknown};
  --status-ok: ${status.ok};
  --status-present: ${status.present};
  --status-missing: ${status.missing};
  --status-stale: ${status.stale};
  --status-unregistered: ${status.unregistered};
  --ui-primary: ${ui.primary};
  --ui-danger: ${ui.danger};
  --ui-success: ${ui.success};
  --ui-warning: ${ui.warning};
  --ui-info: ${ui.info};
  --ui-background: ${ui.background};
  --ui-surface: ${ui.surface};
  --ui-text: ${ui.text};
  --ui-text-muted: ${ui.textMuted};
  --ui-border: ${ui.border};
}`;
