/**
 * embedded-docs.ts — Documentation sections embedded at build time via Bun macros.
 *
 * Uses Bun.markdown.html() + HTMLRewriter to extract sections from project
 * documentation files at BUILD TIME. The bundled output contains only the
 * extracted text as static strings — no file reads, no markdown parsing,
 * no HTMLRewriter at runtime.
 *
 * Usage:
 *   import { installGuide, scannerOverview, readmeHeadings }
 *     from "./embedded-docs.ts";
 */

import { extractReadmeSection, extractHeadings } from "./readme-macros.ts" with { type: "macro" };

// ── Embedded Documentation Sections ───────────────────────────────────

/** Install section from README.md — embedded as static text. */
export const installGuide: string = extractReadmeSection("./README.md", "Install");

/** Overview/description from README.md. */
export const projectOverview: string = extractReadmeSection("./README.md", "kimi-toolchain");

/** All section headings from README.md. */
export const readmeHeadings: string[] = extractHeadings("./README.md");

// ── Formatted Output ─────────────────────────────────────────────────

/** CLI-friendly formatted install guide. */
export const installHelp = `Install Guide:
${installGuide}`;

/** Table of contents from README headings. */
export const tableOfContents = `Table of Contents:
${readmeHeadings.map((h, i) => `  ${i + 1}. ${h}`).join("\n")}`;
