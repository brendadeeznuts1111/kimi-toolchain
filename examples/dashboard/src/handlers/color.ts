// ── Color ──────────────────────────────────────────────────────────
import {
  BUN_COLOR_STRING_FORMATS,
  buildColorConversionRows,
  COLOR_FORMAT_PROPERTIES,
  INVALID_COLOR_FORMAT_ALIASES,
} from "../../../../src/lib/bun-color-formats.ts";
import { jsonResponse } from "./shared.ts";

export async function apiColor(): Promise<Response> {
  const sampleInput = "#ff0000";
  const stringFormatRows = buildColorConversionRows(sampleInput);

  const conversions = [
    ...stringFormatRows.map((row) => ({
      input: row.input,
      to: row.to,
      result: row.result,
      propertyMatch: row.propertyMatch,
      valueType: COLOR_FORMAT_PROPERTIES[row.to].valueType,
      label: COLOR_FORMAT_PROPERTIES[row.to].label,
    })),
    { input: "#ff0000", to: "ansi-16", result: Bun.color("#ff0000", "ansi-16") },
    { input: "#ff0000", to: "ansi-256", result: Bun.color("#ff0000", "ansi-256") },
    { input: "#ff0000", to: "ansi-16m", result: Bun.color("#ff0000", "ansi-16m") },
    { input: "#00ff00", to: "ansi-16", result: Bun.color("#00ff00", "ansi-16") },
    { input: "#0000ff", to: "ansi-256", result: Bun.color("#0000ff", "ansi-256") },
    { input: "red", to: "ansi-16m", result: Bun.color("red", "ansi-16m") },
    { input: "deeppink", to: "ansi-256", result: Bun.color("deeppink", "ansi-256") },
    { input: "#1a2b3c", to: "ansi-16m", result: Bun.color("#1a2b3c", "ansi-16m") },
    { input: "red", to: "rgb", result: Bun.color("red", "rgb") },
    { input: "red", to: "css", result: Bun.color("red", "css") },
  ];

  return jsonResponse({
    conversions,
    stringFormats: Object.fromEntries(
      BUN_COLOR_STRING_FORMATS.map((format) => [
        format,
        {
          label: COLOR_FORMAT_PROPERTIES[format].label,
          valueType: COLOR_FORMAT_PROPERTIES[format].valueType,
          example: COLOR_FORMAT_PROPERTIES[format].example,
          pattern: COLOR_FORMAT_PROPERTIES[format].pattern,
        },
      ])
    ),
    invalidAliases: INVALID_COLOR_FORMAT_ALIASES,
    formats: {
      hex: "Lowercase #rrggbb string",
      HEX: "Uppercase #RRGGBB string",
      hsl: "hsl(h, s, l) with fractional s/l (e.g. hsl(0, 1, 0.5))",
      "ansi-16": "4-bit (16 colors, e.g. '91' = bright red)",
      "ansi-256": "8-bit (256 colors, e.g. '196')",
      "ansi-16m": "24-bit true color (R;G;B, e.g. '255;0;0')",
      rgb: "rgb(r, g, b) decimal tuple string",
      css: "CSS named color keyword",
    },
    note: "Bun.color(input, format): hex/HEX/hsl return typed strings validated by property matchers. HSL (uppercase) is not a valid format alias.",
  });
}
