/**
 * Inline documentation URL lint — complements canonical-references.json (ecosystem roots).
 *
 * URLs are extracted from source lines and matched by parsed components
 * (protocol, username, password, hostname, port, pathname, search, hash).
 */

import { join } from "path";
import { readTextAsync } from "./bun-io.ts";

export interface DocLinkViolation {
  file: string;
  line: number;
  rule: "prefer-bun-com-docs" | "use-doc-constant";
  message: string;
  snippet: string;
}

/** URL components from `new URL()` — same decomposition as URLPattern parts. */
export const DOC_LINK_URL_FIELDS = [
  "protocol",
  "username",
  "password",
  "hostname",
  "port",
  "pathname",
  "search",
  "hash",
] as const;

export type DocLinkUrlField = (typeof DOC_LINK_URL_FIELDS)[number];

export interface DocLinkUrlParts {
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
}

/** Component-wise match spec — unset fields are wildcards. */
export interface BunDocLinkMatchSpec {
  protocols?: readonly string[];
  usernames?: readonly string[];
  passwords?: readonly string[];
  hostnames?: readonly string[];
  ports?: readonly string[];
  pathname?: string;
  pathnamePrefix?: string;
  search?: string;
  hash?: string;
  hashPrefix?: string;
}

/** Files that may keep the Bun ecosystem root on bun.sh. */
export const BUN_SH_DOCS_ALLOWLIST_FILES = new Set([
  "src/lib/canonical-references.ts",
  "src/lib/canonical-references-data.ts",
  "canonical-references.toml",
]);

/** Generated ecosystem manifest — literal homepage/docs URLs are intentional SSOT. */
export const DOC_CONSTANT_LITERAL_ALLOWLIST_FILES = new Set([
  "src/lib/canonical-references-data.ts",
]);

