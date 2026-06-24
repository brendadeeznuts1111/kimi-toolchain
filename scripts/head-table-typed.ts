#!/usr/bin/env bun
/**
 * Typed extraction tables for Bun blog pages.
 * Each row: Category · Property (key/name) · Type (inferred) · Href · Value
 *
 *   bun run scripts/head-table-typed.ts
 *   bun run scripts/head-table-typed.ts --section release
 *   bun run scripts/head-table-typed.ts --section release --format json
 *   bun run scripts/head-table-typed.ts --section release --out /tmp/bun-v1.3.6-release.md
 *   bun run scripts/head-table-typed.ts --section release --verify --md /tmp/bun-v1.3.7.md --html /tmp/bun-v1.3.7.html
 *   bun run scripts/head-table-typed.ts --section release --version 1.3.6 --verify --md /tmp/bun-v1.3.6.md --html /tmp/bun-v1.3.6.html
 */

import { semver } from "bun";
import {
  BUN_ARCHIVE_RELEASE_URL,
  BUN_COMPILE_EXECUTABLE_PATH_RELEASE_URL,
  BUN_JSONC_RELEASE_URL,
  BUN_RELEASE,
  BUN_RELEASE_HISTORY,
  BUN_WEBSOCKET_PROXY_RELEASE_URL,
  type BunReleaseRecord,
  type BunReleaseVersion,
  commitHashFromUrl,
  releaseCommitUrl,
  releaseMarkdownAlt,
  releaseOgImage,
} from "../src/lib/bun-release-registry.ts";
import { formatMarkdownPropertyTable } from "../src/lib/markdown-table.ts";

const VALUE_MAX = 42;

/** Standard category groups */
export const CATEGORIES = [
  "Constants",
  "SEO",
  "Assets",
  "Scripts",
  "JSON-LD",
  "Links",
  "Code",
  "Features",
  "APIs",
  "Performance",
  "References",
  "Source",
] as const;

export type TableCategory = (typeof CATEGORIES)[number];

export interface TypedRow {
  Category: TableCategory | string;
  Property: string;
  Type: string;
  Href: string;
  Value: string;
}

/** Curated release highlights — ID · Category · Property · Type · Value */
export interface ReleaseRow {
  ID: string;
  Category: string;
  Property: string;
  Type: string;
  Value: string;
  Href?: string;
}

const COLUMNS = ["Category", "Property", "Type", "Href", "Value"] as const;
const RELEASE_COLUMNS = ["ID", "Category", "Property", "Type", "Href", "Value"] as const;

export interface ReleaseMeta {
  version: string;
  canonical: string;
  datePublished: string;
  author: string;
  /** Full GitHub commit URL for the release tag */
  releaseCommitUrl: string;
  /** 40-char git SHA (oven-sh/bun) */
  releaseCommitHash: string;
  /** Git tag e.g. bun-v1.3.6 */
  gitTag: string;
  featureCommitCount: number;
  markdownAlt: string;
  ogImage: string;
}

const DEFAULT_CANONICAL = BUN_RELEASE.blogUrl;
const RELEASE_COMMIT_URL = releaseCommitUrl(BUN_RELEASE.hash);
const RELEASE_MARKDOWN_ALT = releaseMarkdownAlt(BUN_RELEASE.tag);
const RELEASE_OG_IMAGE = releaseOgImage(BUN_RELEASE.tag);

const HEAD_CONSTANTS = new Set(["title", "charset", "viewport", "theme-color"]);
const HEAD_SEO = (p: string) =>
  p.startsWith("og:") ||
  p.startsWith("twitter:") ||
  p.startsWith("article:") ||
  p === "description";

function truncate(value: string, max = VALUE_MAX): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

