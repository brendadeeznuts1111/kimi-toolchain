/**
 * Live data extractors for AGENTS.md marker sync.
 */

import { join } from "path";
import { safeParse } from "./utils.ts";
import { extractMarkdownTablesFallback } from "./bun-markdown.ts";
import { listBuiltinGateDefinitions } from "../gates/registry.ts";

export const LIB_README_REL = "src/lib/README.md";
export const DX_CONFIG_REL = "dx.config.toml";

interface PackageJson {
  bin?: Record<string, string>;
}

function isPackageJson(val: unknown): val is PackageJson {
  return (
    typeof val === "object" &&
    val !== null &&
    ("bin" in val === false || typeof (val as PackageJson).bin === "object")
  );
}

interface DxEndpoint {
  name?: string;
  url?: string;
}

interface DxConfigToml {
  endpoints?: DxEndpoint[];
  finishWork?: { gates?: string[] };
}

function isDxConfigToml(val: unknown): val is DxConfigToml {
  return typeof val === "object" && val !== null;
}

export interface LibDomainRow {
  domain: string;
  files: string;
}

export async function readPackageBins(projectDir: string): Promise<Record<string, string> | null> {
  const pkgFile = Bun.file(join(projectDir, "package.json"));
  if (!(await pkgFile.exists())) return null;
  const pkgRaw = safeParse(await pkgFile.text(), null, isPackageJson);
  if (pkgRaw === null) return null;
  return pkgRaw.bin ?? {};
}

export async function readDxEndpoints(
  projectDir: string
): Promise<Array<{ name: string; url: string }> | null> {
  const configFile = Bun.file(join(projectDir, DX_CONFIG_REL));
  if (!(await configFile.exists())) return null;
  const parsed = Bun.TOML.parse(await configFile.text());
  if (!isDxConfigToml(parsed)) return null;

  const endpoints = (parsed.endpoints ?? [])
    .map((entry) => ({
      name: typeof entry.name === "string" ? entry.name.trim() : "",
      url: typeof entry.url === "string" ? entry.url.trim() : "",
    }))
    .filter((entry) => entry.name && entry.url)
    .sort((a, b) => a.name.localeCompare(b.name));

  return endpoints;
}

export async function readFinishWorkGates(projectDir: string): Promise<string[] | null> {
  const configFile = Bun.file(join(projectDir, DX_CONFIG_REL));
  if (!(await configFile.exists())) return null;
  const parsed = Bun.TOML.parse(await configFile.text());
  if (!isDxConfigToml(parsed)) return null;

  const gates = parsed.finishWork?.gates;
  if (!Array.isArray(gates)) return [];
  return gates.filter((gate): gate is string => typeof gate === "string" && gate.trim().length > 0);
}

export async function readLibDomainRows(projectDir: string): Promise<LibDomainRow[] | null> {
  const readmeFile = Bun.file(join(projectDir, LIB_README_REL));
  if (!(await readmeFile.exists())) return null;

  const text = await readmeFile.text();
  const section = text.match(/## Domains\s*\n+([\s\S]*?)(?=\n## |\n# |\s*$)/);
  const table = extractMarkdownTablesFallback(section?.[1] ?? "")[0];
  if (!table) return [];

  const domainIdx = table.headers.findIndex((header) => /domain/i.test(header));
  const filesIdx = table.headers.findIndex((header) => /files/i.test(header));
  if (domainIdx < 0 || filesIdx < 0) return [];

  return table.rows
    .map((row) => ({
      domain: row[domainIdx]?.trim() ?? "",
      files: row[filesIdx]?.trim() ?? "",
    }))
    .filter((row) => row.domain.length > 0);
}

export function readBuiltinGateNames(): string[] {
  return listBuiltinGateDefinitions()
    .map((gate) => gate.name)
    .sort((a, b) => a.localeCompare(b));
}
