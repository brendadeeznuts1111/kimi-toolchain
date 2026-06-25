/** @see DIRECTIVE.md */
export const DEFAULT_MIN_DELETION_RATIO = 3;

export interface DiffMetrics {
  added: number;
  deleted: number;
  ratio: number;
  filesChanged: number;
}

export function parseDiffStat(stat: string): DiffMetrics {
  const summary =
    stat
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? "";
  const added = Number(summary.match(/(\d+)\s+insertion/)?.[1] ?? 0);
  const deleted = Number(summary.match(/(\d+)\s+deletion/)?.[1] ?? 0);
  const filesChanged = Number(summary.match(/(\d+)\s+files?\s+changed/)?.[1] ?? 0);
  const ratio = added === 0 ? (deleted > 0 ? Number.POSITIVE_INFINITY : 0) : deleted / added;
  return { added, deleted, ratio, filesChanged };
}

export function passesDeletionMetric(m: DiffMetrics, min = DEFAULT_MIN_DELETION_RATIO): boolean {
  return m.added === 0 || m.ratio >= min;
}

export function deletionMetricReport(m: DiffMetrics, min = DEFAULT_MIN_DELETION_RATIO): string {
  const ok = passesDeletionMetric(m, min);
  const ratio = Number.isFinite(m.ratio) ? m.ratio.toFixed(1) : "∞";
  return [
    "[DIFF METRICS]",
    `Lines added: ${m.added}`,
    `Lines deleted: ${m.deleted}`,
    `Net change: ${m.deleted - m.added}`,
    `Deletion ratio: ${ratio}× ${ok ? "✅" : "❌"}`,
  ].join("\n");
}