/** Infer Type from property name + raw value */
export function inferType(property: string, value: string): string {
  const v = value.trim();
  const p = property.toLowerCase();

  if (v === "[object Object]") return "serialization error";
  if (p.includes("textcontent") || p.endsWith(".count")) return "integer";
  if (p === "charset") return "encoding";
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return "color";
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return "ISO 8601";
  if (/^https?:\/\//.test(v)) return "URL";
  if (v.startsWith("@")) return "handle";
  if (v.startsWith("/")) return "path";
  if (v.startsWith("#")) return "fragment";
  if (/^\d+(\.\d+)?x$/i.test(v)) return "performance multiplier";
  if (/^\d+%$/.test(v)) return "performance percent";
  if (/^Bun\.[A-Za-z0-9_.()]+$/.test(property) || /^Bun\.[A-Za-z0-9_.]+/.test(v))
    return "global API";
  if (/^--[a-z]/.test(property) || /^--[a-z]/.test(v)) return "CLI flag";
  if (p.startsWith("og:") || p.startsWith("twitter:"))
    return p.includes("url") || p.includes("image") ? "URL" : "meta";
  if (p.startsWith("article:")) return p.includes("time") ? "ISO 8601" : "meta";
  if (p === "title" || p.endsWith(".name") || p.endsWith(".headline")) return "plain text";
  if (p === "description" || p.endsWith(".abstract")) return "summary text";
  if (p.startsWith("link:") && p.includes("stylesheet")) return "text/css";
  if (p.startsWith("link:") && p.includes("markdown")) return "text/markdown";
  if (p.startsWith("script:"))
    return v.startsWith("http") ? "script (external)" : "script (bundled)";
  if (
    p.includes("@type:") ||
    p.startsWith("websit") ||
    p.startsWith("organization") ||
    p.startsWith("article.")
  )
    return v.startsWith("http") ? "URL" : p.includes("date") ? "ISO 8601" : "literal";
  if (/^\d+$/.test(v)) return "integer";
  if (p.startsWith("feature.")) return "section anchor";
  return "literal";
}

function inferHref(value: string, type: string, canonical: string = DEFAULT_CANONICAL): string {
  const v = value.trim();
  if (!v || v === "—") return "—";
  if (type === "URL" || type === "script (external)" || type === "path") return v;
  if (
    type === "color" ||
    type === "integer" ||
    type === "encoding" ||
    type === "literal" ||
    type === "plain text"
  )
    return "—";
  if (type === "fragment" || type === "section anchor") {
    const fragment = v.startsWith("#") ? v : `#${v}`;
    return `${canonical}${fragment}`;
  }
  if (type === "handle" && v.startsWith("@")) return `https://twitter.com/${v.slice(1)}`;
  return "—";
}

function row(
  category: TableCategory | string,
  property: string,
  value: string,
  type?: string,
  href?: string,
  canonical?: string
): TypedRow {
  const resolvedType = type ?? inferType(property, value);
  return {
    Category: category,
    Property: property,
    Type: resolvedType,
    Href: href ?? inferHref(value, resolvedType, canonical ?? DEFAULT_CANONICAL),
    Value: truncate(value),
  };
}

function headCategory(property: string, rel?: string): TableCategory {
  if (HEAD_CONSTANTS.has(property)) return "Constants";
  if (property === "canonical" || property === "alternate") return "Constants";
  if (HEAD_SEO(property)) return "SEO";
  if (property.startsWith("msapplication") || rel) return "Assets";
  return "Constants";
}

function collectJsonLdUrls(data: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string" && node.startsWith("http")) {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, val] of Object.entries(node)) {
      if (key === "@context") continue;
      if ((key === "url" || key === "logo" || key === "@id") && typeof val === "string")
        out.push(val);
      else walk(val);
    }
  };
  walk(data);
  return [...new Set(out)];
}

export function buildJsonLdBlockRows(html: string): TypedRow[] {
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? html;
  const title = head.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
  const blocks = head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) ?? [];
  const rows: TypedRow[] = [];

  let fusedChars = title.length;
  for (let i = 0; i < blocks.length; i++) {
    const jsonText = blocks[i].replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    fusedChars += jsonText.length;
    const data = JSON.parse(jsonText) as Record<string, unknown>;
    const schemaType = String(data["@type"] ?? "?");
    const urls = collectJsonLdUrls(data);
    const primary = String(data.url ?? urls[0] ?? "—");

    rows.push(row("JSON-LD", `${schemaType}.textContent`, String(jsonText.length)));
    rows.push(row("JSON-LD", `${schemaType}.url`, primary, "URL", primary));
    for (const url of urls) {
      if (url === primary) continue;
      const suffix = url.includes("logo")
        ? "logo"
        : url.includes("twitter")
          ? "author.url"
          : "image";
      rows.push(row("JSON-LD", `${schemaType}.${suffix}`, url, "URL", url));
    }
  }

  rows.push(row("Constants", "title.textContent", String(title.length)));
  rows.push(row("JSON-LD", "fused.textContent", String(fusedChars)));
  return rows;
}

