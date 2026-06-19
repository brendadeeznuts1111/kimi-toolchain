// ── Console ────────────────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiConsole(): Promise<Response> {
  const obj = {
    zNested: { a: 1, b: { c: [1, 2, 3] } },
    aItems: ["x", "y", "z"],
    mDate: new Date(),
  };

  const defaultOutput = Bun.inspect(obj);
  const customOutput = Bun.inspect(obj, {
    depth: 4,
    colors: false,
    compact: false,
    sorted: true,
  });

  return jsonResponse({
    inspectOptions: { depth: 4, colors: false, compact: false, sorted: true },
    defaultOutput: defaultOutput.slice(0, 300),
    customOutput: customOutput.slice(0, 300),
    note: "Bun.inspect(obj, { depth, colors, compact, sorted }). Compare with new Console({ inspectOptions }) when available.",
  });
}
