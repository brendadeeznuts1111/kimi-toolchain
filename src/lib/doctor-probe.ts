/**
 * doctor-probe.ts — Capability manifest for agent/programmatic discovery.
 *
 * Emitted by `kimi-doctor --probe` so new agents can discover what the tool can
 * do without parsing help text.
 */

import {
  auditCanonicalReferencesHealth,
  CANONICAL_REFERENCES_FILENAME,
  type CanonicalReferencesManifest,
} from "./canonical-references.ts";
import { TOOLCHAIN_VERSION } from "./version.ts";
import { listExternalToolAdapters } from "./external-tool-runner.ts";
import { discoverDoctorPlugins, isInvalidPluginEntry } from "./doctor-plugins.ts";
import { canonicalReferencesPath, homeDir } from "./paths.ts";

export const DOCTOR_PROBE_SCHEMA_VERSION = 2;

export interface DoctorProbeCheck {
  type: "adapter" | "plugin" | "builtin";
  name: string;
  description?: string;
}

export interface DoctorProbeCanonicalReferences {
  filename: string;
  sourceModule: string;
  repoPath: string;
  runtimePath: string;
  packagePointer: string;
  generateCommand: string;
  syncCommand: string;
  ecosystemCount: number;
  localDocsCount: number;
  reposCount: number;
  runtimeSynced: boolean;
  manifest: CanonicalReferencesManifest | null;
}

export interface DoctorProbeManifest {
  schemaVersion: number;
  tool: "kimi-doctor";
  version: string;
  modes: DoctorProbeMode[];
  flags: DoctorProbeFlag[];
  checks: DoctorProbeCheck[];
  canonicalReferences: DoctorProbeCanonicalReferences | null;
  supportsAutoFix: boolean;
  supportsJson: boolean;
  supportsPlugins: boolean;
  supportsMcp: boolean;
}

export interface DoctorProbeMode {
  name: string;
  description: string;
  flags: string[];
}

export interface DoctorProbeFlag {
  name: string;
  type: "boolean" | "string" | "number";
  description: string;
  agentFacing?: boolean;
}