export function buildHeadRows(html: string): TypedRow[] {
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? html;
  const rows: TypedRow[] = [];

  const title = head.match(/<title>([^<]+)<\/title>/i)?.[1];
  if (title) rows.push(row("Constants", "title", title));

  for (const meta of head.match(/<meta[^>]+>/gi) ?? []) {
    const charset = meta.match(/charset="([^"]+)"/i)?.[1];
    const name = meta.match(/\bname="([^"]+)"/i)?.[1];
    const property = meta.match(/\bproperty="([^"]+)"/i)?.[1];
    const content = meta.match(/\bcontent="([^"]*)"/i)?.[1] ?? "";
    if (charset) {
      rows.push(row("Constants", "charset", charset));
      continue;
    }
    const key = name ?? property;
    if (!key) continue;
    rows.push(row(headCategory(key), key, content));
  }

  for (const link of head.match(/<link[^>]+>/gi) ?? []) {
    const rel = link.match(/\brel="([^"]+)"/i)?.[1] ?? "?";
    const href = link.match(/\bhref="([^"]+)"/i)?.[1] ?? "";
    const typeAttr = link.match(/\btype="([^"]+)"/i)?.[1];
    const sizes = link.match(/\bsizes="([^"]+)"/i)?.[1];
    const property =
      rel === "canonical" || rel === "alternate"
        ? rel
        : `link:${rel}${sizes ? `@${sizes}` : typeAttr ? `@${typeAttr}` : ""}`;
    const category = rel === "canonical" || rel === "alternate" ? "Constants" : "Assets";
    rows.push(row(category, property, href));
  }

  for (const open of head.match(/<script([^>]*)>/gi) ?? []) {
    if (/application\/ld\+json/i.test(open)) continue;
    const src = open.match(/\bsrc="([^"]+)"/i)?.[1];
    if (!src) continue;
    const basename = src.split("/").pop() ?? src;
    const domain = open.match(/data-domain="([^"]+)"/i)?.[1];
    const property = domain ? `script:plausible@${domain}` : `script:${basename}`;
    rows.push(row("Scripts", property, src));
  }

  for (const block of head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi) ??
    []) {
    const jsonText = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    const data = JSON.parse(jsonText) as Record<string, unknown>;
    const schemaType = String(data["@type"] ?? "?");
    for (const [key, val] of Object.entries(data)) {
      if (key === "@context" || key === "@type") continue;
      const prop = `${schemaType}.${key}`;
      if (key === "author" && Array.isArray(val)) {
        const person = val[0] as { name?: string; url?: string };
        rows.push(row("JSON-LD", `${schemaType}.author.name`, person.name ?? ""));
        rows.push(row("JSON-LD", `${schemaType}.author.url`, person.url ?? "", "URL", person.url));
        continue;
      }
      if (key === "image" && Array.isArray(val)) {
        rows.push(row("JSON-LD", prop, String(val[0] ?? ""), "URL", String(val[0] ?? "")));
        continue;
      }
      if (key === "sameAs" && Array.isArray(val)) {
        val.forEach((url, i) =>
          rows.push(row("JSON-LD", `${schemaType}.sameAs[${i}]`, String(url), "URL", String(url)))
        );
        continue;
      }
      const text = typeof val === "string" ? val : JSON.stringify(val);
      const typ = inferType(prop, text);
      rows.push(row("JSON-LD", prop, text, typ, typ === "URL" ? text : undefined));
    }
  }

  return rows;
}

