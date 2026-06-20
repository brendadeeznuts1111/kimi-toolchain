/**
 * Markdown dead-link lint — Bun.markdown.render extraction + Bun I/O / fetch.
 *
 * @see https://bun.com/docs/runtime/markdown
 */

import { dirname, join, normalize } from "path";
import { pathExists, readTextAsync } from "./bun-io.ts";
import { markdownRenderSupported } from "./bun-markdown.ts";

/** Fast offline scope (aligned with testing-docs-lint agent set). */
export const MARKDOWN_LINK_AGENT_DOCS = [
  "AGENTS.md",
  "README.md",
  "CONTRIBUTING.md",
  "UNIFIED.md",
  "TEMPLATES.md",
  "CODE_REFERENCES.md",
  "test/testing.md",
  "docs/references/bun-runtime-scaffold.md",
] as const;

export const MARKDOWN_LINK_EXTERNAL_TIMEOUT_MS = 5_000;
export const MARKDOWN_LINK_EXTERNAL_CONCURRENCY = 4;

export type MarkdownLinkCheckStatus =
  | "ok"
  | "missing_internal"
  | "external_skip"
  | "external_ok"
  | "external_fail"
  | "skipped_fragment"
  | "skipped_mailto"
  | "skipped_home_path";

export type MarkdownDeadLinkSeverity = "error" | "warn";

export interface MarkdownDeadLinkIssue {
  file: string;
  line: number;
  href: string;
  status: MarkdownLinkCheckStatus;
  severity: MarkdownDeadLinkSeverity;
  message: string;
}

export interface AuditMarkdownDeadLinksOptions {
  /** When true, include all docs markdown and skill SKILL.md files. */
  full?: boolean;
  /** When true, HEAD-check https?:// links (warn on failure). */
  online?: boolean;
  /** Optional explicit file list (relative to repo root). */
  paths?: readonly string[];
}

const MARKDOWN_LINK_RE =
  /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<https?:\/\/[^>]+>/g;

function stripLinkSuffix(href: string): { path: string; fragment: string | undefined } {
  const hash = href.indexOf("#");
  if (hash === -1) return { path: href, fragment: undefined };
  return { path: href.slice(0, hash), fragment: href.slice(hash + 1) };
}

/** Extract unique link targets from markdown (Bun.markdown.render when available). */
export function extractMarkdownLinks(text: string): string[] {
  const found = new Set<string>();

  if (markdownRenderSupported()) {
    Bun.markdown.render(text, {
      link: (_children, meta) => {
        if (meta?.href) found.add(meta.href);
        return null;
      },
      image: (_children, meta) => {
        if (meta?.src) found.add(meta.src);
        return null;
      },
      html: (raw) => {
        for (const m of raw.matchAll(/href=["']([^"']+)["']/gi)) {
          const href = m[1];
          if (href) found.add(href);
        }
        for (const m of raw.matchAll(/src=["']([^"']+)["']/gi)) {
          const src = m[1];
          if (src) found.add(src);
        }
        return null;
      },
    });
    return [...found];
  }

  for (const m of text.matchAll(MARKDOWN_LINK_RE)) {
    const href = m[1] ?? m[0]?.replace(/^<|>$/g, "");
    if (href) found.add(href);
  }
  return [...found];
}

export function classifyMarkdownHref(
  href: string
): "fragment" | "mailto" | "external" | "internal" | "home_path" {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#")) return "fragment";
  if (/^mailto:/i.test(trimmed)) return "mailto";
  if (/^https?:\/\//i.test(trimmed)) return "external";
  const { path } = stripLinkSuffix(trimmed);
  if (/^~/.test(path) || /^\$HOME\b/.test(path)) return "home_path";
  return "internal";
}

/** Resolve a repo-relative path for an internal markdown link. */
export function resolveInternalMarkdownTarget(
  root: string,
  fromRel: string,
  href: string
): string {
  const { path } = stripLinkSuffix(href.trim());
  if (!path) return join(root, dirname(fromRel));
  if (path.startsWith("/")) return join(root, path.slice(1));
  return normalize(join(root, dirname(fromRel), path));
}

function lineForHref(text: string, href: string): number {
  const lines = text.split("\n");
  const needle = href.includes(" ") ? href.split(" ")[0]! : href;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.includes(needle)) return i + 1;
  }
  return 0;
}

