/**
 * Bun release registry — current + previous + history (not every version).
 * Zero-dep module; re-exported from bun-utils.ts for the public API.
 */

import { semver } from "bun";

export interface BunReleaseRecord {
  readonly version: string;
  readonly tag: string;
  readonly hash: string;
  readonly url: string;
  readonly blogUrl: string;
  readonly blogPublished: string;
  /** Blog author (full name as shown on bun.com). */
  readonly author: string;
  readonly breaking: readonly string[];
  /** Number of feature commit links expected in the blog markdown (0 when none are embedded). */
  readonly featureCommitCount: number;
}

export const BUN_RELEASE_HISTORY = {
  "1.3.5": {
    version: "1.3.5",
    tag: "bun-v1.3.5",
    hash: "fa5a5bbe556a4bda5bde77b4013aa6c3bb4ec9ab",
    url: "https://github.com/oven-sh/bun/releases/tag/bun-v1.3.5",
    blogUrl: "https://bun.com/blog/bun-v1.3.5",
    blogPublished: "2025-12-17T16:55:00.000Z",
    author: "Jarred Sumner",
    breaking: ["none"],
    featureCommitCount: 0,
  },
  "1.3.6": {
    version: "1.3.6",
    tag: "bun-v1.3.6",
    hash: "d530ed993d62be7c7f8f01a3d52627b6845dfd93",
    url: "https://github.com/oven-sh/bun/releases/tag/bun-v1.3.6",
    blogUrl: "https://bun.com/blog/bun-v1.3.6",
    blogPublished: "2026-01-13T01:12:07.484Z",
    author: "Jarred Sumner",
    breaking: ["bun build --compile NAPI regression"],
    featureCommitCount: 15,
  },
  "1.3.7": {
    version: "1.3.7",
    tag: "bun-v1.3.7",
    hash: "ba426210c28a43a3d36db504523617fd0202070e",
    url: "https://github.com/oven-sh/bun/releases/tag/bun-v1.3.7",
    blogUrl: "https://bun.com/blog/bun-v1.3.7",
    blogPublished: "2026-01-27T07:04:03.000Z",
    author: "Jarred Sumner",
    breaking: ["none"],
    featureCommitCount: 0,
  },
  "1.3.8": {
    version: "1.3.8",
    tag: "bun-v1.3.8",
    hash: "aded701d1d2f89663a114c22ef6550153c9b23e4",
    url: "https://github.com/oven-sh/bun/releases/tag/bun-v1.3.8",
    blogUrl: "https://bun.com/blog/bun-v1.3.8",
    blogPublished: "2026-01-29T10:38:16.000Z",
    author: "Jarred Sumner",
    breaking: ["none"],
    featureCommitCount: 1,
  },
  "1.3.9": {
    version: "1.3.9",
    tag: "bun-v1.3.9",
    hash: "a5246344fa40201931d5ffd274ef76d810759106",
    url: "https://github.com/oven-sh/bun/releases/tag/bun-v1.3.9",
    blogUrl: "https://bun.com/blog/bun-v1.3.9",
    blogPublished: "2026-02-08T09:31:23.000Z",
    author: "Jarred Sumner",
    breaking: ["none"],
    featureCommitCount: 13,
  },
  "1.3.10": {
    version: "1.3.10",
    tag: "bun-v1.3.10",
    hash: "b2d8504a09a6cf9f3282418570fa7205870bfc94",
    url: "https://github.com/oven-sh/bun/releases/tag/bun-v1.3.10",
    blogUrl: "https://bun.com/blog/bun-v1.3.10",
    blogPublished: "2026-02-26T07:08:20.000Z",
    author: "Jarred Sumner",
    breaking: ["none"],
    featureCommitCount: 14,
  },
  "1.3.11": {
    version: "1.3.11",
    tag: "bun-v1.3.11",
    hash: "0b61853ac659a0126aa0ded8db3b1e358d3cc160",
    url: "https://github.com/oven-sh/bun/releases/tag/bun-v1.3.11",
    blogUrl: "https://bun.com/blog/bun-v1.3.11",
    blogPublished: "2026-03-18T04:31:40.000Z",
    author: "Jarred Sumner",
    breaking: ["none"],
    featureCommitCount: 3,
  },
  "1.3.12": {
    version: "1.3.12",
    tag: "bun-v1.3.12",
    hash: "1cc837687b1d1f8d558a40110fbe3e61cc41fbcd",
    url: "https://github.com/oven-sh/bun/releases/tag/bun-v1.3.12",
    blogUrl: "https://bun.com/blog/bun-v1.3.12",
    blogPublished: "2026-04-10T03:04:46.000Z",
    author: "Jarred Sumner",
    breaking: ["none"],
    featureCommitCount: 16,
  },
  "1.3.13": {
    version: "1.3.13",
    tag: "bun-v1.3.13",
    hash: "bf2e2cecf27e800962b1e7f03d66278f9d5d2e79",
    url: "https://github.com/oven-sh/bun/releases/tag/bun-v1.3.13",
    blogUrl: "https://bun.com/blog/bun-v1.3.13",
    blogPublished: "2026-04-20T08:07:57.000Z",
    author: "Jarred Sumner",
    breaking: ["none"],
    featureCommitCount: 0,
  },
  "1.3.14": {
    version: "1.3.14",
    tag: "bun-v1.3.14",
    hash: "0d9b296af33f2b851fcbf4df3e9ec89751734ba4",
    url: "https://github.com/oven-sh/bun/releases/tag/bun-v1.3.14",
    blogUrl: "https://bun.com/blog/bun-v1.3.14",
    blogPublished: "2026-05-13T03:48:28.000Z",
    author: "Jarred Sumner",
    breaking: ["none"],
    featureCommitCount: 0,
  },
} as const satisfies Record<string, BunReleaseRecord>;