export function buildContentRows(html: string, md: string): TypedRow[] {
  const rows: TypedRow[] = [];

  const preCount = (html.match(/<pre\b/gi) ?? []).length;
  const hrefCount = (html.match(/\bhref="/gi) ?? []).length;
  const codeCount = (html.match(/<code\b/gi) ?? []).length;
  const anchorIds = [...html.matchAll(/<h[23][^>]*\bid="([^"]+)"/gi)].map((m) => m[1]);
  const headHrefCount = (html.match(/<head[^>]*>[\s\S]*?<\/head>/i)?.[0].match(/\bhref="/gi) ?? [])
    .length;

  rows.push(row("Code", "codeBlocks.count", String(preCount)));
  rows.push(row("Code", "inlineCode.count", String(codeCount)));
  rows.push(row("Links", "href.page.count", String(hrefCount)));
  rows.push(row("Links", "href.head.count", String(headHrefCount)));
  rows.push(row("Features", "anchors.count", String(anchorIds.length)));

  const seenApis = new Set<string>();
  for (const match of html.matchAll(/<h([23])[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<\/h\1>/gi)) {
    const id = match[2];
    const text = match[0]
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    rows.push(
      row("Features", `feature.${id}`, text, "section anchor", `${DEFAULT_CANONICAL}#${id}`)
    );
    for (const api of text.matchAll(/Bun\.[A-Za-z0-9_.]+/g)) {
      const name = api[0].replace(/\(\)$/, "");
      if (seenApis.has(name)) continue;
      seenApis.add(name);
      rows.push(row("APIs", name, name, "global API"));
    }
  }

  const perfClaims = [
    ...md.matchAll(/(\d+(?:\.\d+)?x)\s+faster/gi),
    ...md.matchAll(/(\d+)%\s+faster/gi),
  ];
  const seenPerf = new Set<string>();
  for (const match of perfClaims) {
    const raw = match[1] ?? "";
    const mult = match[0].includes("%") ? `${raw}%` : raw;
    if (seenPerf.has(mult)) continue;
    seenPerf.add(mult);
    rows.push(row("Performance", mult, mult));
  }

  const seenFlags = new Set<string>();
  for (const m of md.matchAll(/`(--[a-z][a-z0-9-]*)`/g)) {
    const flag = m[1];
    if (seenFlags.has(flag)) continue;
    seenFlags.add(flag);
    rows.push(row("Code", flag, flag, "CLI flag"));
  }

  const kimiAnchors: Record<string, string> = {
    "Bun.Archive": BUN_ARCHIVE_RELEASE_URL,
    "Bun.JSONC": BUN_JSONC_RELEASE_URL,
    "--compile-executable-path": BUN_COMPILE_EXECUTABLE_PATH_RELEASE_URL,
    "WebSocket proxy": BUN_WEBSOCKET_PROXY_RELEASE_URL,
  };
  for (const [label, url] of Object.entries(kimiAnchors)) {
    rows.push(row("References", `kimi.@see.${label}`, url, "URL", url));
  }

  const featureCommits = [
    ...md.matchAll(/<!--\s*(https:\/\/github\.com\/oven-sh\/bun\/commit\/[a-f0-9]+)\s*-->/g),
  ].map((m) => m[1]);
  rows.push(row("Source", "featureCommits.count", String(featureCommits.length)));
  rows.push(row("Source", "releaseCommit.hash", BUN_RELEASE.hash, "git SHA", RELEASE_COMMIT_URL));
  rows.push(row("Source", "releaseCommit.url", RELEASE_COMMIT_URL, "URL", RELEASE_COMMIT_URL));
  rows.push(
    row(
      "Source",
      "git.tag",
      BUN_RELEASE.tag,
      "git tag",
      `https://github.com/oven-sh/bun/releases/tag/${BUN_RELEASE.tag}`
    )
  );
  rows.push(
    row("Source", "BUN_RELEASE.blogUrl", BUN_RELEASE.blogUrl, "string", BUN_RELEASE.blogUrl)
  );
  rows.push(row("Source", "BUN_RELEASE.hash", BUN_RELEASE.hash, "string", RELEASE_COMMIT_URL));
  rows.push(
    row("Source", "BUN_RELEASE.version", BUN_RELEASE.version, "semver", BUN_RELEASE.blogUrl)
  );

  return rows;
}

const RELEASE_ANCHOR = (slug: string) => `${BUN_RELEASE.blogUrl}#${slug}`;

export interface ReleaseMetaDrift {
  field: "hash" | "tag" | "version";
  expected: string;
  actual: string;
  message: string;
}

function parseMdVersion(md: string): string | null {
  const fm = parseMdFrontmatter(md);
  const title = fm.title ?? "";
  const match = title.match(/\b(v?\d+\.\d+\.\d+)\b/);
  return match?.[1] ?? null;
}

/**
 * Compare release metadata discovered in the blog .md against the registry SSOT.
 * Returns an empty array when the sources agree or when the .md lacks parseable metadata.
 */
export function verifyReleaseMeta(
  md: string,
  target: BunReleaseRecord = BUN_RELEASE
): ReleaseMetaDrift[] {
  const drifts: ReleaseMetaDrift[] = [];
  const commits = [
    ...md.matchAll(/<!--\s*(https:\/\/github\.com\/oven-sh\/bun\/commit\/[a-f0-9]+)\s*-->/g),
  ].map((x) => x[1]);
  const parsedCommitUrl = commits.at(-1) ?? "";
  const parsedHash = parsedCommitUrl ? commitHashFromUrl(parsedCommitUrl) : "";

  if (parsedHash && parsedHash !== target.hash) {
    drifts.push({
      field: "hash",
      expected: target.hash,
      actual: parsedHash,
      message: `release commit hash mismatch: blog .md has ${parsedHash.slice(0, 12)}…, registry has ${target.hash.slice(0, 12)}…`,
    });
  }

  const parsedVersion = parseMdVersion(md);
  if (parsedVersion && semver.order(parsedVersion, target.version) !== 0) {
    drifts.push({
      field: "version",
      expected: target.version,
      actual: parsedVersion,
      message: `release version mismatch: blog .md has v${parsedVersion}, registry has v${target.version}`,
    });
  }

  const parsedTag = parsedVersion ? `bun-v${parsedVersion.replace(/^v/, "")}` : null;
  if (parsedTag && parsedTag !== target.tag) {
    drifts.push({
      field: "tag",
      expected: target.tag,
      actual: parsedTag,
      message: `release tag mismatch: registry has ${target.tag}, .md derives ${parsedTag}`,
    });
  }

  return drifts;
}

function parseMdFrontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*"?([^"]*)"?\s*$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

export function parseReleaseMeta(md: string, html: string): ReleaseMeta {
  const fm = parseMdFrontmatter(md);
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const article = head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)?.[2];
  let author = "Jarred Sumner";
  let datePublished = fm.date ?? "";
  if (article) {
    const data = JSON.parse(article.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "")) as {
      datePublished?: string;
      author?: { name?: string }[];
    };
    datePublished = data.datePublished ?? datePublished;
    author = data.author?.[0]?.name ?? author;
  }
  const commits = [
    ...md.matchAll(/<!--\s*(https:\/\/github\.com\/oven-sh\/bun\/commit\/[a-f0-9]+)\s*-->/g),
  ].map((x) => x[1]);
  const ogImage = head.match(/name="og:image"\s+content="([^"]+)"/i)?.[1] ?? RELEASE_OG_IMAGE;

  return {
    version: fm.title ?? `Bun v${BUN_RELEASE.version}`,
    canonical: BUN_RELEASE.blogUrl,
    datePublished: datePublished || BUN_RELEASE.blogPublished,
    author,
    releaseCommitUrl: RELEASE_COMMIT_URL,
    releaseCommitHash: BUN_RELEASE.hash,
    gitTag: BUN_RELEASE.tag,
    featureCommitCount: commits.length,
    markdownAlt: RELEASE_MARKDOWN_ALT,
    ogImage: ogImage || RELEASE_OG_IMAGE,
  };
}

