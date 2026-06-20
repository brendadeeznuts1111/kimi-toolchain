#!/usr/bin/env bun
/**
 * Discover all bunfig [define] constants with live values and parsed ranges.
 *
 * Usage:
 *   bun run scripts/discover-constants.ts
 *   bun run scripts/discover-constants.ts --json
 *   bun run scripts/discover-constants.ts --domain effect-benchmark
 *   bun run scripts/discover-constants.ts --root /path/to/repo
 */

import { join } from "path";
import {
  buildManifestDomains,
  parseBunfigDefines,
  parseBuildConstantsTypes,
  type ManifestConstant,
} from "../src/lib/build-constants-registry.ts";

const ROOT = join(import.meta.dir, "..");

export interface ConstantRange {
  kind: "closed" | "min" | "enum" | "boolean" | "exact" | "semver" | "path" | "unbounded";
  min?: number;
  max?: number;
  values?: string[];
  description?: string;
}

export interface DiscoveredConstant {
  key: string;
  domain: string;
  type: string;
  value: string | number | boolean;
  range: ConstantRange;
  restrictions?: string;
  line?: number;
}

const CLOSED_INTERVAL_RE = /\[(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\]/;
const MIN_BOUND_RE = />=\s*(-?\d+(?:\.\d+)?)/;
const ENUM_RE = /one of\s+(.+)/i;

export function parseConstantRange(restrictions: string | undefined, type: string): ConstantRange {
  if (!restrictions) {
    if (type === "boolean") return { kind: "boolean", values: ["true", "false"] };
    return { kind: "unbounded", description: "no restrictions documented" };
  }

  const closed = restrictions.match(CLOSED_INTERVAL_RE);
  if (closed) {
    return {
      kind: "closed",
      min: Number(closed[1]),
      max: Number(closed[2]),
      description: restrictions,
    };
  }

  const minBound = restrictions.match(MIN_BOUND_RE);
  if (minBound) {
    return {
      kind: "min",
      min: Number(minBound[1]),
      description: restrictions,
    };
  }

  const enumMatch = restrictions.match(ENUM_RE);
  if (enumMatch) {
    const enumBody = enumMatch[1]!.split(/\s+[—-]\s+/)[0]!;
    const values = enumBody
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean);
    return { kind: "enum", values, description: restrictions };
  }

  if (/boolean/i.test(restrictions)) {
    return { kind: "boolean", values: ["true", "false"], description: restrictions };
  }

  if (/zero-tolerance/i.test(restrictions)) {
    return { kind: "exact", min: 0, max: 0, description: restrictions };
  }

  if (/positive integer/i.test(restrictions)) {
    return { kind: "min", min: 1, description: restrictions };
  }

  if (/non-negative integer/i.test(restrictions)) {
    return { kind: "min", min: 0, description: restrictions };
  }

  if (/positive number/i.test(restrictions)) {
    return { kind: "min", min: 0, description: restrictions };
  }

  if (/semver/i.test(restrictions)) {
    return { kind: "semver", description: restrictions };
  }

  if (/relative path/i.test(restrictions)) {
    return { kind: "path", description: restrictions };
  }

  return { kind: "unbounded", description: restrictions };
}

export function formatConstantRange(range: ConstantRange): string {
  switch (range.kind) {
    case "closed":
      return `[${range.min}, ${range.max}]`;
    case "min":
      return `≥ ${range.min}`;
    case "exact":
      return `= ${range.min ?? 0}`;
    case "enum":
    case "boolean":
      return range.values?.join(" | ") ?? "";
    case "semver":
      return "semver";
    case "path":
      return "relative path";
    default:
      return range.description ?? "any";
  }
}

export async function discoverConstants(projectRoot: string): Promise<DiscoveredConstant[]> {
  const bunfigPath = join(projectRoot, "bunfig.toml");
  const typesPath = join(projectRoot, "types/build-constants.d.ts");
  const defines = parseBunfigDefines(await Bun.file(bunfigPath).text());
  const types = parseBuildConstantsTypes(await Bun.file(typesPath).text());
  const domains = buildManifestDomains(defines, types);
  const defineByKey = new Map(defines.map((entry) => [entry.key, entry]));

  const discovered: DiscoveredConstant[] = [];

  for (const [domain, constants] of Object.entries(domains)) {
    for (const [key, constant] of Object.entries(constants)) {
      discovered.push(toDiscoveredConstant(key, domain, constant, defineByKey.get(key)?.line));
    }
  }

  return discovered.sort((left, right) => {
    const domainOrder = left.domain.localeCompare(right.domain);
    return domainOrder !== 0 ? domainOrder : left.key.localeCompare(right.key);
  });
}

function toDiscoveredConstant(
  key: string,
  domain: string,
  constant: ManifestConstant,
  line?: number
): DiscoveredConstant {
  return {
    key,
    domain,
    type: constant.type,
    value: constant.default,
    range: parseConstantRange(constant.restrictions, constant.type),
    restrictions: constant.restrictions,
    line,
  };
}

function parseArgs(argv: string[]): { json: boolean; domain?: string; root: string } {
  let json = false;
  let domain: string | undefined;
  let root = ROOT;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--json") json = true;
    else if (arg === "--domain") domain = argv[++i];
    else if (arg === "--root") root = argv[++i] ?? ROOT;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        `Usage: bun run scripts/discover-constants.ts [--json] [--domain <name>] [--root <path>]`
      );
      process.exit(0);
    }
  }

  return { json, domain, root };
}

function printTable(constants: DiscoveredConstant[]): void {
  const headers = ["DOMAIN", "KEY", "TYPE", "VALUE", "RANGE"];
  const rows = constants.map((entry) => [
    entry.domain,
    entry.key,
    entry.type,
    String(entry.value),
    formatConstantRange(entry.range),
  ]);

  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]!.length))
  );

  const formatRow = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index]!)).join("  ");

  console.log(formatRow(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) console.log(formatRow(row));
  console.log(`\n${constants.length} constants`);
}

async function main(): Promise<void> {
  const { json, domain, root } = parseArgs(Bun.argv.slice(2));
  let constants = await discoverConstants(root);
  if (domain) constants = constants.filter((entry) => entry.domain === domain);

  if (json) {
    process.stdout.write(`${JSON.stringify(constants, null, 2)}\n`);
    return;
  }

  if (constants.length === 0) {
    console.log(domain ? `No constants found for domain "${domain}"` : "No constants found");
    return;
  }

  printTable(constants);
}

if (import.meta.main) {
  main().catch((err: Error) => {
    console.error("discover-constants failed:", err.message);
    process.exit(1);
  });
}
