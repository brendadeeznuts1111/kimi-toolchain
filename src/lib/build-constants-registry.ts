/**
 * Parse bunfig [define] blocks and build-constants.d.ts annotations.
 * Powers constants-manifest.json generation and cross-repo parity checks.
 */

import { asRecord } from "./boundary.ts";
import { pathExists } from "./bun-io.ts";

import { homeDir } from "./paths.ts";

export interface DefineEntry {
  key: string;
  defineDomain: string;
  rawValue: string;
  value: string | number | boolean;
  line: number;
}

export interface TypeEntry {
  key: string;
  defineDomain: string;
  type: string;
  typeExpr?: string;
  enumValues?: string[];
  description?: string;
  default?: string;
  restrictions?: string;
  see?: string[];
  line?: number;
}

export interface ManifestConstant {
  type: string;
  default: string | number | boolean;
  description?: string;
  restrictions?: string;
  see?: string[];
}

export const TUNING_SET_VERSION_KEY = "KIMI_TUNING_SET_VERSION";

export interface ConstantsManifest {
  schemaVersion: number;
  generatedAt: string;
  repo: string;
  tuningSetVersion: string;
  domains: Record<string, Record<string, ManifestConstant>>;
  parity: {
    shared: ParitySharedEntry[];
  };
}

export interface ParitySharedEntry {
  id: string;
  description?: string;
  repos: Record<
    string,
    {
      key: string;
      defineDomain: string;
      value: string | number | boolean;
      present: boolean;
    }
  >;
  aligned: boolean;
  drift?: string;
}

export interface ParityRepoConfig {
  path: string;
  bunfig: string;
  types: string;
}

export interface ParityConfig {
  schemaVersion: number;
  repos: Record<string, ParityRepoConfig>;
  shared: Array<{
    id: string;
    description?: string;
    repos: Record<string, { key: string; defineDomain: string }>;
  }>;
}

const DEFINE_KEY = /^([A-Z][A-Z0-9_]*) = /;
const DEFINE_DOMAIN = /^# define-domain:([a-z][a-z0-9-]*)/;

function record(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {};
}

export function expandRepoPath(path: string, projectRoot: string): string {
  const trimmed = path.trim();
  if (trimmed === "." || trimmed === "./") return projectRoot;
  if (trimmed.startsWith("~/")) return `${homeDir()}/${trimmed.slice(2)}`;
  if (trimmed.startsWith("/")) return trimmed;
  return `${projectRoot}/${trimmed}`;
}

export function parseDefineRawValue(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  const quoted = trimmed.match(/^'"(.*)"'$/) ?? trimmed.match(/^"(.*)"$/);
  if (quoted) {
    const inner = quoted[1]!;
    if (inner === "true") return true;
    if (inner === "false") return false;
    const numeric = Number(inner);
    if (!Number.isNaN(numeric) && inner !== "") return numeric;
    return inner;
  }

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric) && trimmed !== "") return numeric;
  return trimmed;
}

export interface ConstantRange {
  kind: "closed" | "min" | "enum" | "boolean" | "exact" | "semver" | "path" | "unbounded";
  min?: number;
  max?: number;
  values?: string[];
  description?: string;
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

export function parseBunfigDefines(bunfigText: string): DefineEntry[] {
  const entries: DefineEntry[] = [];
  const lines = bunfigText.split("\n");
  let inDefine = false;
  let currentDomain = "unknown";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "[define]") {
      inDefine = true;
      continue;
    }
    if (inDefine && line.startsWith("[") && line.endsWith("]")) break;
    if (!inDefine) continue;

    const domainMatch = line.match(DEFINE_DOMAIN);
    if (domainMatch) {
      currentDomain = domainMatch[1]!;
      continue;
    }

    const keyMatch = line.match(DEFINE_KEY);
    if (!keyMatch) continue;

    const rawValue = line.slice(keyMatch[0].length).trim();
    entries.push({
      key: keyMatch[1]!,
      defineDomain: currentDomain,
      rawValue,
      value: parseDefineRawValue(rawValue),
      line: i + 1,
    });
  }

  return entries;
}

function parseJsDocBlock(block: string): Omit<TypeEntry, "key" | "type"> {
  const tags: Record<string, string> = {};
  const see: string[] = [];

  for (const rawLine of block.split("\n")) {
    const line = rawLine.replace(/^\s*\*\s?/, "").trim();
    if (!line || line.startsWith("@see ")) {
      const ref = line.replace(/^@see\s+/, "").trim();
      if (ref) see.push(ref);
      continue;
    }

    const tagMatch = line.match(/^@([a-zA-Z]+)\s+(.*)$/);
    if (tagMatch) tags[tagMatch[1]!.toLowerCase()] = tagMatch[2]!.trim();
  }

  const defineDomain = tags.definedomain?.split(/\s+/)[0] ?? "unknown";
  const defaultRaw = tags.default;
  const defaultValue =
    defaultRaw?.match(/^"(.*)"$/)?.[1] ?? defaultRaw?.match(/^'(.*)'$/)?.[1] ?? defaultRaw;
  const inlineDescription = block
    .split("\n")
    .map((rawLine) => rawLine.replace(/^\s*\*\s?/, "").trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith("@") &&
        !line.startsWith("Compile-time") &&
        !line.startsWith("Naming layers") &&
        !line.startsWith("SSOT:") &&
        !line.startsWith("Regression:") &&
        !line.startsWith("Three ") &&
        !line.startsWith("- **")
    )
    .join(" ")
    .trim();

  return {
    defineDomain,
    description: inlineDescription || undefined,
    default: defaultValue,
    restrictions: tags.restrictions,
    see: see.length > 0 ? see : undefined,
  };
}

