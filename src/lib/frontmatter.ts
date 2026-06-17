/**
 * frontmatter.ts — Parse TOML (+++) or YAML (---) document frontmatter.
 */

import yaml from "js-yaml";
import { resolve } from "path";
import { parseToml } from "./bun-utils.ts";
import { pathExists } from "./bun-io.ts";

const FRONTMATTER_RE = /^(\+\+\+|---)\r?\n([\s\S]*?)\r?\n\1(?:\r?\n|$)/;

export type FrontmatterFormat = "toml" | "yaml" | "none";
export type FrontmatterDelimiter = "+++" | "---";

export interface FrontmatterMeta {
  file: string;
  parsed: string;
  format: FrontmatterFormat;
  delimiter?: FrontmatterDelimiter;
}

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
  meta: FrontmatterMeta;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

/** Parse frontmatter from file text (does not read from disk). */
export function parseFrontmatterText(text: string, file = ""): ParsedFrontmatter {
  const match = text.match(FRONTMATTER_RE);
  if (!match) {
    return {
      data: {},
      body: text,
      meta: { file, parsed: new Date().toISOString(), format: "none" },
    };
  }

  const delimiter = match[1] as FrontmatterDelimiter;
  const raw = match[2];
  const body = text.slice(match[0].length).replace(/^\r?\n/, "");

  const data =
    delimiter === "+++" ? (parseToml(raw) as Record<string, unknown>) : asRecord(yaml.load(raw));

  return {
    data,
    body,
    meta: {
      file,
      parsed: new Date().toISOString(),
      format: delimiter === "+++" ? "toml" : "yaml",
      delimiter,
    },
  };
}

/** Read a file and parse its frontmatter block. */
export async function parseFrontmatterFile(filePath: string): Promise<ParsedFrontmatter> {
  const resolved = resolve(filePath);
  if (!pathExists(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const text = await Bun.file(resolved).text();
  return parseFrontmatterText(text, resolved);
}
