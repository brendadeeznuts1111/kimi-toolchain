// ── Inspect Defaults ───────────────────────────────────────────────
import { jsonResponse } from "./shared.ts";

export async function apiInspectDefaults(): Promise<Response> {
  const { inspect } = await import("node:util");
  const defaultsBefore = { ...inspect.defaultOptions };

  // Simulate debug-level configuration
  const origDepth = inspect.defaultOptions.depth;
  const origColors = inspect.defaultOptions.colors;
  inspect.defaultOptions.depth = 6;
  inspect.defaultOptions.colors = false;

  const obj = { a: { b: { c: { d: { e: { f: "deep" } } } } } };
  const deepOutput = inspect(obj);

  // Restore
  inspect.defaultOptions.depth = origDepth;
  inspect.defaultOptions.colors = origColors;

  const normalOutput = inspect(obj);

  return jsonResponse({
    defaults: defaultsBefore,
    configured: { depth: 6, colors: false },
    deepOutput: deepOutput.slice(0, 200),
    normalOutput: normalOutput.slice(0, 200),
    note: "node:util.inspect.defaultOptions — configure global inspect behavior. Set depth/colors/compact/sorted. Bun.inspect.defaultOptions not yet available (use node:util).",
  });
}
