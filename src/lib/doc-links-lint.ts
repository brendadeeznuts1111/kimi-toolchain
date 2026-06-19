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
export const BUN_SH_DOCS_ALLOWLIST_FILES = new Set(["src/lib/canonical-references.ts"]);

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
    constant: "BUN_IMAGE_DOCS_URL",
    definingFile: "src/lib/bun-image.ts",
    match: {
      hostnames: ["bun.com"],
      pathnamePrefix: "/docs/runtime/image",
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
    /docs:\s*"https:\/\/bun\.sh\/docs"/.test(line) || /homepage:\s*"https:\/\/bun\.sh"/.test(line)
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
          "legacy Bun docs host → prefer bun.com/docs for deep links (allowlist: canonical-references.ts ecosystem root)",
        snippet: trimmed.slice(0, 120) || raw.slice(0, 120),
      });
    }

    if (isComment) continue;

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