export async function buildDoctorProbeManifest(projectRoot?: string): Promise<DoctorProbeManifest> {
  const root = projectRoot ?? process.cwd();
  const checks: DoctorProbeCheck[] = [];

  for (const name of listExternalToolAdapters()) {
    checks.push({ type: "adapter", name, description: `External tool adapter: ${name}` });
  }

  try {
    const plugins = await discoverDoctorPlugins({ projectRoot: root, home: homeDir() });
    for (const entry of plugins) {
      if (isInvalidPluginEntry(entry)) {
        checks.push({
          type: "plugin",
          name: entry.name,
          description: `Invalid plugin: ${entry.error}`,
        });
      } else {
        checks.push({
          type: "plugin",
          name: entry.plugin.name,
          description: `Doctor plugin: ${entry.plugin.name}`,
        });
      }
    }
  } catch {
    // Probe is best-effort; skip plugin discovery failures.
  }

  checks.push({
    type: "builtin",
    name: "effect-gates",
    description: "Effect discipline gate scan",
  });
  checks.push({
    type: "builtin",
    name: "canonical-references",
    description: "Ecosystem link manifest freshness and ~/.kimi-code/ cache alignment",
  });

  const refsHealth = await auditCanonicalReferencesHealth(root, homeDir());
  const manifest = refsHealth.repoManifest;
  const canonicalReferences: DoctorProbeCanonicalReferences | null = refsHealth.applicable
    ? {
        filename: CANONICAL_REFERENCES_FILENAME,
        sourceModule: "src/lib/canonical-references.ts",
        repoPath: CANONICAL_REFERENCES_FILENAME,
        runtimePath: canonicalReferencesPath(homeDir()),
        packagePointer: "kimi.canonicalReferences",
        generateCommand: "bun run references:generate",
        syncCommand: "bun run sync",
        ecosystemCount: manifest?.ecosystem.length ?? 0,
        localDocsCount: manifest?.localDocs.length ?? 0,
        reposCount: manifest?.repos.length ?? 0,
        runtimeSynced: refsHealth.runtimeSynced,
        manifest,
      }
    : null;

  return {
    schemaVersion: DOCTOR_PROBE_SCHEMA_VERSION,
    tool: "kimi-doctor",
    version: TOOLCHAIN_VERSION,
    modes: [
      {
        name: "default",
        description: "Full toolchain diagnostics",
        flags: ["--fix", "--quick", "--soft-system"],
      },
      {
        name: "workspace",
        description: "Workspace health and PATH alignment",
        flags: ["--workspace", "--strict-workspace"],
      },
      {
        name: "ecosystem",
        description: "Cross-product and constant-optimizer health",
        flags: ["--ecosystem", "--quick"],
      },
      {
        name: "agent-ready",
        description: "Shell, PATH, MCP, and sync readiness",
        flags: ["--agent-ready"],
      },
      {
        name: "success-metrics",
        description: "Drift, error coverage, and integration agility",
        flags: ["--success-metrics"],
      },
      { name: "agent", description: "Agent diagnosis report", flags: ["--agent"] },
      {
        name: "effect-gates",
        description: "Effect-discipline gate scan",
        flags: ["--effect-gates", "--json"],
      },
      {
        name: "dashboard-meta",
        description: "Herdr dashboard /api/meta discovery contract",
        flags: ["--dashboard-meta", "--dashboard-url", "--json"],
      },
      {
        name: "dashboard-automation",
        description: "WebView smoke actions + /api/thumbnail end-to-end probe",
        flags: ["--automation", "--url", "--json"],
      },
      {
        name: "effect-floor",
        description:
          "Effect-floor evaluation (auto from effect-gates snapshots when flags omitted)",
        flags: ["--effect-floor", "--session-report"],
      },
      {
        name: "workspace-context",
        description: "Markdown workspace brief for agent handoff (git, effect-gates, next steps)",
        flags: ["--workspace-context", "--brief"],
      },
      {
        name: "watch",
        description: "Continuous effect-gates polling; reports only on change",
        flags: ["--watch", "--watch-interval"],
      },
      { name: "probe", description: "Capability discovery manifest", flags: ["--probe"] },
      {
        name: "serve-probe",
        description: "Start HTTP server that serves live card probe snapshots",
        flags: ["--serve-probe", "--probe-cards", "--strict-probe"],
      },
      { name: "mcp-server", description: "Start MCP stdio server", flags: ["--mcp-server"] },
      {
        name: "all",
        description: "Run every adapter, plugin, and effect-gates",
        flags: ["--all", "--json"],
      },
    ],
    flags: [
      {
        name: "--json",
        type: "boolean",
        description: "Emit structured JSON on stdout",
        agentFacing: true,
      },
      {
        name: "--quiet",
        type: "boolean",
        description: "Suppress non-error output",
        agentFacing: true,
      },
      { name: "--debug", type: "boolean", description: "Enable debug logging" },
      {
        name: "--timeout",
        type: "number",
        description: "Global timeout in milliseconds",
        agentFacing: true,
      },
      { name: "--bail", type: "boolean", description: "Stop on first error" },
      {
        name: "--fix",
        type: "boolean",
        description: "Apply auto-fixes where available",
        agentFacing: true,
      },
      { name: "--quick", type: "boolean", description: "Skip slow checks", agentFacing: true },
      {
        name: "--agent-id",
        type: "string",
        description: "Load agent-specific profile defaults",
        agentFacing: true,
      },
      {
        name: "--project-root",
        type: "string",
        description: "Target project root",
        agentFacing: true,
      },
      {
        name: "--adapter",
        type: "string",
        description: "Run a single external-tool adapter",
        agentFacing: true,
      },
      {
        name: "--plugin",
        type: "string",
        description: "Run a single doctor plugin",
        agentFacing: true,
      },
      {
        name: "--gate",
        type: "string",
        description: "Run a single static gate such as bunfig-policy",
        agentFacing: true,
      },
      {
        name: "--save-artifact",
        type: "boolean",
        description: "Persist gate result JSON under .kimi/artifacts/{gate}/",
        agentFacing: true,
      },
      { name: "--mcp-server", type: "boolean", description: "Start MCP stdio server" },
      { name: "--probe", type: "boolean", description: "Emit capability manifest" },
      {
        name: "--probe-cards",
        type: "boolean",
        description: "Probe example and Herdr dashboard cards once and exit",
        agentFacing: true,
      },
      {
        name: "--serve-probe",
        type: "boolean",
        description:
          "Start HTTP server on 127.0.0.1:9239 — GET|HEAD /api/health, GET /api/cards, GET|POST /api/refresh",
        agentFacing: true,
      },
      {
        name: "--strict-probe",
        type: "boolean",
        description: "With --probe-cards or --serve-probe, fail if any card is not passing",
        agentFacing: true,
      },
      {
        name: "--all",
        type: "boolean",
        description: "Run all adapters, plugins, and effect-gates",
        agentFacing: true,
      },
      {
        name: "--watch",
        type: "boolean",
        description: "Poll effect-gates on an interval and print changes only",
        agentFacing: true,
      },
      {
        name: "--watch-interval",
        type: "number",
        description: "Seconds between watch polls (default 5)",
        agentFacing: true,
      },
    ],
    checks,
    canonicalReferences,
    supportsAutoFix: true,
    supportsJson: true,
    supportsPlugins: true,
    supportsMcp: true,
  };
}
