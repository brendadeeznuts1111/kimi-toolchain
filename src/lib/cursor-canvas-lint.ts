/**
 * Canvas routing parse helpers — used by tests; freshness checks live in canvas-companion-sync.ts.
 */

/** Parse `id` fields from a CANVAS_ROUTING block; null when block is absent. */
export function extractCanvasRoutingIds(source: string): string[] | null {
  const block = source.match(/const CANVAS_ROUTING = \[([\s\S]*?)\] as const/);
  if (!block) return null;
  return [...block[1].matchAll(/\bid:\s*"([^"]+)"/g)].map((match) => match[1]!);
}
