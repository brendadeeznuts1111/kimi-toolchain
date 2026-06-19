import { pathExists } from "./bun-io.ts";

import { join } from "path";
import { SPAWN_AGENTS } from "./herdr-agents.ts";
import { sha256File } from "./utils.ts";
import { desktopRoot } from "./paths.ts";
export interface HerdrEcosystemCheck {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  source: string;
  fixable: boolean;
}

export const HERDR_CLI_TOOLS = [
  "herdr-doctor",
  "herdr-latm",
  "herdr-project",
  "herdr-spawn",
] as const;

export interface HerdrToolDrift {
  missingDesktop: string[];
  missingWrappers: string[];
  missingSpawnStubs: string[];
  drifted: string[];
}

export async function detectHerdrToolDrift(
  repoRoot: string,
  home: string
): Promise<HerdrToolDrift> {
  const toolsDir = join(desktopRoot(home), "tools");
  const binDir = join(home, ".local", "bin");
  const missingDesktop: string[] = [];
  const missingWrappers: string[] = [];
  const missingSpawnStubs: string[] = [];
  const drifted: string[] = [];

  for (const name of HERDR_CLI_TOOLS) {
    const repoPath = join(repoRoot, "src", "bin", `${name}.ts`);
    const desktopPath = join(toolsDir, `${name}.ts`);
    const wrapperPath = join(binDir, name);

    if (!pathExists(repoPath)) continue;

    if (!pathExists(desktopPath)) {
      missingDesktop.push(name);
    } else {
      const [repoHash, desktopHash] = await Promise.all([
        sha256File(repoPath),
        sha256File(desktopPath),
      ]);
      if (repoHash !== desktopHash) drifted.push(name);
    }

    if (!pathExists(wrapperPath)) missingWrappers.push(name);
  }

  for (const agent of SPAWN_AGENTS) {
    const stub = join(binDir, `herdr-spawn-${agent}`);
    if (!pathExists(stub)) missingSpawnStubs.push(`herdr-spawn-${agent}`);
  }

  return { missingDesktop, missingWrappers, missingSpawnStubs, drifted };
}

export async function auditHerdrToolHealth(
  repoRoot: string,
  home: string
): Promise<{ checks: HerdrEcosystemCheck[]; fixPlan: string[] }> {
  const checks: HerdrEcosystemCheck[] = [];
  const fixPlan: string[] = [];
  const drift = await detectHerdrToolDrift(repoRoot, home);

  const desktopOk = drift.missingDesktop.length === 0 && drift.drifted.length === 0;
  checks.push({
    name: "herdr-tools:desktop-sync",
    status: desktopOk ? "ok" : "error",
    message: desktopOk
      ? `${HERDR_CLI_TOOLS.length} herdr tools match repo in ~/.kimi-code/tools/`
      : [
          drift.missingDesktop.length ? `missing: ${drift.missingDesktop.join(", ")}` : null,
          drift.drifted.length ? `drifted: ${drift.drifted.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join("; "),
    source: "herdr",
    fixable: !desktopOk,
  });

  const wrappersOk = drift.missingWrappers.length === 0;
  checks.push({
    name: "herdr-tools:wrappers",
    status: wrappersOk ? "ok" : "error",
    message: wrappersOk
      ? "herdr-doctor, herdr-project, herdr-spawn on PATH"
      : `missing wrappers: ${drift.missingWrappers.join(", ")}`,
    source: "herdr",
    fixable: !wrappersOk,
  });

  const stubsOk = drift.missingSpawnStubs.length === 0;
  checks.push({
    name: "herdr-tools:spawn-stubs",
    status: stubsOk ? "ok" : "warn",
    message: stubsOk
      ? `${SPAWN_AGENTS.length} herdr-spawn-* stubs on PATH`
      : `missing stubs: ${drift.missingSpawnStubs.join(", ")}`,
    source: "herdr",
    fixable: !stubsOk,
  });

  if (!desktopOk) fixPlan.push("bun run sync");
  if (!wrappersOk || !stubsOk) fixPlan.push("bun run install-wrappers");
  if (!desktopOk && !wrappersOk) {
    fixPlan.push("cd ~/dx-config && ./scripts/bootstrap-machine.sh");
  }

  return { checks, fixPlan: [...new Set(fixPlan)] };
}
