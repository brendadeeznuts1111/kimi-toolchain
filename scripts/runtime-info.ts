#!/usr/bin/env bun
/** Enhanced replacement for `bun -e 'console.log({ version: Bun.version, ... })'`. */
import { join } from "path";
import {
  bunRuntimeReport,
  formatFullBunRuntimeSnapshot,
  formatMemoryBytes,
  formatProcessMemoryUsage,
  inspectBunRuntime,
  processMemoryUsage,
} from "../src/lib/bun-utils.ts";

const json = Bun.argv.includes("--json");
const pretty = Bun.argv.includes("--pretty") || (!json && Bun.argv.length <= 2);

interface PackageMeta {
  name?: string;
  version?: string;
  engineRange?: string;
  packageManager?: string;
}

async function readPackageMeta(): Promise<PackageMeta> {
  const pkgPath = join(import.meta.dir, "..", "package.json");
  try {
    const pkg = (await Bun.file(pkgPath).json()) as {
      name?: string;
      version?: string;
      engines?: { bun?: string };
      packageManager?: string;
    };
    return {
      name: pkg.name,
      version: pkg.version,
      engineRange: pkg.engines?.bun,
      packageManager: pkg.packageManager,
    };
  } catch {
    return {};
  }
}

const meta = await readPackageMeta();
const engineRange = meta.engineRange ?? ">=1.4.0";
const report = bunRuntimeReport(engineRange);
const processMemory = processMemoryUsage();
const processMemoryFormatted = formatProcessMemoryUsage(processMemory);

function processMemoryBreakdown(mem: typeof processMemory) {
  const rss = mem.rss || 1; // avoid divide-by-zero
  return {
    heapUsedPercentOfRss: Math.round((mem.heapUsed / rss) * 1000) / 10,
    externalPercentOfRss: Math.round((mem.external / rss) * 1000) / 10,
    arrayBuffersPercentOfRss: Math.round((mem.arrayBuffers / rss) * 1000) / 10,
  };
}

const payload = {
  ...report,
  processMemory: {
    ...processMemory,
    formatted: processMemoryFormatted,
    breakdown: processMemoryBreakdown(processMemory),
  },
  systemMemory: {
    ...report.memory,
    formatted: {
      total: formatMemoryBytes(report.memory.totalBytes),
      used: formatMemoryBytes(report.memory.usedBytes),
      free: formatMemoryBytes(report.memory.freeBytes),
    },
  },
  project: meta.name
    ? {
        name: meta.name,
        version: meta.version,
        engineRange,
        packageManager: meta.packageManager,
      }
    : undefined,
  packageManager: meta.packageManager,
};

if (json) {
  console.log(JSON.stringify(payload, null, 2));
} else if (pretty) {
  console.log(
    formatFullBunRuntimeSnapshot(engineRange, {
      packageManager: meta.packageManager,
      projectName: meta.name,
      projectVersion: meta.version,
      processMemory,
    })
  );
} else {
  console.log(inspectBunRuntime());
}
