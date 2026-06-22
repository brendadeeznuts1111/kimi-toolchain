/**
 * readme-macros.ts — Macro for extracting documentation sections at build time.
 *
 * Reads a markdown file, converts it to HTML using Bun.markdown.html(),
 * then uses HTMLRewriter to extract specific section content. The result
 * is a plain-text string inlined in the bundle.
 *
 * Usage:
 *   import { extractReadmeSection } from "./readme-macros.ts" with { type: "macro" };
 *   const installGuide = extractReadmeSection("./README.md", "Install");
 *   // In the bundle: const installGuide = "bun install -g ...";
 */

interface SectionCollector {
  title: string;
  capturing: boolean;
  depth: number;
  text: string[];
}

export async function extractReadmeSection(
  filePath: string,
  sectionTitle: string
): Promise<string> {
  const file = Bun.file(filePath);
  if (!file.exists()) {
    return `Section "${sectionTitle}" not found: file ${filePath} does not exist`;
  }

  // Read file — macros can use async, Bun's transpiler awaits the Promise
  const markdown = await file.text();

  // Convert markdown to HTML
  const html = Bun.markdown.html(markdown);

  // Use HTMLRewriter to extract the section
  const collector: SectionCollector = {
    title: sectionTitle.toLowerCase(),
    capturing: false,
    depth: 0,
    text: [],
  };

  let currentHeadingDepth = 0;
  let inMatchingHeading = false;

  const response = new Response(html);
  const rewriter = new HTMLRewriter()
    .on("h1,h2,h3,h4,h5,h6", {
      element(el) {
        currentHeadingDepth = parseInt(el.tagName.substring(1));
        inMatchingHeading = false;
      },
      text(el) {
        const headingText = el.text.toLowerCase().trim();
        if (headingText.includes(collector.title)) {
          collector.capturing = true;
          collector.depth = currentHeadingDepth;
          inMatchingHeading = true;
        } else if (
          collector.capturing &&
          !inMatchingHeading &&
          currentHeadingDepth <= collector.depth
        ) {
          collector.capturing = false;
        }
      },
    })
    .on("p,li,code,pre", {
      text(el) {
        if (collector.capturing) {
          const trimmed = el.text.trim();
          if (trimmed) {
            collector.text.push(trimmed);
          }
        }
      },
    });

  rewriter.transform(response);

  return collector.text.join("\n").trim() || `Section "${sectionTitle}" not found in ${filePath}`;
}

/** Extract all section headings from a markdown file. */
export async function extractHeadings(filePath: string): Promise<string[]> {
  const file = Bun.file(filePath);
  if (!file.exists()) {
    return [];
  }

  const markdown = await file.text();
  const html = Bun.markdown.html(markdown);

  const headings: string[] = [];

  const response = new Response(html);
  const rewriter = new HTMLRewriter().on("h1,h2,h3", {
    text(el) {
      const trimmed = el.text.trim();
      if (trimmed) {
        headings.push(trimmed);
      }
    },
  });

  rewriter.transform(response);

  return headings;
}
