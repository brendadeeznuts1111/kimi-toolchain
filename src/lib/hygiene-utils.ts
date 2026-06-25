/** Shared helpers for path/root hygiene scanners and cleanup CLIs. */

import { listDir, pathStat } from "./bun-io.ts";

export function countTree(path: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  try {
    const stat = pathStat(path);
    if (!stat.isDirectory()) {
      return { bytes: stat.size, files: 1 };
    }
    for (const entry of listDir(path, { withFileTypes: true })) {
      const full = `${path}/${entry.name}`.replace(/\/+/g, "/");
      if (entry.isDirectory()) {
        const nested = countTree(full);
        bytes += nested.bytes;
        files += nested.files;
      } else if (entry.isFile()) {
        bytes += pathStat(full).size;
        files++;
      }
    }
  } catch {
    /* unreadable */
  }
  return { bytes, files };
}

export function formatHygieneBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
