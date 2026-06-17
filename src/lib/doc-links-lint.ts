/**
 * Inline documentation URL lint — complements canonical-references.json (ecosystem roots).
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

/** Files that may keep the Bun ecosystem root on bun.sh. */
export const BUN_SH_DOCS_ALLOWLIST_FILES = new Set(["src/lib/canonical-references.ts"]);

/** Shared Bun doc constants — defining file may contain the literal URL once. */
export const BUN_DOC_LINK_CONSTANTS = [
  {
    constant: "BUN_WEBVIEW_DOCS_URL",
    definingFile: "src/lib/webview-console.ts",
    pattern: /https:\/\/bun\.(sh|com)\/docs\/runtime\/webview[\w#/-]*/g,
  },
  {
    constant: "BUN_INSTALL_DOC_URL",
    definingFile: "src/lib/bun-install-config.ts",
    pattern: /https:\/\/bun\.com\/docs\/pm\/cli\/install[\w#/-]*/g,
  },
] as const;

const SCAN_GLOB = new Bun.Glob("src/**/*.ts");
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage"]);

const BUN_SH_DOCS_URL = /https?:\/\/bun\.sh\/docs\S*/g;
const BUN_SH_DOCS_INLINE = /\bbun\.sh\/docs\S*/g;

function isAllowlistedBunShRoot(rel: string, line: string): boolean {
  if (!BUN_SH_DOCS_ALLOWLIST_FILES.has(rel)) return false;
  return (
    /docs:\s*"https:\/\/bun\.sh\/docs"/.test(line) || /homepage:\s*"https:\/\/bun\.sh"/.test(line)
  );
}

function isExportedConstantDefinition(line: string, constant: string): boolean {
  return new RegExp(`export const ${constant}\\s*=`).test(line);
}

function lineUsesConstant(line: string, constant: string): boolean {
  return line.includes(constant);
}

export function scanDocLinkFile(rel: string, text: string): DocLinkViolation[] {
  const violations: DocLinkViolation[] = [];
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;
    const trimmed = line.trim();

    if (BUN_SH_DOCS_URL.test(line) || BUN_SH_DOCS_INLINE.test(line)) {
      BUN_SH_DOCS_URL.lastIndex = 0;
      BUN_SH_DOCS_INLINE.lastIndex = 0;
      if (!isAllowlistedBunShRoot(rel, line)) {
        violations.push({
          file: rel,
          line: lineNo,
          rule: "prefer-bun-com-docs",
          message:
            "legacy Bun docs host → prefer bun.com/docs for deep links (allowlist: canonical-references.ts ecosystem root)",
          snippet: trimmed.slice(0, 120),
        });
      }
    }

    const isComment =
      trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/**");

    for (const entry of BUN_DOC_LINK_CONSTANTS) {
      const matches = line.match(entry.pattern);
      if (!matches) continue;
      if (isComment) continue;
      if (rel === entry.definingFile && isExportedConstantDefinition(line, entry.constant)) {
        continue;
      }
      if (lineUsesConstant(line, entry.constant)) {
        continue;
      }
      violations.push({
        file: rel,
        line: lineNo,
        rule: "use-doc-constant",
        message: `use ${entry.constant} from ${entry.definingFile} instead of a raw Bun docs URL`,
        snippet: trimmed.slice(0, 120),
      });
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