function releaseMetaRows(meta: ReleaseMeta): ReleaseRow[] {
  return [
    {
      ID: "M1",
      Category: "📋 Release Meta",
      Property: "version",
      Type: "semver",
      Value: meta.version,
      Href: meta.canonical,
    },
    {
      ID: "M2",
      Category: "📋 Release Meta",
      Property: "datePublished",
      Type: "ISO 8601",
      Value: meta.datePublished,
      Href: meta.canonical,
    },
    {
      ID: "M3",
      Category: "📋 Release Meta",
      Property: "author",
      Type: "plain text",
      Value: meta.author,
      Href: "https://twitter.com/jarredsumner",
    },
    {
      ID: "M4",
      Category: "📋 Release Meta",
      Property: "canonical",
      Type: "URL",
      Value: meta.canonical,
      Href: meta.canonical,
    },
    {
      ID: "M5",
      Category: "📋 Release Meta",
      Property: "markdown.alt",
      Type: "text/markdown",
      Value: meta.markdownAlt,
      Href: `${meta.canonical}.md`,
    },
    {
      ID: "M6",
      Category: "📋 Release Meta",
      Property: "og:image",
      Type: "URL",
      Value: meta.ogImage,
      Href: meta.ogImage,
    },
  ];
}

/** Git provenance — release tag commit + feature commit inventory */
function releaseSourceRows(meta: ReleaseMeta): ReleaseRow[] {
  const shortHash = meta.releaseCommitHash.slice(0, 12);
  return [
    {
      ID: "S1",
      Category: "📦 Source",
      Property: "releaseCommit.hash",
      Type: "git SHA",
      Value: meta.releaseCommitHash,
      Href: meta.releaseCommitUrl,
    },
    {
      ID: "S2",
      Category: "📦 Source",
      Property: "releaseCommit.url",
      Type: "URL",
      Value: shortHash ? `${shortHash}…` : "—",
      Href: meta.releaseCommitUrl,
    },
    {
      ID: "S3",
      Category: "📦 Source",
      Property: "git.tag",
      Type: "git tag",
      Value: meta.gitTag,
      Href: `https://github.com/oven-sh/bun/releases/tag/${meta.gitTag}`,
    },
    {
      ID: "S4",
      Category: "📦 Source",
      Property: "featureCommits.count",
      Type: "integer",
      Value: String(meta.featureCommitCount),
      Href: `${meta.canonical}.md`,
    },
    {
      ID: "S5",
      Category: "📦 Source",
      Property: "BUN_RELEASE.blogUrl",
      Type: "string",
      Value: BUN_RELEASE.blogUrl,
      Href: BUN_RELEASE.blogUrl,
    },
    {
      ID: "S6",
      Category: "📦 Source",
      Property: "BUN_RELEASE.hash",
      Type: "string",
      Value: BUN_RELEASE.hash,
      Href: RELEASE_COMMIT_URL,
    },
    {
      ID: "S7",
      Category: "📦 Source",
      Property: "BUN_RELEASE.version",
      Type: "semver",
      Value: BUN_RELEASE.version,
      Href: BUN_RELEASE.blogUrl,
    },
  ];
}

