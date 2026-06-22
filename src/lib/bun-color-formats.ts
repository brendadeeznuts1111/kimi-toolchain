/**
 * Bun.color string output formats — type guards and property matchers.
 *
 * @see https://bun.com/docs/runtime/color
 */

/** Lowercase hex, uppercase HEX, and hsl (fractional). `HSL` is not a valid Bun format. */
export const BUN_COLOR_STRING_FORMATS = ["hex", "HEX", "hsl"] as const;

export type BunColorStringFormat = (typeof BUN_COLOR_STRING_FORMATS)[number];

export type ColorFormatPropertySpec = {
  /** Human label for docs and dashboard tables. */
  label: string;
  /** Expected typeof for Bun.color return value. */
  valueType: "string";
  /** Regex pattern description for docs (not the matcher itself). */
  pattern: string;
  /** Property matcher on the returned string. */
  match: (value: string) => boolean;
  /** Example output for #ff0000 input. */
  example: string;
};

export const COLOR_FORMAT_PROPERTIES: Record<BunColorStringFormat, ColorFormatPropertySpec> = {
  hex: {
    label: "lowercase hex",
    valueType: "string",
    pattern: "^#[0-9a-f]{6}$",
    match: (value) => /^#[0-9a-f]{6}$/.test(value),
    example: "#ff0000",
  },
  HEX: {
    label: "uppercase HEX",
    valueType: "string",
    pattern: "^#[0-9A-F]{6}$",
    match: (value) => /^#[0-9A-F]{6}$/.test(value),
    example: "#FF0000",
  },
  hsl: {
    label: "HSL fractional",
    valueType: "string",
    pattern: "^hsl\\(\\d+,\\s*[\\d.]+,\\s*[\\d.]+\\)$",
    match: (value) => /^hsl\(\d+,\s*[\d.]+,\s*[\d.]+\)$/.test(value),
    example: "hsl(0, 1, 0.5)",
  },
};

/** Known invalid alias — Bun rejects uppercase `HSL`. */
export const INVALID_COLOR_FORMAT_ALIASES = ["HSL"] as const;

export function isBunColorStringFormat(format: string): format is BunColorStringFormat {
  return (BUN_COLOR_STRING_FORMATS as readonly string[]).includes(format);
}

/** Convert input via Bun.color; returns null when format is invalid or conversion throws. */
export function convertBunColor(input: string, format: BunColorStringFormat): string | null {
  try {
    const result = Bun.color(input, format);
    return typeof result === "string" ? result : null;
  } catch {
    return null;
  }
}

/** Type + property match for a Bun.color string output. */
export function matchesColorFormat(value: unknown, format: BunColorStringFormat): boolean {
  if (typeof value !== "string") return false;
  return COLOR_FORMAT_PROPERTIES[format].match(value);
}

/** Round-trip probe: convert then assert property matcher for the format. */
export function verifyColorFormat(
  input: string,
  format: BunColorStringFormat
): {
  ok: boolean;
  result: string | null;
  detail: string;
} {
  const result = convertBunColor(input, format);
  if (result === null) {
    return {
      ok: false,
      result: null,
      detail: `Bun.color(${JSON.stringify(input)}, ${format}) failed`,
    };
  }
  const spec = COLOR_FORMAT_PROPERTIES[format];
  const typeOk = typeof result === spec.valueType;
  const propOk = spec.match(result);
  if (!typeOk || !propOk) {
    return {
      ok: false,
      result,
      detail: `type=${typeof result} property=${propOk ? "ok" : "mismatch"} value=${result}`,
    };
  }
  return { ok: true, result, detail: result };
}

/** Build dashboard / API conversion rows for a fixed input swatch. */
export function buildColorConversionRows(
  input: string,
  formats: readonly BunColorStringFormat[] = BUN_COLOR_STRING_FORMATS
): Array<{
  input: string;
  to: BunColorStringFormat;
  result: string | null;
  propertyMatch: boolean;
}> {
  return formats.map((to) => {
    const result = convertBunColor(input, to);
    return {
      input,
      to,
      result,
      propertyMatch: result !== null && matchesColorFormat(result, to),
    };
  });
}
