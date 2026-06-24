import { benchSync } from "../lib/timing.ts";
import { parseNdjsonText } from "../../src/lib/ndjson.ts";

export function runNdjsonBenchmarks() {
  const asciiRecords =
    Array.from({ length: 1000 }, (_, i) =>
      JSON.stringify({ id: i, name: `item-${i}`, ts: Date.now() })
    ).join("\n") + "\n";

  const errorRecords =
    Array.from({ length: 1000 }, (_, i) =>
      i % 100 === 50 ? "{invalid}" : JSON.stringify({ id: i, name: `item-${i}` })
    ).join("\n") + "\n";

  const utf8Records =
    Array.from({ length: 500 }, (_, i) =>
      JSON.stringify({ id: i, name: `アイテム-${i}-🎉`, tag: "日本語" })
    ).join("\n") + "\n";

  const largeRecord =
    JSON.stringify({
      data: "x".repeat(100_000),
      meta: { ts: Date.now(), version: "1.0.0" },
    }) + "\n";

  return [
    {
      label: "parseNdjsonText (1k ASCII records)",
      sample: benchSync(() => {
        parseNdjsonText(asciiRecords);
      }, 5_000),
    },
    {
      label: "Bun.JSONL.parse (1k ASCII, direct)",
      sample: benchSync(() => {
        Bun.JSONL.parse(asciiRecords);
      }, 5_000),
    },
    {
      label: "parseNdjsonText (1k records, 10 errors)",
      sample: benchSync(() => {
        parseNdjsonText(errorRecords);
      }, 2_000),
    },
    {
      label: "parseNdjsonText (500 UTF-8 records)",
      sample: benchSync(() => {
        parseNdjsonText(utf8Records);
      }, 2_000),
    },
    {
      label: "parseNdjsonText (1x 100KB record)",
      sample: benchSync(() => {
        parseNdjsonText(largeRecord);
      }, 10_000),
    },
  ];
}