/** Curated v1.3.6 release highlights + parsed meta */
export function buildReleaseContentRows(md = "", html = ""): ReleaseRow[] {
  const meta = md && html ? parseReleaseMeta(md, html) : parseReleaseMeta("", "");
  const highlights: ReleaseRow[] = [
    // 🌐 New Globals
    {
      ID: "G1",
      Category: "🌐 New Globals",
      Property: "Bun.Archive",
      Type: "API (constructor)",
      Value: "new Bun.Archive(files, { compress?: 'gzip', level?: 1–12 })",
      Href: BUN_ARCHIVE_RELEASE_URL,
    },
    {
      ID: "G2",
      Category: "🌐 New Globals",
      Property: "Bun.JSONC.parse",
      Type: "API (static)",
      Value: "parse JSONC — // comments, block comments, trailing commas",
      Href: BUN_JSONC_RELEASE_URL,
    },
    {
      ID: "G3",
      Category: "🌐 New Globals",
      Property: "Bun.hash.crc32",
      Type: "API (hash)",
      Value: "20x faster CRC32 on typical workloads",
      Href: RELEASE_ANCHOR("bun-hash-crc32-is-now-20x-faster"),
    },
    // 🛠 Build & CLI
    {
      ID: "B1",
      Category: "🛠 Build & CLI",
      Property: "Bun.build.metafile",
      Type: "build option",
      Value: "esbuild-compatible bundle analysis metadata (inputs/outputs)",
      Href: RELEASE_ANCHOR("metafile-in-bun-build"),
    },
    {
      ID: "B2",
      Category: "🛠 Build & CLI",
      Property: "Bun.build.files",
      Type: "build option",
      Value: "virtual in-memory files override or replace disk modules",
      Href: RELEASE_ANCHOR("files-in-bun-build"),
    },
    {
      ID: "B3",
      Category: "🛠 Build & CLI",
      Property: "--compile-executable-path",
      Type: "CLI flag",
      Value: "local bun binary for cross-compile (air-gapped / custom builds)",
      Href: BUN_COMPILE_EXECUTABLE_PATH_RELEASE_URL,
    },
    {
      ID: "B4",
      Category: "🛠 Build & CLI",
      Property: "Bun.build.reactFastRefresh",
      Type: "build option",
      Value: "inject React Fast Refresh ($RefreshReg$, $RefreshSig$)",
      Href: RELEASE_ANCHOR("reactfastrefresh-option-in-bun-build"),
    },
    {
      ID: "B5",
      Category: "🛠 Build & CLI",
      Property: "--grep",
      Type: "CLI flag",
      Value: "filter bun test by name pattern (like --test-name-pattern)",
      Href: RELEASE_ANCHOR("grep-flag-for-bun-test"),
    },
    // 📈 Performance
    {
      ID: "P1",
      Category: "📈 Performance",
      Property: "Response.json()",
      Type: "speedup: 3.5x",
      Value: "now parity with manual JSON.stringify + new Response()",
      Href: RELEASE_ANCHOR("response-json-object-is-now-3-5x-faster"),
    },
    {
      ID: "P2",
      Category: "📈 Performance",
      Property: "async/await",
      Type: "speedup: 15%",
      Value: "JSC engine improvement (Bun + Safari line)",
      Href: RELEASE_ANCHOR("15-faster-async-await"),
    },
    {
      ID: "P3",
      Category: "📈 Performance",
      Property: "Promise.race",
      Type: "speedup: 30%",
      Value: "faster Promise.race across concurrent awaits",
      Href: RELEASE_ANCHOR("30-faster-promise-race"),
    },
    {
      ID: "P4",
      Category: "📈 Performance",
      Property: "Buffer.indexOf / includes",
      Type: "speedup: 2x",
      Value: "SIMD-optimized search in large buffers",
      Href: RELEASE_ANCHOR("faster-buffer-indexof"),
    },
    {
      ID: "P5",
      Category: "📈 Performance",
      Property: "embedded .node files (Linux)",
      Type: "speedup: faster load",
      Value: "faster embedded native module extraction on Linux",
      Href: RELEASE_ANCHOR("faster-embedded-node-files-on-linux"),
    },
    {
      ID: "P6",
      Category: "📈 Performance",
      Property: "IPC",
      Type: "speedup: 9x",
      Value: "faster cross-process JSON IPC",
      Href: RELEASE_ANCHOR("faster-ipc"),
    },
    {
      ID: "P7",
      Category: "📈 Performance",
      Property: "Bun.spawnSync (Linux ARM64)",
      Type: "speedup: faster",
      Value: "faster synchronous spawn on Linux aarch64",
      Href: RELEASE_ANCHOR("faster-bun-spawnsync-on-linux-arm64"),
    },
    {
      ID: "P8",
      Category: "📈 Performance",
      Property: "JSON serialization",
      Type: "speedup: 3x",
      Value: "faster JSON across Bun.file, Bun.write, Response, etc.",
      Href: RELEASE_ANCHOR("faster-json-serialization-across-bun-apis"),
    },
    // 🌐 Web & Network
    {
      ID: "W1",
      Category: "🌐 Web & Network",
      Property: "WebSocket client",
      Type: "proxy support",
      Value: "HTTP/HTTPS proxy honored when HTTP(S)_PROXY set",
      Href: BUN_WEBSOCKET_PROXY_RELEASE_URL,
    },
    {
      ID: "W2",
      Category: "🌐 Web & Network",
      Property: "S3 client",
      Type: "Requester Pays",
      Value: "requester-pays bucket support on read/write/stat/multipart",
      Href: RELEASE_ANCHOR("s3-requester-pays-support"),
    },
    // 🧪 Testing & SQL
    {
      ID: "T1",
      Category: "🧪 Testing",
      Property: "fake timers",
      Type: "compat fix",
      Value: "now work with @testing-library/react",
      Href: RELEASE_ANCHOR("fake-timers-now-work-with-testing-library-react"),
    },
    {
      ID: "T2",
      Category: "🧪 Testing",
      Property: "sql() INSERT",
      Type: "behavior fix",
      Value: "undefined values respected (not coerced to NULL)",
      Href: RELEASE_ANCHOR("sql-insert-helper-now-respects-undefined-values"),
    },
    // 🐛 Fixes & Compat
    {
      ID: "F1",
      Category: "🐛 Fixes & Compat",
      Property: "issues addressed",
      Type: "count: 45",
      Value: "addressing 125 👍 across runtime, bundler, Node compat",
      Href: DEFAULT_CANONICAL,
    },
    {
      ID: "F2",
      Category: "🐛 Fixes & Compat",
      Property: "SQLite",
      Type: "version: 3.51.2",
      Value: "bundled SQLite upgraded",
      Href: RELEASE_ANCHOR("updated-sqlite-to-3-51-2"),
    },
    {
      ID: "F3",
      Category: "🐛 Fixes & Compat",
      Property: "Node.js compatibility",
      Type: "changelog section",
      Value: "Bun APIs, Web APIs, bun install, minifier, bundler, CSS, types, Windows",
      Href: RELEASE_ANCHOR("bugfixes"),
    },
    {
      ID: "F4",
      Category: "🐛 Fixes & Compat",
      Property: "contributors",
      Type: "count: 23",
      Value: "community contributors thanked in release post",
      Href: RELEASE_ANCHOR("thanks-to-23-contributors"),
    },
    // 🔗 kimi-toolchain alignment
    {
      ID: "K1",
      Category: "🔗 kimi @see",
      Property: "herdr-ws-unix.ts",
      Type: "doc fragment",
      Value: "HTTP(S)_PROXY for remote wss:// WebSocket",
      Href: BUN_WEBSOCKET_PROXY_RELEASE_URL,
    },
    {
      ID: "K2",
      Category: "🔗 kimi @see",
      Property: "safe-parse.ts",
      Type: "doc fragment",
      Value: "Bun.JSONC.parse availability gate (>= 1.3.6)",
      Href: BUN_JSONC_RELEASE_URL,
    },
    {
      ID: "K3",
      Category: "🔗 kimi @see",
      Property: "compile-target.ts",
      Type: "doc fragment",
      Value: "--compile-executable-path / executablePath cross-compile",
      Href: BUN_COMPILE_EXECUTABLE_PATH_RELEASE_URL,
    },
    {
      ID: "K4",
      Category: "🔗 kimi @see",
      Property: "archive-persistence.ts",
      Type: "doc fragment",
      Value: "Bun.Archive create/extract for sync archives",
      Href: BUN_ARCHIVE_RELEASE_URL,
    },
  ];
  return [...releaseMetaRows(meta), ...highlights, ...releaseSourceRows(meta)];
}

