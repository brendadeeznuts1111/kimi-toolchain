import { isPlainObject, isStringRecord, recordField } from "./boundary.ts";
import { pathExists, readJsonFile, readJsonValidated } from "./bun-io.ts";
import { parseTomlValue } from "./toml-config.ts";

import { join } from "path";

interface PackageJsonTrusted {
  trustedDependencies?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  scripts?: {
    postinstall?: string;
    preinstall?: string;
    install?: string;
  };
}

function isPackageJsonTrusted(value: unknown): value is PackageJsonTrusted {
  if (typeof value !== "object" || value === null) return false;
  const trusted = recordField(value, "trustedDependencies");
  const scripts = recordField(value, "scripts");
  return (
    (trusted === undefined ||
      (Array.isArray(trusted) && trusted.every((d) => typeof d === "string"))) &&
    (recordField(value, "dependencies") === undefined ||
      isStringRecord(recordField(value, "dependencies"))) &&
    (recordField(value, "devDependencies") === undefined ||
      isStringRecord(recordField(value, "devDependencies"))) &&
    (recordField(value, "optionalDependencies") === undefined ||
      isStringRecord(recordField(value, "optionalDependencies"))) &&
    (scripts === undefined ||
      (typeof scripts === "object" &&
        scripts !== null &&
        ["postinstall", "preinstall", "install"].every(
          (k) =>
            recordField(scripts, k) === undefined || typeof recordField(scripts, k) === "string"
        )))
  );
}

export interface TrustedDependencyScan {
  untrusted: string[];
  trusted: string[];
  legacyBunfigTrusted: string[];
}

async function readPackageJsonTrusted(path: string): Promise<PackageJsonTrusted | null> {
  try {
    const raw = await readJsonFile(path);
    return isPackageJsonTrusted(raw) ? raw : null;
  } catch {
    return null;
  }
}

function parseTrustedList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((d) => d.trim().replace(/["']/g, ""))
    .filter(Boolean);
}

export async function readTrustedDependencies(projectDir: string): Promise<{
  trusted: Set<string>;
  legacyBunfigTrusted: string[];
}> {
  const pkgPath = join(projectDir, "package.json");
  const bunfigPath = join(projectDir, "bunfig.toml");

  let trusted = new Set<string>();
  let legacyBunfigTrusted: string[] = [];

  if (pathExists(pkgPath)) {
    const pkg = await readPackageJsonTrusted(pkgPath);
    if (pkg && Array.isArray(pkg.trustedDependencies)) {
      trusted = new Set(pkg.trustedDependencies);
    }
  }

  if (pathExists(bunfigPath)) {
    try {
      const config = parseTomlValue(await Bun.file(bunfigPath).text());
      const install = config ? recordField(config, "install") : undefined;
      const installTrusted =
        isPlainObject(install) && Array.isArray(install.trustedDependencies)
          ? (install.trustedDependencies as string[])
          : [];
      const rootTrusted = Array.isArray(config?.trustedDependencies)
        ? (config.trustedDependencies as string[])
        : [];
      legacyBunfigTrusted = installTrusted.length > 0 ? installTrusted : rootTrusted;
    } catch {
      const content = await Bun.file(bunfigPath).text();
      const match = content.match(/trustedDependencies\s*=\s*\[([^\]]*)\]/);
      if (match) {
        legacyBunfigTrusted = parseTrustedList(match[1]);
      }
    }
    if (trusted.size === 0 && legacyBunfigTrusted.length > 0) {
      trusted = new Set(legacyBunfigTrusted);
    }
  }

  return { trusted, legacyBunfigTrusted };
}

export async function scanUntrustedInstallScripts(
  projectDir: string
): Promise<TrustedDependencyScan> {
  const pkgPath = join(projectDir, "package.json");
  if (!pathExists(pkgPath)) {
    return { untrusted: [], trusted: [], legacyBunfigTrusted: [] };
  }

  const { trusted, legacyBunfigTrusted } = await readTrustedDependencies(projectDir);
  const pkg = await readPackageJsonTrusted(pkgPath);
  if (!pkg) {
    return { untrusted: [], trusted: [], legacyBunfigTrusted };
  }
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {}),
  ];

  const untrusted: string[] = [];
  const trustedWithScripts: string[] = [];

  for (const dep of allDeps) {
    const depPkgPath = join(projectDir, "node_modules", dep, "package.json");
    if (!pathExists(depPkgPath)) continue;

    const depPkg = await readPackageJsonTrusted(depPkgPath);
    if (!depPkg) continue;
    const scripts = depPkg.scripts || {};
    if (scripts.postinstall || scripts.preinstall || scripts.install) {
      if (trusted.has(dep)) {
        trustedWithScripts.push(dep);
      } else {
        untrusted.push(dep);
      }
    }
  }

  return {
    untrusted,
    trusted: trustedWithScripts,
    legacyBunfigTrusted,
  };
}

export async function addTrustedDependencies(
  projectDir: string,
  deps: string[]
): Promise<{ added: string[]; migratedFromBunfig: boolean }> {
  const pkgPath = join(projectDir, "package.json");
  if (!pathExists(pkgPath) || deps.length === 0) {
    return { added: [], migratedFromBunfig: false };
  }

  const pkg = await readJsonValidated(pkgPath, isPackageJsonTrusted);
  const existing = Array.isArray(pkg.trustedDependencies) ? pkg.trustedDependencies : [];
  const { legacyBunfigTrusted } = await readTrustedDependencies(projectDir);
  const combined = [...new Set([...existing, ...legacyBunfigTrusted, ...deps])];
  const added = deps.filter((dep) => !existing.includes(dep));

  pkg.trustedDependencies = combined;
  await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  const migratedFromBunfig = await stripLegacyBunfigTrustedDependencies(projectDir);
  return { added, migratedFromBunfig };
}

export async function stripLegacyBunfigTrustedDependencies(projectDir: string): Promise<boolean> {
  const bunfigPath = join(projectDir, "bunfig.toml");
  if (!pathExists(bunfigPath)) return false;

  const content = await Bun.file(bunfigPath).text();
  if (!/trustedDependencies\s*=\s*\[/.test(content)) return false;

  const cleaned = content
    .replace(
      /# Trusted dependencies with postinstall scripts\n# Run `kimi-guardian check` to auto-populate\n/g,
      ""
    )
    .replace(/\n?trustedDependencies\s*=\s*\[[^\]]*\]\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  await Bun.write(bunfigPath, cleaned.endsWith("\n") ? cleaned : cleaned + "\n");
  return true;
}

export function trustedDependenciesFixHint(deps: string[]): string {
  return (
    "Add to package.json trustedDependencies: [" +
    deps.map((d) => `"${d}"`).join(", ") +
    "]" +
    " (or run: bun pm trust " +
    deps.join(" ") +
    ")"
  );
}
