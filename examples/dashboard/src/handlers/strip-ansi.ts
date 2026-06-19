// ── Strip ANSI ─────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiStripAnsi(): Promise<Response> {
  const samples = [
    {
      input: "\x1b[31mHello\x1b[0m \x1b[32mWorld\x1b[0m",
      stripped: Bun.stripANSI("\x1b[31mHello\x1b[0m \x1b[32mWorld\x1b[0m"),
    },
    {
      input: "\x1b[1m\x1b[4mBold and underlined\x1b[0m",
      stripped: Bun.stripANSI("\x1b[1m\x1b[4mBold and underlined\x1b[0m"),
    },
    {
      input: "\x1b[33m\x1b[44mYellow on blue\x1b[0m",
      stripped: Bun.stripANSI("\x1b[33m\x1b[44mYellow on blue\x1b[0m"),
    },
    { input: "Plain text", stripped: Bun.stripANSI("Plain text") },
  ];

  // String width comparison
  const colored = "\x1b[31mHello\x1b[0m \x1b[32mWorld\x1b[0m";
  const widthRaw = Bun.stringWidth(colored);
  const widthStripped = Bun.stringWidth(Bun.stripANSI(colored));

  return jsonResponse({
    samples,
    stringWidth: {
      raw: widthRaw,
      stripped: widthStripped,
      note: "stringWidth correctly ignores ANSI codes",
    },
    note: "Bun.stripANSI() — SIMD-accelerated, 6x-57x faster than strip-ansi npm. Removes all ANSI escape sequences.",
  });
}