export function releaseCategoryCounts(rows: ReleaseRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.Category] = (counts[r.Category] ?? 0) + 1;
  return counts;
}

export function formatReleaseTable(
  rows: ReleaseRow[],
  title = "BUN v1.3.6 – RELEASE CONTENT",
  meta?: ReleaseMeta
): string {
  const COL = { id: 4, cat: 20, prop: 26, type: 16, href: 36, val: 36 };
  const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
  const inner = COL.id + COL.cat + COL.prop + COL.type + COL.href + COL.val + 6 * 3 + 2;
  const rule = "─".repeat(inner);
  const lines: string[] = [
    `📄 ${title} (Property + Type + Href)`,
    meta ? `   ${meta.version} · ${meta.datePublished.slice(0, 10)} · ${meta.author}` : "",
    rule,
    `│ ${pad("ID", COL.id)} │ ${pad("Category", COL.cat)} │ ${pad("Property", COL.prop)} │ ${pad("Type", COL.type)} │ ${pad("Href", COL.href)} │ ${pad("Value", COL.val)} │`,
    rule,
  ].filter(Boolean);

  let lastCat = "";
  for (const r of rows) {
    if (r.Category !== lastCat) {
      if (lastCat) lines.push(`├${"─".repeat(inner - 2)}`);
      lastCat = r.Category;
    }
    const href = r.Href ?? "—";
    lines.push(
      `│ ${pad(r.ID, COL.id)} │ ${pad(r.Category, COL.cat)} │ ${pad(r.Property, COL.prop)} │ ${pad(r.Type, COL.type)} │ ${pad(href, COL.href)} │ ${pad(r.Value, COL.val)} │`
    );
  }
  lines.push(rule);
  const counts = releaseCategoryCounts(rows);
  const summary = Object.entries(counts)
    .map(([cat, n]) => `${cat.replace(/^[^\s]+\s/, "")} ${n}`)
    .join(" · ");
  lines.push(`➜ ${rows.length} entries · ${summary}`);
  return lines.join("\n");
}

