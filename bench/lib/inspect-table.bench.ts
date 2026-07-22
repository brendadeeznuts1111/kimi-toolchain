/**
 * Bench: hand-rolled padEnd table rendering vs Bun.inspect.table.
 * Replicates the pre-refactor kimi-error cluster-table renderer for comparison.
 * @see https://bun.com/docs/runtime/utils#bun-inspect-table-tabulardata-properties-options
 */

import { benchSync } from "../lib/timing.ts";

interface ClusterRow {
  clusterId: string;
  count: number;
  topTaxonomy?: string;
  hasPlaybook: boolean;
}

function makeRows(n: number): ClusterRow[] {
  return Array.from({ length: n }, (_, i) => ({
    clusterId: `cluster-${String(i).padStart(4, "0")}`,
    count: (i * 37) % 911,
    topTaxonomy: i % 3 === 0 ? undefined : "expected_nonzero",
    hasPlaybook: i % 2 === 0,
  }));
}

/** Pre-refactor renderer: padEnd columns + dash separator, joined lines. */
function renderHandRolled(rows: ClusterRow[]): string {
  const header = "CLUSTER".padEnd(22) + "COUNT".padEnd(7) + "TAXONOMY".padEnd(16) + "PLAYBOOK";
  const lines = [header, "-".repeat(header.length)];
  for (const row of rows) {
    const playbook = row.hasPlaybook ? "yes" : "no";
    const taxonomy = row.topTaxonomy ?? "—";
    lines.push(
      `${row.clusterId.slice(0, 20).padEnd(22)}${String(row.count).padEnd(7)}${taxonomy.padEnd(16)}${playbook}`
    );
  }
  return lines.join("\n");
}

function renderBunNative(rows: ClusterRow[]): string {
  const table = rows.map((row) => ({
    cluster: row.clusterId.slice(0, 20),
    count: row.count,
    taxonomy: row.topTaxonomy ?? "—",
    playbook: row.hasPlaybook ? "yes" : "no",
  }));
  return Bun.inspect.table(table, ["cluster", "count", "taxonomy", "playbook"]);
}

export function runInspectTableBenchmarks() {
  const small = makeRows(20);
  const large = makeRows(500);
  return [
    { label: "hand-rolled padEnd (20 rows)", sample: benchSync(() => void renderHandRolled(small), 20_000) },
    { label: "Bun.inspect.table (20 rows)", sample: benchSync(() => void renderBunNative(small), 20_000) },
    { label: "hand-rolled padEnd (500 rows)", sample: benchSync(() => void renderHandRolled(large), 2_000) },
    { label: "Bun.inspect.table (500 rows)", sample: benchSync(() => void renderBunNative(large), 2_000) },
  ];
}

if (import.meta.main) {
  for (const { label, sample } of runInspectTableBenchmarks()) {
    console.log(
      `${label.padEnd(36)} avg=${sample.avgMs.toFixed(4)}ms  min=${sample.minMs.toFixed(4)}ms  ops/s=${Math.round(sample.opsPerSecond)}`
    );
  }
}