export function parseTypeExpression(typeExpr: string): {
  type: string;
  typeExpr: string;
  enumValues?: string[];
} {
  const trimmed = typeExpr.trim();
  if (trimmed === "string" || trimmed === "number" || trimmed === "boolean") {
    return { type: trimmed, typeExpr: trimmed };
  }

  const enumValues = [...trimmed.matchAll(/"([^"]+)"/g)].map((match) => match[1]!).filter(Boolean);
  if (enumValues.length > 0) {
    return { type: "string", typeExpr: trimmed, enumValues };
  }

  const primitive = trimmed.match(/^(string|number|boolean)\b/)?.[1];
  return { type: primitive ?? "string", typeExpr: trimmed };
}

function typesLineForKey(typesText: string, key: string): number | undefined {
  const marker = `declare const ${key}:`;
  const index = typesText.indexOf(marker);
  if (index < 0) return undefined;
  return typesText.slice(0, index).split("\n").length;
}

export function parseBuildConstantsTypes(typesText: string): Map<string, TypeEntry> {
  const entries = new Map<string, TypeEntry>();

  for (const chunk of typesText.split(/(?=\/\*\*)/)) {
    const match = chunk.match(
      /^\/\*\*([\s\S]*?)\*\/\s*declare const ([A-Z][A-Z0-9_]*):\s*([^;]+);/
    );
    if (!match) continue;

    const [, block, key, typeExpr] = match;
    const parsed = parseJsDocBlock(block!);
    if (parsed.defineDomain === "unknown") continue;
    const normalized = parseTypeExpression(typeExpr!);

    entries.set(key!, {
      key: key!,
      ...normalized,
      ...parsed,
      line: typesLineForKey(typesText, key!),
    });
  }

  return entries;
}

export async function loadRepoDefineMap(
  repoRoot: string,
  bunfigRel = "bunfig.toml"
): Promise<Map<string, DefineEntry>> {
  const bunfigPath = `${repoRoot}/${bunfigRel}`;
  if (!pathExists(bunfigPath)) return new Map();

  const defines = parseBunfigDefines(await Bun.file(bunfigPath).text());
  return new Map(defines.map((entry) => [entry.key, entry]));
}

export function buildManifestDomains(
  defines: DefineEntry[],
  types: Map<string, TypeEntry>
): Record<string, Record<string, ManifestConstant>> {
  const domains: Record<string, Record<string, ManifestConstant>> = {};

  for (const define of defines) {
    const annotation = types.get(define.key);
    const domain = annotation?.defineDomain ?? define.defineDomain;
    domains[domain] ??= {};
    domains[domain]![define.key] = {
      type: annotation?.type ?? typeof define.value,
      default: define.value,
      description: annotation?.description,
      restrictions: annotation?.restrictions,
      see: annotation?.see,
    };
  }

  return domains;
}