function parseArgs(argv: string[]): {
  htmlPath: string;
  mdPath: string;
  section: "head" | "content" | "jsonld" | "release" | "all";
  format: "table" | "json" | "md";
  outPath?: string;
  verify: boolean;
  targetVersion: string | null;
} {
  let htmlPath = "/tmp/bun-v1.3.6.html";
  let mdPath = "/tmp/bun-v1.3.6.md";
  let section: "head" | "content" | "jsonld" | "release" | "all" = "all";
  let format: "table" | "json" | "md" = "table";
  let outPath: string | undefined;
  let verify = false;
  let targetVersion: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--html") htmlPath = argv[++i] ?? htmlPath;
    else if (arg === "--md") mdPath = argv[++i] ?? mdPath;
    else if (arg === "--out") outPath = argv[++i];
    else if (arg === "--verify") verify = true;
    else if (arg === "--version") targetVersion = argv[++i] ?? null;
    else if (arg === "--format") {
      const next = argv[++i];
      if (next === "table" || next === "json" || next === "md") format = next;
    } else if (arg === "--section") {
      const next = argv[++i];
      if (
        next === "head" ||
        next === "content" ||
        next === "jsonld" ||
        next === "release" ||
        next === "all"
      )
        section = next;
    }
  }
  return { htmlPath, mdPath, section, format, outPath, verify, targetVersion };
}

function releaseToMarkdown(rows: ReleaseRow[], meta: ReleaseMeta): string {
  const table = formatMarkdownPropertyTable({
    title: `Bun ${meta.version} Release Content`,
    source: meta.canonical,
    columns: RELEASE_COLUMNS,
    rows: rows.map((r) => ({
      ID: r.ID,
      Category: r.Category,
      Property: r.Property,
      Type: r.Type,
      Href: r.Href ?? "—",
      Value: r.Value,
    })),
  });
  return table;
}

async function main(): Promise<void> {
  const { htmlPath, mdPath, section, format, outPath, verify, targetVersion } = parseArgs(
    Bun.argv.slice(2)
  );
  const html = await Bun.file(htmlPath).text();
  const md = await Bun.file(mdPath).text();

  const releaseToVerify = targetVersion
    ? BUN_RELEASE_HISTORY[targetVersion as BunReleaseVersion]
    : BUN_RELEASE;
  if (targetVersion && !releaseToVerify) {
    console.error(`No registry entry for version ${targetVersion}`);
    process.exit(1);
  }

  const headRows = buildHeadRows(html);
  const contentRows = buildContentRows(html, md);
  const jsonLdRows = buildJsonLdBlockRows(html);
  const releaseMeta = parseReleaseMeta(md, html);
  const releaseRows = buildReleaseContentRows(md, html);

  const drifts = verifyReleaseMeta(md, releaseToVerify);
  if (drifts.length > 0) {
    const summary = drifts.map((d) => d.message).join("; ");
    if (verify) {
      throw new Error(`release_metadata_drift: ${summary}`);
    }
    for (const d of drifts) {
      console.error(`WARN: ${d.message} — update bun-release-registry.ts`);
    }
  }

  const print = (title: string, rows: TypedRow[]) => {
    console.log(`\n## ${title} (${rows.length} rows)\n`);
    const table = formatMarkdownPropertyTable({
      title,
      columns: COLUMNS,
      rows: rows.map((r) => Object.fromEntries(COLUMNS.map((c) => [c, r[c]]))),
      columnSpecs: COLUMNS.map((name) => ({ name, kind: "text" as const })),
    });
    console.log(table.replace(/^# .+\n\n/, ""));
  };

  if (section === "release" || section === "all") {
    let output = "";
    if (format === "json") {
      output = JSON.stringify(
        { meta: releaseMeta, rows: releaseRows, counts: releaseCategoryCounts(releaseRows) },
        null,
        2
      );
      console.log(output);
    } else if (format === "md") {
      output = releaseToMarkdown(releaseRows, releaseMeta);
      console.log(output);
    } else {
      const ascii = formatReleaseTable(
        releaseRows,
        `BUN ${releaseMeta.version} – RELEASE CONTENT`,
        releaseMeta
      );
      const mdTable = releaseToMarkdown(releaseRows, releaseMeta);
      output = `${ascii}\n\n${mdTable}`;
      console.log(`\n${ascii}\n\n${mdTable.replace(/^# .+\n\n(Source:[^\n]*\n)?/, "")}`);
    }
    if (outPath) {
      await Bun.write(outPath, output || releaseToMarkdown(releaseRows, releaseMeta));
      console.error(`\nWrote ${outPath}`);
    }
  }

  if (section === "head" || section === "all") print("<head>", headRows);
  if (section === "jsonld" || section === "all") print("JSON-LD blocks", jsonLdRows);
  if (section === "content" || section === "all") print("Blog content", contentRows);

  if (section === "all") {
    const all = [...headRows, ...jsonLdRows, ...contentRows];
    const byCat = Object.groupBy(all, (r) => r.Category);
    console.log("\n## By category\n");
    for (const cat of CATEGORIES) {
      const n = byCat[cat]?.length ?? 0;
      if (n > 0) console.log(`  ${cat}: ${n}`);
    }
    console.log(`\nTotal: ${all.length} rows`);
  }
}

if (import.meta.main) {
  await main();
}
