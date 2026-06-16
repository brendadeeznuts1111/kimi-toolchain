import { execFileSync } from "node:child_process";

export interface PaneRequirement {
  bin: string;
  package?: string;
  install?: string;
}

export type PaneRequirementSpec = string | PaneRequirement;

export interface PaneRequirementCheck {
  spec: PaneRequirement;
  ok: boolean;
  resolvedPath: string | null;
  via: "path" | "bunx" | null;
  hint?: string;
}

export interface VerifyPaneRequirementsResult {
  ok: boolean;
  checks: PaneRequirementCheck[];
  missing: string[];
}

export function parsePaneRequirement(row: unknown): PaneRequirement | null {
  if (typeof row === "string" && row.trim()) {
    return { bin: row.trim() };
  }
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  if (typeof record.bin !== "string" || !record.bin.trim()) return null;
  return {
    bin: record.bin.trim(),
    package: typeof record.package === "string" ? record.package : undefined,
    install: typeof record.install === "string" ? record.install : undefined,
  };
}

export function parsePaneRequirements(rows: unknown): PaneRequirement[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(parsePaneRequirement).filter((row): row is PaneRequirement => row != null);
}

function resolveViaBunx(spec: PaneRequirement): string | null {
  if (!Bun.which("bun")) return null;
  const pkg = spec.package || spec.bin;
  try {
    execFileSync("bun", ["x", pkg, "--version"], {
      stdio: "ignore",
      timeout: 8_000,
    });
    return `bun x ${pkg}`;
  } catch {
    return null;
  }
}

export function checkPaneRequirement(spec: PaneRequirement): PaneRequirementCheck {
  const pathHit = Bun.which(spec.bin);
  if (pathHit) {
    return { spec, ok: true, resolvedPath: pathHit, via: "path" };
  }

  const bunxHit = resolveViaBunx(spec);
  if (bunxHit) {
    return { spec, ok: true, resolvedPath: bunxHit, via: "bunx" };
  }

  const hint = spec.install
    ? `install: ${spec.install}`
    : `add ${spec.bin} to PATH or set package for bun x`;
  return { spec, ok: false, resolvedPath: null, via: null, hint };
}

export function verifyPaneRequirements(
  requirements: PaneRequirementSpec[] | undefined
): VerifyPaneRequirementsResult {
  const specs = parsePaneRequirements(requirements);
  const checks = specs.map(checkPaneRequirement);
  const missing = checks.filter((row) => !row.ok).map((row) => row.spec.bin);
  return { ok: missing.length === 0, checks, missing };
}