async function checkExternalHref(href: string): Promise<MarkdownLinkCheckStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MARKDOWN_LINK_EXTERNAL_TIMEOUT_MS);
  try {
    const res = await fetch(href, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    if (res.status === 405 || res.status === 501) {
      const getRes = await fetch(href, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
      });
      return getRes.ok ? "external_ok" : "external_fail";
    }
    return res.ok ? "external_ok" : "external_fail";
  } catch {
    return "external_fail";
  } finally {
    clearTimeout(timer);
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function collectMarkdownLinkScanPaths(
  root: string,
  options: Pick<AuditMarkdownDeadLinksOptions, "full" | "paths"> = {}
): Promise<string[]> {
  if (options.paths?.length) return [...options.paths];

  const paths = new Set<string>(MARKDOWN_LINK_AGENT_DOCS);
  if (options.full) {
    for (const pattern of ["docs/**/*.md", "skills/**/SKILL.md"] as const) {
      const glob = new Bun.Glob(pattern);
      for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
        paths.add(rel);
      }
    }
  }

  return [...paths].filter((rel) => pathExists(join(root, rel))).sort();
}

function issueFromStatus(
  file: string,
  line: number,
  href: string,
  status: MarkdownLinkCheckStatus
): MarkdownDeadLinkIssue | undefined {
  switch (status) {
    case "ok":
    case "external_ok":
    case "skipped_fragment":
    case "skipped_mailto":
    case "skipped_home_path":
    case "external_skip":
      return undefined;
    case "missing_internal":
      return {
        file,
        line,
        href,
        status,
        severity: "error",
        message: "Internal markdown link target does not exist",
      };
    case "external_fail":
      return {
        file,
        line,
        href,
        status,
        severity: "warn",
        message: "External link check failed (use offline mode to skip)",
      };
  }
}

export async function auditMarkdownDeadLinks(
  root: string,
  options: AuditMarkdownDeadLinksOptions = {}
): Promise<MarkdownDeadLinkIssue[]> {
  if (!markdownRenderSupported()) {
    return [
      {
        file: "(runtime)",
        line: 0,
        href: "",
        status: "external_skip",
        severity: "warn",
        message: "Bun.markdown.render unavailable — using regex fallback for link extraction",
      },
    ];
  }

  const paths = await collectMarkdownLinkScanPaths(root, options);
  const issues: MarkdownDeadLinkIssue[] = [];
  const externalChecks: Array<{ file: string; line: number; href: string }> = [];

  for (const rel of paths) {
    const text = await readTextAsync(join(root, rel));
    for (const href of extractMarkdownLinks(text)) {
      const line = lineForHref(text, href);
      const kind = classifyMarkdownHref(href);
      if (kind === "fragment" || kind === "mailto" || kind === "home_path") continue;

      if (kind === "external") {
        if (!options.online) continue;
        externalChecks.push({ file: rel, line, href });
        continue;
      }

      const { path } = stripLinkSuffix(href);
      if (!path) continue;
      const target = resolveInternalMarkdownTarget(root, rel, href);
      const status: MarkdownLinkCheckStatus = pathExists(target) ? "ok" : "missing_internal";
      const issue = issueFromStatus(rel, line, href, status);
      if (issue) issues.push(issue);
    }
  }

  if (options.online && externalChecks.length > 0) {
    const statuses = await mapPool(
      externalChecks,
      MARKDOWN_LINK_EXTERNAL_CONCURRENCY,
      (item) => checkExternalHref(item.href)
    );
    for (let i = 0; i < externalChecks.length; i++) {
      const item = externalChecks[i]!;
      const issue = issueFromStatus(item.file, item.line, item.href, statuses[i]!);
      if (issue) issues.push(issue);
    }
  }

  return issues;
}

export function formatMarkdownDeadLinkIssue(issue: MarkdownDeadLinkIssue): string {
  return `${issue.file}:${issue.line} [${issue.status}] ${issue.href} — ${issue.message}`;
}

export function formatMarkdownDeadLinkReport(issues: MarkdownDeadLinkIssue[]): string {
  const errors = issues.filter((i) => i.severity === "error");
  const warns = issues.filter((i) => i.severity === "warn");
  if (errors.length === 0 && warns.length === 0) return "markdown-links: ok";
  const lines = [`markdown-links: ${errors.length} error(s), ${warns.length} warning(s)`];
  for (const issue of issues) lines.push(`  ${formatMarkdownDeadLinkIssue(issue)}`);
  return lines.join("\n");
}