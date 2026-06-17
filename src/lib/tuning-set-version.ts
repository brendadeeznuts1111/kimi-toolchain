/**
 * Semantic versioning for bunfig [define] tuning sets.
 */

import { pathExists } from "./bun-io.ts";

import { join } from "path";
import {
  generateConstantsManifest,
  parseBunfigDefines,
  readConstantsManifest,
  TUNING_SET_VERSION_KEY,
} from "./build-constants-registry.ts";

export { TUNING_SET_VERSION_KEY };

export interface DefineDiffAnalysis {
  changedDefineKeys: Set<string>;
  changedTypeKeys: Set<string>;
  tuningVersionChanged: boolean;
}

export interface TuningSetVersionCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fixable: boolean;
}

export interface TuningSetVersionReport {
  applicable: boolean;
  aligned: boolean;
  currentVersion: string | null;
  expectedVersion: string | null;
  checks: TuningSetVersionCheck[];
}

export function analyzeDefineDiff(diff: string): DefineDiffAnalysis {
  const changedDefineKeys = new Set<string>();
  const changedTypeKeys = new Set<string>();
  let tuningVersionChanged = false;

  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") && !line.startsWith("-")) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;

    const content = line.slice(1);
    const defineMatch = content.match(/^\s*([A-Z][A-Z0-9_]*) = /);
    if (defineMatch) {
      const key = defineMatch[1]!;
      if (key === TUNING_SET_VERSION_KEY) {
        tuningVersionChanged = true;
      } else if (key.startsWith("KIMI_")) {
        changedDefineKeys.add(key);
      }
    }

    const typeMatch = content.match(/^\s*declare const ([A-Z][A-Z0-9_]*):/);
    if (!typeMatch) continue;
    if (typeMatch[1] === TUNING_SET_VERSION_KEY) {
      tuningVersionChanged = true;
    } else if (typeMatch[1]!.startsWith("KIMI_")) {
      changedTypeKeys.add(typeMatch[1]!);
    }
  }

  return { changedDefineKeys, changedTypeKeys, tuningVersionChanged };
}

export function requiresTuningSetBump(analysis: DefineDiffAnalysis): boolean {
  const changed = analysis.changedDefineKeys.size > 0 || analysis.changedTypeKeys.size > 0;
  return changed && !analysis.tuningVersionChanged;
}

export async function readGitCachedDiff(projectRoot: string, paths: string[]): Promise<string> {
  const proc = Bun.spawn(["git", "diff", "--cached", "--", ...paths], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    Bun.readableStreamToText(proc.stdout),
    proc.exited,
  ]);
  if (exitCode !== 0) return "";
  return stdout;
}

export async function lintTuningSetVersion(
  projectRoot: string,
  options: { staged?: boolean } = {}
): Promise<{ ok: boolean; violations: string[] }> {
  if (!options.staged) {
    return { ok: true, violations: [] };
  }

  const paths = ["bunfig.toml", "types/build-constants.d.ts"];
  const diff = await readGitCachedDiff(projectRoot, paths);
  if (!diff.trim()) {
    return { ok: true, violations: [] };
  }

  const analysis = analyzeDefineDiff(diff);
  if (!requiresTuningSetBump(analysis)) {
    return { ok: true, violations: [] };
  }

  const changed = [...analysis.changedDefineKeys, ...analysis.changedTypeKeys].sort();
  return {
    ok: false,
    violations: [
      `define tuning changed (${changed.join(", ")}) without bumping ${TUNING_SET_VERSION_KEY}`,
      `edit bunfig.toml [define] ${TUNING_SET_VERSION_KEY} and run bun run manifest:generate`,
    ],
  };
}

export async function readProjectTuningSetVersion(projectRoot: string): Promise<string | null> {
  const bunfigPath = join(projectRoot, "bunfig.toml");
  if (!pathExists(bunfigPath)) return null;

  const defines = parseBunfigDefines(await Bun.file(bunfigPath).text());
  const entry = defines.find((define) => define.key === TUNING_SET_VERSION_KEY);
  return typeof entry?.value === "string" ? entry.value : null;
}

export async function readExpectedTuningSetVersion(projectRoot: string): Promise<string | null> {
  const manifest = await readConstantsManifest(projectRoot);
  if (manifest?.tuningSetVersion) return manifest.tuningSetVersion;

  const generated = await generateConstantsManifest(projectRoot);
  return generated.tuningSetVersion;
}

export async function checkTuningSetFreshness(
  projectRoot: string
): Promise<TuningSetVersionReport> {
  const bunfigPath = join(projectRoot, "bunfig.toml");
  if (!pathExists(bunfigPath)) {
    return {
      applicable: false,
      aligned: true,
      currentVersion: null,
      expectedVersion: null,
      checks: [],
    };
  }

  const defines = parseBunfigDefines(await Bun.file(bunfigPath).text());
  if (defines.length === 0) {
    return {
      applicable: false,
      aligned: true,
      currentVersion: null,
      expectedVersion: null,
      checks: [],
    };
  }

  const currentVersion = await readProjectTuningSetVersion(projectRoot);
  const expectedVersion = await readExpectedTuningSetVersion(projectRoot);
  const checks: TuningSetVersionCheck[] = [];

  if (!currentVersion) {
    checks.push({
      name: "tuning-set-version",
      status: "warn",
      message: `${TUNING_SET_VERSION_KEY} missing from bunfig.toml [define]`,
      fixable: true,
    });
    return {
      applicable: true,
      aligned: false,
      currentVersion,
      expectedVersion,
      checks,
    };
  }

  if (!expectedVersion) {
    checks.push({
      name: "tuning-set-version",
      status: "warn",
      message: "expected tuning set version unavailable — run bun run manifest:generate",
      fixable: true,
    });
    return {
      applicable: true,
      aligned: false,
      currentVersion,
      expectedVersion,
      checks,
    };
  }

  if (currentVersion === expectedVersion) {
    checks.push({
      name: "tuning-set-version",
      status: "ok",
      message: currentVersion,
      fixable: false,
    });
  } else {
    checks.push({
      name: "tuning-set-version",
      status: "warn",
      message: `project ${currentVersion} lags expected ${expectedVersion}`,
      fixable: true,
    });
  }

  return {
    applicable: true,
    aligned: checks.every((check) => check.status === "ok"),
    currentVersion,
    expectedVersion,
    checks,
  };
}
