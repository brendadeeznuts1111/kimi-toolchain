// ── Color ──────────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiColor(): Promise<Response> {
  const conversions = [
    { input: "#ff0000", to: "ansi-16", result: Bun.color("#ff0000", "ansi-16") },
    { input: "#ff0000", to: "ansi-256", result: Bun.color("#ff0000", "ansi-256") },
    { input: "#ff0000", to: "ansi-16m", result: Bun.color("#ff0000", "ansi-16m") },
    { input: "#00ff00", to: "ansi-16", result: Bun.color("#00ff00", "ansi-16") },
    { input: "#0000ff", to: "ansi-256", result: Bun.color("#0000ff", "ansi-256") },
    { input: "red", to: "ansi-16m", result: Bun.color("red", "ansi-16m") },
    { input: "deeppink", to: "ansi-256", result: Bun.color("deeppink", "ansi-256") },
    { input: "#1a2b3c", to: "ansi-16m", result: Bun.color("#1a2b3c", "ansi-16m") },
  ];

  return jsonResponse({
    conversions,
    formats: {
      "ansi-16": "4-bit (16 colors, e.g. '91' = bright red)",
      "ansi-256": "8-bit (256 colors, e.g. '196')",
      "ansi-16m": "24-bit true color (R;G;B, e.g. '255;0;0')",
    },
    note: "Bun.color(input, format) converts hex/named colors to ANSI escape code parameters. Use with \\x1b[38;5;{n}m.",
  });
}