/** Shared Bun doc constants — defining file may contain the literal URL once. */
export const BUN_DOC_LINK_CONSTANTS = [
  {
    constant: "BUN_WEBVIEW_DOCS_URL",
    definingFile: "src/lib/webview-console.ts",
    match: {
      hostnames: ["bun.sh", "bun.com"],
      pathnamePrefix: "/docs/runtime/webview",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_INSTALL_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathnamePrefix: "/docs/pm/cli/install",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_RELEASE_1_3_7_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/blog/bun-v1.3.7",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_RELEASE_1_3_13_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/blog/bun-v1.3.13",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_BUFFER_FROM_OPTIMIZATION_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/blog/bun-v1.3.7",
      hash: "#faster-buffer-from-with-arrays",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_RUNTIME_GLOBALS_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/runtime/globals",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_HEX_DOC_URL",
    definingFile: "src/lib/bun-utils.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/runtime/binary-data",
      hashPrefix: "#uint8array-tohex",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_RUNTIME_BUN_APIS_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/runtime/bun-apis",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_RUNTIME_WEB_APIS_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/runtime/web-apis",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_API_REFERENCE_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/reference/bun",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_DOCS_RSS_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/rss.xml",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_BENCHMARKING_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/project/benchmarking",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_CGROUP_PARALLELISM_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathnamePrefix: "/docs/runtime/globals",
      hashPrefix: "#navigator-hardwareconcurrency",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_RUNTIME_HTTP_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/runtime/http",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_HTTPS_PROXY_KEEPALIVE_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathnamePrefix: "/docs/runtime/http",
      hashPrefix: "#proxying",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_TCP_DEFER_ACCEPT_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathnamePrefix: "/docs/runtime/http",
      hashPrefix: "#bun-serve",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_CRON_IN_PROCESS_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathnamePrefix: "/docs/runtime/cron",
      hashPrefix: "#bun-cronschedule-handler--in-process",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_CRON_OS_LEVEL_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathnamePrefix: "/docs/runtime/cron",
      hashPrefix: "#bun-cronscript-schedule-title--os-level",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_SLICE_ANSI_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathnamePrefix: "/docs/runtime/utils",
      hashPrefix: "#bun-sliceansi",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_MODULE_RESOLUTION_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/runtime/module-resolution",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_BINARY_DATA_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/runtime/binary-data",
      hash: "",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_WORKSPACES_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/pm/workspaces",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_PM_FILTER_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/pm/filter",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_WORKSPACES_GUIDE_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/guides/install/workspaces",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_GLOB_PATTERNS_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/runtime/glob",
      hashPrefix: "#supported-glob-patterns",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_CATALOGS_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/pm/catalogs",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_CATALOGS_OVERVIEW_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/pm/catalogs",
      hashPrefix: "#overview",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_WORKSPACES_CATALOGS_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/pm/workspaces",
      hashPrefix: "#share-versions-with-catalogs",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_WORKSPACES_GUIDE_MONOREPO_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/guides/install/workspaces",
      hashPrefix: "#configuring-a-monorepo-using-workspaces",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_PM_FILTER_MATCHING_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/pm/filter",
      hashPrefix: "#matching",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_LINK_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/pm/cli/link",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_PM_CLI_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/pm/cli/pm",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_PM_CLI_PKG_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/pm/cli/pm",
      hashPrefix: "#pkg",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_PUBLISH_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/cli/publish",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_SERVE_HOSTNAME_DOC_URL",
    definingFile: "src/lib/bun-utils.ts",
    match: {
      hostnames: ["bun.com"],
      pathnamePrefix: "/docs/runtime/http/server",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_IMAGE_DOCS_URL",
    definingFile: "src/lib/bun-image.ts",
    match: {
      hostnames: ["bun.com"],
      pathnamePrefix: "/docs/runtime/image",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_VERSION_GUIDE_DOC_URL",
    definingFile: "src/lib/bun-utils.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/guides/util/version",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_DETECT_BUN_GUIDE_DOC_URL",
    definingFile: "src/lib/bun-utils.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/guides/util/detect-bun",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_PM_UPDATE_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["bun.com"],
      pathnamePrefix: "/docs/pm/cli/update",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_RANDOM_UUIDV7_DOC_URL",
    definingFile: "src/lib/bun-utils.ts",
    match: {
      hostnames: ["bun.sh"],
      pathnamePrefix: "/reference/bun/randomUUIDv7",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_GZIP_DOC_URL",
    definingFile: "src/lib/bun-utils.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/guides/util/gzip",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_PASSWORD_DOC_URL",
    definingFile: "src/lib/bun-utils.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/guides/util/hash-a-password",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_FETCH_TLS_DOC_URL",
    definingFile: "src/lib/http-client.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/api/fetch",
      hash: "#tls",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_HTTPS_AGENT_OPTIONS_DOC_URL",
    definingFile: "src/lib/http-client.ts",
    match: {
      hostnames: ["bun.sh"],
      pathname: "/reference/node/https/AgentOptions",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_HTTPS_AGENT_MIN_VERSION_DOC_URL",
    definingFile: "src/lib/http-client.ts",
    match: {
      hostnames: ["bun.sh"],
      pathnamePrefix: "/reference/node/https/AgentOptions/minVersion",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_PUNYCODE_TO_ASCII_DOC_URL",
    definingFile: "src/lib/url-decomposer.ts",
    match: {
      hostnames: ["bun.sh"],
      pathname: "/reference/node/punycode/toASCII",
      hash: "#node:punycode.toASCII",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_PUNYCODE_ENCODE_DOC_URL",
    definingFile: "src/lib/url-decomposer.ts",
    match: {
      hostnames: ["bun.sh"],
      pathname: "/reference/node/punycode/encode",
      hash: "#node:punycode.encode",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_PUNYCODE_DECODE_DOC_URL",
    definingFile: "src/lib/url-decomposer.ts",
    match: {
      hostnames: ["bun.sh"],
      pathname: "/reference/node/punycode/decode",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_GUIDES_INDEX_DOC_URL",
    definingFile: "src/lib/cli-contract.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/guides",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_ARGV_DOC_URL",
    definingFile: "src/lib/cli-contract.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/guides/process/argv",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_STDIN_DOC_URL",
    definingFile: "src/lib/cli-contract.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/guides/process/stdin",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_STDOUT_DOC_URL",
    definingFile: "src/lib/cli-contract.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/guides/process/stdout",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_SPAWN_STDERR_DOC_URL",
    definingFile: "src/lib/cli-contract.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/guides/process/spawn-stderr",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_CTRL_C_DOC_URL",
    definingFile: "src/lib/cli-contract.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/guides/process/ctrl-c",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_HTML_STATIC_KEYBOARD_DOC_URL",
    definingFile: "src/lib/cli-contract.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/bundler/html-static",
      hash: "#keyboard-shortcuts",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_HTML_REWRITER_EXTRACT_LINKS_DOC_URL",
    definingFile: "src/lib/cli-contract.ts",
    match: {
      hostnames: ["bun.com"],
      pathname: "/docs/guides/html-rewriter/extract-links",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_CHILD_PROCESS_DOC_URL",
    definingFile: "src/lib/cli-contract.ts",
    match: {
      hostnames: ["bun.com"],
      pathnamePrefix: "/docs/runtime/child-process",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_FILE_IO_WRITE_DOC_URL",
    definingFile: "src/lib/cli-contract.ts",
    match: {
      hostnames: ["bun.com", "bun.sh"],
      pathnamePrefix: "/docs/runtime/file-io",
      hash: "#writing-files-bun-write",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_FILE_IO_REFERENCE_DOC_URL",
    definingFile: "src/lib/cli-contract.ts",
    match: {
      hostnames: ["bun.com", "bun.sh"],
      pathnamePrefix: "/docs/runtime/file-io",
      hash: "#reference",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "BUN_STREAMS_REFERENCE_DOC_URL",
    definingFile: "src/lib/cli-contract.ts",
    match: {
      hostnames: ["bun.com", "bun.sh"],
      pathnamePrefix: "/docs/runtime/streams",
      hash: "#reference",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "EFFECT_DOCS_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["effect.website"],
      pathname: "/docs",
      hash: "",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "EFFECT_GEN_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["effect.website"],
      pathnamePrefix: "/docs/effect/gen",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "EFFECT_TAGGED_ERROR_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["effect.website"],
      pathnamePrefix: "/docs/error-management/tagged-errors",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "EFFECT_LAYER_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["effect.website"],
      pathnamePrefix: "/docs/layers",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "EFFECT_RUNTIME_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["effect.website"],
      pathnamePrefix: "/docs/runtime",
    } satisfies BunDocLinkMatchSpec,
  },
  {
    constant: "EFFECT_ENSUREING_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    match: {
      hostnames: ["effect.website"],
      pathnamePrefix: "/docs/effect/ensuring",
    } satisfies BunDocLinkMatchSpec,
  },
] as const;

const DEFAULT_DOC_PROTOCOLS = ["http:", "https:"] as const;

const SCAN_GLOB = new Bun.Glob("src/**/*.ts");
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage"]);

const ABSOLUTE_URL_RE = /https?:\/\/[^\s"'`<>)\]]+/g;
const BARE_BUN_SH_DOCS_RE = /\bbun\.sh\/docs[^\s"'`<>)\]]*/g;

function trimTrailingUrlPunctuation(raw: string): string {
  return raw.replace(/[),.;]+$/, "");
}

/** Parse an absolute URL into component parts; returns null when invalid. */
export function parseDocLinkUrl(raw: string): DocLinkUrlParts | null {
  try {
    const url = new URL(trimTrailingUrlPunctuation(raw.trim()));
    return {
      protocol: url.protocol,
      username: url.username,
      password: url.password,
      hostname: url.hostname,
      port: url.port,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
    };
  } catch {
    return null;
  }
}

function includesOptional(values: readonly string[] | undefined, actual: string): boolean {
  if (values === undefined || values.length === 0) return true;
  return values.includes(actual);
}

/** True when parsed URL parts satisfy every set field on the spec. */
export function docLinkUrlMatchesSpec(parts: DocLinkUrlParts, spec: BunDocLinkMatchSpec): boolean {
  const protocols = spec.protocols ?? DEFAULT_DOC_PROTOCOLS;
  if (!protocols.includes(parts.protocol)) return false;
  if (!includesOptional(spec.usernames, parts.username)) return false;
  if (!includesOptional(spec.passwords, parts.password)) return false;
  if (!includesOptional(spec.hostnames, parts.hostname)) return false;
  if (!includesOptional(spec.ports, parts.port)) return false;
  if (spec.pathname !== undefined && parts.pathname !== spec.pathname) return false;
  if (spec.pathnamePrefix !== undefined && !parts.pathname.startsWith(spec.pathnamePrefix)) {
    return false;
  }
  if (spec.search !== undefined && parts.search !== spec.search) return false;
  if (spec.hash !== undefined && parts.hash !== spec.hash) return false;
  if (spec.hashPrefix !== undefined && !parts.hash.startsWith(spec.hashPrefix)) return false;
  return true;
}

function isLegacyBunShDocsUrl(parts: DocLinkUrlParts): boolean {
  return parts.hostname === "bun.sh" && parts.pathname.startsWith("/docs");
}

function isAllowlistedBunShRoot(rel: string, line: string): boolean {
  if (!BUN_SH_DOCS_ALLOWLIST_FILES.has(rel)) return false;
  return (
    /docs:\s*"https:\/\/bun\.sh\/docs"/.test(line) ||
    /homepage:\s*"https:\/\/bun\.sh"/.test(line) ||
    /docs\s*=\s*"https:\/\/bun\.sh\/docs"/.test(line) ||
    /homepage\s*=\s*"https:\/\/bun\.sh"/.test(line)
  );
}

function isExportedConstantDefinition(
  lines: string[],
  lineIndex: number,
  constant: string
): boolean {
  const exportRe = new RegExp(`export const ${constant}\\s*=`);
  for (let i = lineIndex; i >= Math.max(0, lineIndex - 1); i--) {
    if (exportRe.test(lines[i]!)) return true;
  }
  return false;
}

function lineUsesConstant(line: string, constant: string): boolean {
  return line.includes(constant);
}

/** Extract absolute and bare bun.sh/docs URLs from a source line. */
export function extractDocLinkUrls(line: string): { raw: string; parts: DocLinkUrlParts }[] {
  const found: { raw: string; parts: DocLinkUrlParts }[] = [];
  const seen = new Set<string>();

  for (const match of line.matchAll(ABSOLUTE_URL_RE)) {
    const raw = match[0]!;
    const parts = parseDocLinkUrl(raw);
    if (parts === null || seen.has(raw)) continue;
    seen.add(raw);
    found.push({ raw, parts });
  }

  for (const match of line.matchAll(BARE_BUN_SH_DOCS_RE)) {
    const bare = match[0]!;
    if (seen.has(bare)) continue;
    const parts = parseDocLinkUrl(`https://${bare}`);
    if (parts === null) continue;
    seen.add(bare);
    found.push({ raw: bare, parts });
  }

  return found;
}

export function scanDocLinkFile(rel: string, text: string): DocLinkViolation[] {
  const violations: DocLinkViolation[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;
    const trimmed = line.trim();
    const urls = extractDocLinkUrls(line);

    const isComment =
      trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/**");

    for (const { raw, parts } of urls) {
      if (!isLegacyBunShDocsUrl(parts) || isAllowlistedBunShRoot(rel, line)) continue;
      const isBareHostReference = !/^https?:\/\//i.test(raw);
      if (isBareHostReference && isComment) continue;
      violations.push({
        file: rel,
        line: lineNo,
        rule: "prefer-bun-com-docs",
        message:
          "legacy Bun docs host → prefer bun.com/docs for deep links (allowlist: canonical-references.toml / data.ts ecosystem root)",
        snippet: trimmed.slice(0, 120) || raw.slice(0, 120),
      });
    }

    if (isComment) continue;

    if (DOC_CONSTANT_LITERAL_ALLOWLIST_FILES.has(rel)) continue;

    for (const { parts } of urls) {
      for (const entry of BUN_DOC_LINK_CONSTANTS) {
        if (!docLinkUrlMatchesSpec(parts, entry.match)) continue;
        if (rel === entry.definingFile && isExportedConstantDefinition(lines, i, entry.constant)) {
          continue;
        }
        if (lineUsesConstant(line, entry.constant)) continue;
        violations.push({
          file: rel,
          line: lineNo,
          rule: "use-doc-constant",
          message: `use ${entry.constant} from ${entry.definingFile} instead of a raw Bun docs URL`,
          snippet: trimmed.slice(0, 120),
        });
      }
    }
  }

  return violations;
}

export async function lintDocLinks(
  root: string,
  onlyFiles?: string[]
): Promise<DocLinkViolation[]> {
  const violations: DocLinkViolation[] = [];

  if (onlyFiles !== undefined) {
    for (const rel of onlyFiles) {
      if (!rel.startsWith("src/") || !rel.endsWith(".ts")) continue;
      if (rel.split("/").some((seg) => SKIP_DIRS.has(seg))) continue;
      let text: string;
      try {
        text = await readTextAsync(join(root, rel));
      } catch {
        continue;
      }
      violations.push(...scanDocLinkFile(rel, text));
    }
    return violations;
  }

  for await (const rel of SCAN_GLOB.scan({ cwd: root, onlyFiles: true })) {
    if (rel.split("/").some((seg) => SKIP_DIRS.has(seg))) continue;
    let text: string;
    try {
      text = await readTextAsync(join(root, rel));
    } catch {
      continue;
    }
    violations.push(...scanDocLinkFile(rel, text));
  }

  return violations;
}

export function formatDocLinkViolation(v: DocLinkViolation): string {
  return `${v.file}:${v.line}: [${v.rule}] ${v.message}\n    ${v.snippet}`;
}
