/**
 * runtime/utils.mdx coverage — maps Bun utils APIs to kimi-toolchain wrappers.
 */
import { BUN_RUNTIME_UTILS_DOC_URL } from "./bun-utils.ts";

export { BUN_RUNTIME_UTILS_DOC_URL };

export type RuntimeUtilsCoverageStatus = "wrapped" | "native-only" | "partial";

export interface RuntimeUtilsCoverageEntry {
  api: string;
  anchor: string;
  wrapper?: string;
  module?: string;
  docUrlConst?: string;
  status: RuntimeUtilsCoverageStatus;
  notes?: string;
}

export const RUNTIME_UTILS_COVERAGE: readonly RuntimeUtilsCoverageEntry[] = [
  {
    api: "Bun.version",
    anchor: "bun-version",
    wrapper: "detectBunRuntime",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  {
    api: "Bun.revision",
    anchor: "bun-revision",
    wrapper: "detectBunRuntime",
    module: "src/lib/bun-utils.ts",
    status: "wrapped",
  },
  { api: "Bun.env", anchor: "bun-env", status: "native-only" },
  {
    api: "Bun.main",
    anchor: "bun-main",
    wrapper: "isDirectRun",
    module: "src/lib/bun-utils.ts",
    status: "partial",
    notes: "Bun.main used directly at call sites.",
  },
  { api: "Bun.sleep", anchor: "bun-sleep", status: "native-only" },
  { api: "Bun.sleepSync", anchor: "bun-sleepsync", status: "native-only" },
  { api: "Bun.which", anchor: "bun-which", status: "native-only" },
  {
    api: "Bun.randomUUIDv7",
    anchor: "bun-randomuuidv7",
    status: "native-only",
    notes: "generateTraceId/generateSpanId strip dashes at call sites.",
  },
  {
    api: "Bun.stringWidth",
    anchor: "bun-stringwidth",
    status: "native-only",
  },
  { api: "Bun.escapeHTML", anchor: "bun-escapehtml", status: "native-only" },
  {
    api: "Bun.openInEditor",
    anchor: "bun-openineditor",
    docUrlConst: "BUN_OPEN_IN_EDITOR_DOC_URL",
    status: "native-only",
  },
  { api: "Bun.gzipSync", anchor: "bun-gzipsync", status: "native-only" },
  { api: "Bun.gunzipSync", anchor: "bun-gunzipsync", status: "native-only" },
  {
    api: "serialize (bun:jsc)",
    anchor: "serialize-deserialize-in-bun-jsc",
    status: "native-only",
  },
  {
    api: "estimateShallowMemoryUsageOf (bun:jsc)",
    anchor: "estimateshallowmemoryusageof-in-bun-jsc",
    status: "native-only",
  },
  {
    api: "Bun.peek",
    anchor: "bun-peek",
    module: "src/lib/bun-utils.ts",
    status: "partial",
    notes: "dedupInflight and createInflightCoalescer use peek.status inline.",
  },
  {
    api: "Bun.nanoseconds",
    anchor: "bun-nanoseconds",
    status: "native-only",
  },
  {
    api: "Bun.semver",
    anchor: "bun-semver",
    docUrlConst: "BUN_SEMVER_DOC_URL",
    status: "native-only",
    notes: "Used directly via Bun.semver.order and Bun.semver.satisfies.",
  },
  { api: "Bun.color", anchor: "bun-color", module: "src/lib/error-format.ts", status: "partial" },
  {
    api: "Bun.wrapAnsi",
    anchor: "bun-wrapansi",
    module: "src/lib/bun-install-config.ts",
    status: "partial",
  },
] as const;

export const RUNTIME_UTILS_DOCS_PROBE_COMMAND = "rg openInEditor runtime/utils.mdx";

export function buildRuntimeUtilsCoverageReport() {
  const entries = [...RUNTIME_UTILS_COVERAGE];
  const wrapped = entries.filter((e) => e.status === "wrapped").length;
  const partial = entries.filter((e) => e.status === "partial").length;
  const nativeOnly = entries.filter((e) => e.status === "native-only").length;
  const total = entries.length;
  const coveragePercent =
    total > 0 ? Math.round(((wrapped + nativeOnly + partial * 0.5) / total) * 1000) / 10 : 0;
  return {
    docUrl: BUN_RUNTIME_UTILS_DOC_URL,
    total,
    wrapped,
    partial,
    nativeOnly,
    coveragePercent,
    entries,
  };
}
