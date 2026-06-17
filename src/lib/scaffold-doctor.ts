/**
 * Scaffold completeness checks for kimi-fix doctor.
 *
 * CI workflow detection reads the configured path from dx.config.toml.
 * If the path points under workflows-disabled/, the check reports "ok"
 * with a note that server CI is unavailable and local enforcement is active.
 * This prevents false-positive "missing ci.yml" warnings when server CI
 * has been intentionally disabled.
 *
 * Enforcement surface: pre-push hooks + bun run ci:local.
 * Server CI is not the enforcement layer for this project.
 */

import { pathExists } from "./bun-io.ts";

import { join } from "path";
import { REQUIRED_PACKAGE_SCRIPTS } from "./scaffold-templates.ts";
import type { HealthCheck as DoctorCheck } from "./health-check.ts";

/** Default CI workflow path (used when dx.config.toml is absent or unreadable). */
const DEFAULT_WORKFLOW_PATH = ".github/workflows/ci.yml";

interface DxCiConfig {
  workflowPath: string;
  ciDisabled: boolean;
}

/**
 * Read CI config from dx.config.toml.
 * Returns the workflow path and an explicit disabled flag.
 * Falls back to DEFAULT_WORKFLOW_PATH with disabled=false when the file is absent or unreadable.
 * The disabled flag is true when either `github.ci.disabled` is set in the TOML
 * or the workflow path points under workflows-disabled/ (legacy convention).
 */
async function readDxCiConfig(projectDir: string): Promise<DxCiConfig> {
  const dxPath = join(projectDir, "dx.config.toml");
  if (!pathExists(dxPath)) {
    return { workflowPath: DEFAULT_WORKFLOW_PATH, ciDisabled: false };
  }
  try {
    const raw = Bun.TOML.parse(await Bun.file(dxPath).text()) as {
      github?: {
        workflow?: string;
        ci?: { disabled?: boolean };
      };
    };
    const workflowPath = raw.github?.workflow ?? DEFAULT_WORKFLOW_PATH;
    const explicitDisabled = raw.github?.ci?.disabled === true;
    const pathImpliesDisabled = workflowPath.includes("workflows-disabled");
    return { workflowPath, ciDisabled: explicitDisabled || pathImpliesDisabled };
  } catch {
    return { workflowPath: DEFAULT_WORKFLOW_PATH, ciDisabled: false };
  }
}

export async function checkScaffold(projectDir: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  const { workflowPath, ciDisabled } = await readDxCiConfig(projectDir);

  // --- File presence checks ---

  const fileChecks: Array<{ name: string; rel: string }> = [
    { name: "AGENTS.md", rel: "AGENTS.md" },
    { name: "CODE_REFERENCES.md", rel: "CODE_REFERENCES.md" },
    { name: "tsconfig.json", rel: "tsconfig.json" },
    { name: "bunfig.toml", rel: "bunfig.toml" },
    { name: "dx.config.toml", rel: "dx.config.toml" },
    { name: "mcp.json", rel: ".kimi-code/mcp.json" },
    { name: "check.ts", rel: "scripts/check.ts" },
    { name: "oxfmtrc", rel: ".oxfmtrc.json" },
    { name: "oxlintrc", rel: ".oxlintrc.json" },
  ];

  for (const { name, rel } of fileChecks) {
    const present = pathExists(join(projectDir, rel));
    checks.push({
      name,
      status: present ? "ok" : "warn",
      message: present ? "present" : "missing — run kimi-fix",
      fixable: !present,
    });
  }

  // --- CI workflow check ---
  // Three states: present at configured path, disabled (intentionally moved), or missing.
  // Only "missing and not disabled" is fixable — disabled CI is a valid configuration.

  const ciPresent = pathExists(join(projectDir, workflowPath));

  let ciStatus: DoctorCheck["status"];
  let ciMessage: string;
  let ciFixable: boolean;

  if (ciPresent) {
    ciStatus = "ok";
    ciMessage = `present at ${workflowPath}`;
    ciFixable = false;
  } else if (ciDisabled) {
    ciStatus = "ok";
    ciMessage = "disabled (server CI unavailable) — enforcement via pre-push hooks + ci:local";
    ciFixable = false;
  } else {
    ciStatus = "warn";
    ciMessage = "missing — run kimi-fix";
    ciFixable = true;
  }

  checks.push({
    name: "ci.yml",
    status: ciStatus,
    message: ciMessage,
    fixable: ciFixable,
  });

  // --- Package scripts check ---

  const pkgPath = join(projectDir, "package.json");
  if (!pathExists(pkgPath)) {
    checks.push({
      name: "package.json",
      status: "error",
      message: "missing",
      fixable: false,
    });
    return checks;
  }

  try {
    const pkg = (await Bun.file(pkgPath).json()) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts || {};
    const missingScripts = REQUIRED_PACKAGE_SCRIPTS.filter((s) => !scripts[s]);
    checks.push({
      name: "package-scripts",
      status: missingScripts.length === 0 ? "ok" : "warn",
      message:
        missingScripts.length === 0
          ? "quality scripts defined"
          : `missing: ${missingScripts.join(", ")}`,
      fixable: missingScripts.length > 0,
    });
  } catch {
    checks.push({
      name: "package.json",
      status: "error",
      message: "invalid JSON",
      fixable: false,
    });
  }

  return checks;
}