export type BunReleaseVersion = keyof typeof BUN_RELEASE_HISTORY;

/** Active target — change when bumping the toolchain pin. */
export const BUN_RELEASE = BUN_RELEASE_HISTORY["1.3.14"];

/** Previous baseline — rollback / regression compare. */
export const BUN_RELEASE_PREVIOUS = BUN_RELEASE_HISTORY["1.3.13"];

/** Active release blog URL (doc-link lint / head tables). */
export const BUN_RELEASE_BLOG_URL = BUN_RELEASE.blogUrl;

/** Ordered semver sort for history keys. */
export function semverCompare(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const delta = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function sortReleaseVersions(keys: Iterable<string>): string[] {
  return [...keys].sort(semverCompare);
}

/** Blog section anchors for features introduced in v1.3.6 (links stay on that post). */
export const BUN_RELEASE_1_3_6_FEATURE_ANCHORS = {
  archive: "bun-archive-api-creates-extracts-tarballs",
  jsonc: "bun-jsonc-api-for-parsing-json-with-comments",
  websocketProxy: "http-https-proxy-support-for-websocket",
  compileExecutablePath: "compile-executable-path-cli-flag",
} as const;

/** Blog section anchors for the active release (v1.3.7). */
export const BUN_RELEASE_FEATURE_ANCHORS = {
  bufferFrom: "faster-buffer-from-with-arrays",
  wrapAnsi: "bun-wrapansi-for-ansi-aware-text-wrapping",
  json5: "native-json5-support",
  jsonl: "bun-jsonl-for-streaming-jsonl-parsing",
  cpuProfMd: "markdown-cpu-profile-output",
  heapProf: "heap-profiling-with-heap-prof",
  headerCase: "fetch-now-preserves-header-case-when-sending-http-requests",
  nodeInspector: "nodeinspector-profiler-api",
  bufferSwap: "faster-bufferswap16-and-bufferswap64",
  replMode: "replmode-option-for-buntranspiler",
  s3Presign: "s3-presign-now-supports-contentdisposition-and-type-options",
  s3ContentEncoding: "s3-contentencoding-option",
  ffiNixOS: "bunffi-now-respects-cincludepath-and-librarypath-environment-variables",
} as const;

export type ReleaseRole = "current" | "previous" | "history";

/** Human-readable breaking column — `—` when registry lists `none`. */
export function formatBreakingCell(breaking: readonly string[]): string {
  if (breaking.length === 0 || (breaking.length === 1 && breaking[0] === "none")) return "—";
  return breaking.join("; ");
}

/** Count of non-`none` breaking entries. */
export function breakingChangeCount(breaking: readonly string[]): number {
  return breaking.filter((item) => item !== "none").length;
}

export function releaseRoleForVersion(version: string): ReleaseRole {
  if (version === BUN_RELEASE.version) return "current";
  if (version === BUN_RELEASE_PREVIOUS.version) return "previous";
  return "history";
}

/** Flattened row for tables / JSON inspect (no duplicate Version/version columns). */
export interface ReleaseHistoryRow {
  version: string;
  role: ReleaseRole;
  tag: string;
  hash: string;
  hashShort: string;
  commitUrl: string;
  url: string;
  blogUrl: string;
  blogPublished: string;
  author: string;
  breaking: string;
  breakingCount: number;
  [key: string]: unknown;
}

export interface ReleaseHistoryMetrics {
  rowCount: number;
  fieldKeys: string[];
  columnNameWidthSum: number;
  jsonSerializedLength: number;
  displayWidth: number;
  currentEqualsPrevious: boolean;
}

/** Tabular projection of {@link BUN_RELEASE_HISTORY} — semver-ordered. */
export function buildReleaseHistoryRows(
  history: typeof BUN_RELEASE_HISTORY = BUN_RELEASE_HISTORY
): ReleaseHistoryRow[] {
  return sortReleaseVersions(Object.keys(history)).map((version) => {
    const record = history[version as BunReleaseVersion];
    return {
      version,
      role: releaseRoleForVersion(version),
      tag: record.tag,
      hash: record.hash,
      hashShort: record.hash.slice(0, 12),
      commitUrl: releaseCommitUrl(record.hash),
      url: record.url,
      blogUrl: record.blogUrl,
      blogPublished: record.blogPublished,
      author: record.author,
      breaking: formatBreakingCell(record.breaking),
      breakingCount: breakingChangeCount(record.breaking),
    };
  });
}

/** Footprint metrics for {@link buildReleaseHistoryRows} output (uses Bun.stringWidth). */
export function measureReleaseHistoryRows(rows: ReleaseHistoryRow[]): ReleaseHistoryMetrics {
  const fieldKeys = rows[0] ? Object.keys(rows[0]) : [];
  return {
    rowCount: rows.length,
    fieldKeys,
    columnNameWidthSum: fieldKeys.reduce((sum, key) => sum + Bun.stringWidth(key), 0),
    jsonSerializedLength: JSON.stringify(rows).length,
    displayWidth: rows.reduce((sum, row) => sum + Bun.stringWidth(Object.values(row).join("")), 0),
    currentEqualsPrevious: Bun.deepEquals(BUN_RELEASE, BUN_RELEASE_PREVIOUS),
  };
}

/** GitHub commit URL for a release record hash. */
export function releaseCommitUrl(hash: string): string {
  return `https://github.com/oven-sh/bun/commit/${hash}`;
}

/** Blog markdown alternate path (`/blog/bun-v1.3.7.md`). */
export function releaseMarkdownAlt(tag: string): string {
  return `/blog/${tag}.md`;
}

/** OG image URL for a release blog post. */
export function releaseOgImage(tag: string): string {
  return `https://bun.com/og/blog/${tag}.png`;
}

/** Extract a 40-char SHA from an oven-sh/bun commit URL. */
export function commitHashFromUrl(url: string): string {
  return url.replace(/^https:\/\/github\.com\/oven-sh\/bun\/commit\//, "").trim();
}

/** Feature deep link on a release blog post. */
export function releaseFeatureUrl(slug: string, blogUrl: string = BUN_RELEASE.blogUrl): string {
  return `${blogUrl}#${slug}`;
}

const RELEASE_1_3_6_BLOG = BUN_RELEASE_HISTORY["1.3.6"].blogUrl;

/** Feature deep links — v1.3.6 post (features shipped that release). */
export const BUN_ARCHIVE_RELEASE_URL = releaseFeatureUrl(
  BUN_RELEASE_1_3_6_FEATURE_ANCHORS.archive,
  RELEASE_1_3_6_BLOG
);
export const BUN_JSONC_RELEASE_URL = releaseFeatureUrl(
  BUN_RELEASE_1_3_6_FEATURE_ANCHORS.jsonc,
  RELEASE_1_3_6_BLOG
);
export const BUN_WEBSOCKET_PROXY_RELEASE_URL = releaseFeatureUrl(
  BUN_RELEASE_1_3_6_FEATURE_ANCHORS.websocketProxy,
  RELEASE_1_3_6_BLOG
);
export const BUN_COMPILE_EXECUTABLE_PATH_RELEASE_URL = releaseFeatureUrl(
  BUN_RELEASE_1_3_6_FEATURE_ANCHORS.compileExecutablePath,
  RELEASE_1_3_6_BLOG
);

/** Active-release feature deep links (v1.3.7 — features shipped that release). */
export const BUN_BUFFER_FROM_RELEASE_URL = releaseFeatureUrl(
  BUN_RELEASE_FEATURE_ANCHORS.bufferFrom
);
export const BUN_WRAP_ANSI_RELEASE_URL = releaseFeatureUrl(BUN_RELEASE_FEATURE_ANCHORS.wrapAnsi);
export const BUN_JSON5_RELEASE_URL = releaseFeatureUrl(BUN_RELEASE_FEATURE_ANCHORS.json5);
export const BUN_JSONL_RELEASE_URL = releaseFeatureUrl(BUN_RELEASE_FEATURE_ANCHORS.jsonl);
export const BUN_CPU_PROF_MD_RELEASE_URL = releaseFeatureUrl(BUN_RELEASE_FEATURE_ANCHORS.cpuProfMd);
export const BUN_HEAP_PROF_RELEASE_URL = releaseFeatureUrl(BUN_RELEASE_FEATURE_ANCHORS.heapProf);
export const BUN_HEADER_CASE_RELEASE_URL = releaseFeatureUrl(
  BUN_RELEASE_FEATURE_ANCHORS.headerCase
);
export const BUN_NODE_INSPECTOR_RELEASE_URL = releaseFeatureUrl(
  BUN_RELEASE_FEATURE_ANCHORS.nodeInspector
);
export const BUN_BUFFER_SWAP_RELEASE_URL = releaseFeatureUrl(
  BUN_RELEASE_FEATURE_ANCHORS.bufferSwap
);
export const BUN_REPL_MODE_RELEASE_URL = releaseFeatureUrl(BUN_RELEASE_FEATURE_ANCHORS.replMode);
export const BUN_S3_PRESIGN_RELEASE_URL = releaseFeatureUrl(BUN_RELEASE_FEATURE_ANCHORS.s3Presign);
export const BUN_S3_CONTENT_ENCODING_RELEASE_URL = releaseFeatureUrl(
  BUN_RELEASE_FEATURE_ANCHORS.s3ContentEncoding
);
export const BUN_FFI_NIXOS_RELEASE_URL = releaseFeatureUrl(BUN_RELEASE_FEATURE_ANCHORS.ffiNixOS);

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/** Structured error for release registry operations. Zero-dep — no Effect. */
export class ReleaseRegistryError extends Error {
  readonly code: string;
  readonly suggestion?: string;

  constructor(code: string, message: string, suggestion?: string) {
    super(message);
    this.name = "ReleaseRegistryError";
    this.code = code;
    this.suggestion = suggestion;
  }
}

/** Validate a release record has all required fields with correct types. */
export function assertReleaseRecord(
  record: unknown,
  label = "record"
): asserts record is BunReleaseRecord {
  if (!record || record === null || typeof record !== "object") {
    throw new ReleaseRegistryError(
      "INVALID_RECORD",
      `${label}: expected an object, got ${record === null ? "null" : typeof record}`,
      "Check that BUN_RELEASE_HISTORY entries match the BunReleaseRecord interface."
    );
  }
  const r = record as Record<string, unknown>;
  const required = [
    "version",
    "tag",
    "hash",
    "url",
    "blogUrl",
    "blogPublished",
    "author",
    "breaking",
  ];
  for (const field of required) {
    if (!(field in r)) {
      throw new ReleaseRegistryError(
        "MISSING_FIELD",
        `${label}.${field}: missing required field`,
        `Add "${field}" to the release record matching BunReleaseRecord.`
      );
    }
  }
  if (!Array.isArray(r.breaking)) {
    throw new ReleaseRegistryError(
      "INVALID_BREAKING",
      `${label}.breaking: expected an array, got ${typeof r.breaking}`,
      'The breaking field must be a string array, e.g. ["none"].'
    );
  }
}

/** Validate a blog URL is a bun.com blog post. */
export function validateBlogUrl(url: string, label = "blogUrl"): void {
  if (!url || typeof url !== "string") {
    throw new ReleaseRegistryError(
      "INVALID_BLOG_URL",
      `${label}: expected a string URL, got ${typeof url}`
    );
  }
  if (!url.startsWith("https://bun.com/blog/")) {
    throw new ReleaseRegistryError(
      "INVALID_BLOG_URL",
      `${label}: "${url}" is not a bun.com/blog URL`,
      "Blog URLs must start with https://bun.com/blog/."
    );
  }
}

/** Validate a semver string. */
export function validateSemver(version: string, label = "version"): void {
  if (!version || typeof version !== "string") {
    throw new ReleaseRegistryError(
      "INVALID_SEMVER",
      `${label}: expected a semver string, got ${typeof version}`
    );
  }
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    throw new ReleaseRegistryError(
      "INVALID_SEMVER",
      `${label}: "${version}" is not a valid semver`,
      "Version must be in X.Y.Z format, e.g. 1.3.7."
    );
  }
}

// ---------------------------------------------------------------------------
// Release diff — current vs previous
// ---------------------------------------------------------------------------

export interface ReleaseDiff {
  current: BunReleaseRecord;
  previous: BunReleaseRecord;
  /** Breaking entries present in current but not previous. */
  breakingAdded: readonly string[];
  /** Breaking entries present in previous but not current. */
  breakingRemoved: readonly string[];
  /** Net change in breaking entry count (added - removed). */
  breakingDelta: number;
  /** Commit comparison URL (previous..current). */
  commitRangeUrl: string;
  /** Days between previous and current publish dates. */
  publishedDeltaDays: number;
}

export function computeReleaseDiff(
  current: BunReleaseRecord = BUN_RELEASE,
  previous: BunReleaseRecord = BUN_RELEASE_PREVIOUS
): ReleaseDiff {
  assertReleaseRecord(current, "current");
  assertReleaseRecord(previous, "previous");
  validateSemver(current.version, "current.version");
  validateSemver(previous.version, "previous.version");

  const prevSet = new Set(previous.breaking.filter((b) => b !== "none"));
  const currSet = new Set(current.breaking.filter((b) => b !== "none"));
  const breakingAdded = [...currSet].filter((b) => !prevSet.has(b));
  const breakingRemoved = [...prevSet].filter((b) => !currSet.has(b));
  const prevDate = new Date(previous.blogPublished).getTime();
  const currDate = new Date(current.blogPublished).getTime();
  if (isNaN(prevDate) || isNaN(currDate)) {
    throw new ReleaseRegistryError(
      "INVALID_DATE",
      `Invalid blogPublished date: previous=${previous.blogPublished}, current=${current.blogPublished}`,
      "Dates must be ISO 8601 strings, e.g. 2026-01-27T07:04:03.000Z."
    );
  }
  const publishedDeltaDays = Math.round((currDate - prevDate) / 86_400_000);
  return {
    current,
    previous,
    breakingAdded,
    breakingRemoved,
    breakingDelta: breakingAdded.length - breakingRemoved.length,
    commitRangeUrl: `https://github.com/oven-sh/bun/compare/${previous.hash}...${current.hash}`,
    publishedDeltaDays,
  };
}

/** Diff any two versions by semver key. `to` is "current", `from` is "previous". */
export function computeReleaseDiffVersions(
  from: string,
  to: string,
  history: typeof BUN_RELEASE_HISTORY = BUN_RELEASE_HISTORY
): ReleaseDiff {
  validateSemver(from, "from");
  validateSemver(to, "to");
  const known = sortedReleaseVersions(history);
  const prev = history[from as BunReleaseVersion];
  const curr = history[to as BunReleaseVersion];
  if (!prev)
    throw new ReleaseRegistryError(
      "UNKNOWN_VERSION",
      `Unknown version: ${from}. Known: ${known.join(", ")}`,
      "Use bun run release:diff --list to see available versions."
    );
  if (!curr)
    throw new ReleaseRegistryError(
      "UNKNOWN_VERSION",
      `Unknown version: ${to}. Known: ${known.join(", ")}`,
      "Use bun run release:diff --list to see available versions."
    );
  return computeReleaseDiff(curr, prev);
}

/** Semver-sorted version keys from the history. */
export function sortedReleaseVersions(
  history: typeof BUN_RELEASE_HISTORY = BUN_RELEASE_HISTORY
): string[] {
  return sortReleaseVersions(Object.keys(history));
}

// ---------------------------------------------------------------------------
// SSOT verification
// ---------------------------------------------------------------------------

/** Minimal release metadata shape used for SSOT drift checks. */
export interface ReleaseMetadataSummary {
  version: string;
  tag: string;
  /** Commit hash when discoverable in the blog source; omitted when absent. */
  hash?: string;
  /** Number of feature commit links embedded in the blog source; omitted when absent. */
  featureCommitCount?: number;
}

/** One drift row — maps to columns: Field | Expected | Actual | Message. */
export interface ReleaseMetadataDrift {
  field: "hash" | "version" | "tag" | "featureCommitCount";
  expected: string;
  actual: string;
  message: string;
}

/** Result of comparing blog-discovered metadata against the registry SSOT. */
export interface ReleaseMetadataVerificationResult {
  ok: boolean;
  drifts: ReleaseMetadataDrift[];
}

/**
 * Compare release metadata discovered in a blog post against the registry SSOT.
 * Returns ok=true when version (semver), tag, commit hash, and feature commit count all agree.
 */
export function verifyReleaseMetadata(
  fromBlog: ReleaseMetadataSummary,
  fromRegistry: ReleaseMetadataSummary
): ReleaseMetadataVerificationResult {
  const drifts: ReleaseMetadataDrift[] = [];

  if (fromBlog.hash && fromRegistry.hash && fromBlog.hash !== fromRegistry.hash) {
    drifts.push({
      field: "hash",
      expected: fromRegistry.hash,
      actual: fromBlog.hash,
      message: `hash mismatch: blog has ${fromBlog.hash.slice(0, 12)}…, registry has ${fromRegistry.hash.slice(0, 12)}…`,
    });
  }

  const blogVersion = fromBlog.version.replace(/^v/, "");
  const registryVersion = fromRegistry.version.replace(/^v/, "");
  if (semver.order(blogVersion, registryVersion) !== 0) {
    drifts.push({
      field: "version",
      expected: registryVersion,
      actual: blogVersion,
      message: `version mismatch: blog has v${blogVersion}, registry has v${registryVersion}`,
    });
  }

  const blogTag = fromBlog.tag || `bun-v${blogVersion}`;
  if (blogTag !== fromRegistry.tag) {
    drifts.push({
      field: "tag",
      expected: fromRegistry.tag,
      actual: blogTag,
      message: `tag mismatch: blog derives ${blogTag}, registry has ${fromRegistry.tag}`,
    });
  }

  if (
    fromBlog.featureCommitCount !== undefined &&
    fromRegistry.featureCommitCount !== undefined &&
    fromBlog.featureCommitCount !== fromRegistry.featureCommitCount
  ) {
    drifts.push({
      field: "featureCommitCount",
      expected: String(fromRegistry.featureCommitCount),
      actual: String(fromBlog.featureCommitCount),
      message: `feature commit count mismatch: blog has ${fromBlog.featureCommitCount}, registry has ${fromRegistry.featureCommitCount}`,
    });
  }

  return { ok: drifts.length === 0, drifts };
}