export async function loadParityConfig(projectRoot: string): Promise<ParityConfig | null> {
  const path = `${projectRoot}/constants-parity.toml`;
  if (!pathExists(path)) return null;

  try {
    const parsed = record(Bun.TOML.parse(await Bun.file(path).text()));
    const reposRaw = record(parsed.repos);
    const repos: Record<string, ParityRepoConfig> = {};

    for (const [name, value] of Object.entries(reposRaw)) {
      const repo = record(value);
      const repoPath = typeof repo.path === "string" ? repo.path : ".";
      const bunfig = typeof repo.bunfig === "string" ? repo.bunfig : "bunfig.toml";
      const types = typeof repo.types === "string" ? repo.types : "types/build-constants.d.ts";
      repos[name] = { path: repoPath, bunfig, types };
    }

    const sharedRaw = Array.isArray(parsed.shared) ? parsed.shared : [];
    const shared = sharedRaw
      .map((item) => {
        const group = record(item);
        const id = typeof group.id === "string" ? group.id : "";
        if (!id) return null;

        const reposGroup = record(group.repos);
        const repoEntries: Record<string, { key: string; defineDomain: string }> = {};
        for (const [repoName, repoValue] of Object.entries(reposGroup)) {
          const repoEntry = record(repoValue);
          const key = typeof repoEntry.key === "string" ? repoEntry.key : "";
          const defineDomain =
            typeof repoEntry.defineDomain === "string" ? repoEntry.defineDomain : "";
          if (key && defineDomain) repoEntries[repoName] = { key, defineDomain };
        }

        return {
          id,
          description: typeof group.description === "string" ? group.description : undefined,
          repos: repoEntries,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return {
      schemaVersion: typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1,
      repos,
      shared,
    };
  } catch {
    return null;
  }
}

export async function evaluateParityShared(
  projectRoot: string,
  config: ParityConfig
): Promise<ParitySharedEntry[]> {
  const repoMaps = new Map<string, Map<string, DefineEntry>>();

  for (const [repoName, repoConfig] of Object.entries(config.repos)) {
    const repoRoot = expandRepoPath(repoConfig.path, projectRoot);
    if (!pathExists(repoRoot)) {
      repoMaps.set(repoName, new Map());
      continue;
    }
    repoMaps.set(repoName, await loadRepoDefineMap(repoRoot, repoConfig.bunfig));
  }

  return config.shared.map((group) => {
    const repos: ParitySharedEntry["repos"] = {};
    const presentValues: Array<string | number | boolean> = [];
    let aligned = true;
    let drift: string | undefined;

    for (const [repoName, mapping] of Object.entries(group.repos)) {
      const defineMap = repoMaps.get(repoName) ?? new Map();
      const entry = defineMap.get(mapping.key);
      const present = entry !== undefined;

      if (!present) {
        repos[repoName] = {
          key: mapping.key,
          defineDomain: mapping.defineDomain,
          value: "(missing)",
          present: false,
        };
        aligned = false;
        drift = `${repoName}:${mapping.key} missing`;
        continue;
      }

      if (entry.defineDomain !== mapping.defineDomain) {
        aligned = false;
        drift = `${repoName}:${mapping.key} defineDomain ${entry.defineDomain} ≠ ${mapping.defineDomain}`;
      }

      repos[repoName] = {
        key: mapping.key,
        defineDomain: mapping.defineDomain,
        value: entry.value,
        present: true,
      };
      presentValues.push(entry.value);
    }

    if (presentValues.length >= 2) {
      const first = presentValues[0]!;
      for (const value of presentValues.slice(1)) {
        if (value !== first) {
          aligned = false;
          drift = `value drift: ${presentValues.join(" ≠ ")}`;
          break;
        }
      }
    }

    return {
      id: group.id,
      description: group.description,
      repos,
      aligned,
      drift,
    };
  });
}

export async function generateConstantsManifest(projectRoot: string): Promise<ConstantsManifest> {
  const bunfigPath = `${projectRoot}/bunfig.toml`;
  const typesPath = `${projectRoot}/types/build-constants.d.ts`;
  const defines = parseBunfigDefines(await Bun.file(bunfigPath).text());
  const types = parseBuildConstantsTypes(await Bun.file(typesPath).text());
  const domains = buildManifestDomains(defines, types);

  let parityShared: ParitySharedEntry[] = [];
  const parityConfig = await loadParityConfig(projectRoot);
  if (parityConfig) {
    parityShared = await evaluateParityShared(projectRoot, parityConfig);
  }

  let repoName = "kimi-toolchain";
  try {
    const pkg = record(await Bun.file(`${projectRoot}/package.json`).json());
    if (typeof pkg.name === "string") repoName = pkg.name;
  } catch {
    // keep default
  }

  const tuningEntry = defines.find((define) => define.key === TUNING_SET_VERSION_KEY);
  const tuningSetVersion = typeof tuningEntry?.value === "string" ? tuningEntry.value : "0.0.0";

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repo: repoName,
    tuningSetVersion,
    domains,
    parity: { shared: parityShared },
  };
}

export function stableStringify(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isConstantsManifest(value: unknown): value is ConstantsManifest {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const domains = v.domains;
  const parity = v.parity;
  return (
    typeof v.schemaVersion === "number" &&
    typeof v.generatedAt === "string" &&
    typeof v.repo === "string" &&
    typeof v.tuningSetVersion === "string" &&
    typeof domains === "object" &&
    domains !== null &&
    !Array.isArray(domains) &&
    typeof parity === "object" &&
    parity !== null &&
    !Array.isArray(parity)
  );
}

export async function readConstantsManifest(
  projectRoot: string
): Promise<ConstantsManifest | null> {
  const path = `${projectRoot}/constants-manifest.json`;
  if (!pathExists(path)) return null;
  try {
    const raw = await Bun.file(path).json();
    return isConstantsManifest(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function manifestNeedsRefresh(
  generated: ConstantsManifest,
  existing: ConstantsManifest | null
): boolean {
  if (!existing) return true;
  const { generatedAt: _g, ...generatedBody } = generated;
  const { generatedAt: _e, ...existingBody } = existing;
  return stableStringify(generatedBody) !== stableStringify(existingBody);
}
