/**
 * cli-help-generator.ts — Generates colored CLI help output from embedded docs.
 *
 * Combines build-time embedded documentation (from readme-macros) with
 * Bun.color for colored terminal output. The help text sections are
 * extracted at build time and colored at runtime for display.
 *
 * Usage:
 *   import { printHelp, getHelpText } from "./cli-help-generator.ts";
 *   printHelp("kimi-secrets");  // prints colored help to stdout
 */

import { color } from "bun" with { type: "macro" };
import { installGuide, readmeHeadings, tableOfContents } from "./embedded-docs.ts";
import { buildInfo, buildSummary } from "./build-info.ts";

// ── Color Helpers (build-time resolved) ──────────────────────────────

const c = {
  title: color("#007acc", "ansi"),
  section: color("#00aaff", "ansi"),
  text: color("#1a1a1a", "ansi"),
  dim: color("#888888", "ansi"),
  success: color("#00cc66", "ansi"),
  reset: "\x1b[0m",
};

// ── Help Text Generators ─────────────────────────────────────────────

/** Generate colored help text for a specific tool. */
export function getHelpText(tool: "kimi-secrets" | "kimi-guardian" | "general"): string {
  const lines: string[] = [];

  lines.push(`${c.title}${tool}${c.reset} ${c.dim}v${buildInfo.version}${c.reset}`);
  lines.push(`${c.dim}Build: ${buildInfo.gitHash} @ ${buildInfo.buildTime}${c.reset}`);
  lines.push("");

  switch (tool) {
    case "kimi-secrets":
      lines.push(`${c.section}Commands:${c.reset}`);
      lines.push("  check    Quick health check of all registered secrets");
      lines.push("  list     List all registered secrets with status");
      lines.push("  get      Get a secret value");
      lines.push("  set      Set or update a secret value");
      lines.push("  rotate   Rotate a secret");
      lines.push("  delete   Delete a secret");
      lines.push("  audit    Show audit trail");
      lines.push("  init     Create secrets-policy template");
      lines.push("");
      lines.push(`${c.section}Options:${c.reset}`);
      lines.push("  --json          Output as JSON");
      lines.push("  --unmask        Show full secret values");
      lines.push("  --project <dir> Project directory");
      lines.push("  --version, -v   Print build banner and exit");
      lines.push("");
      lines.push(`${c.section}Examples:${c.reset}`);
      lines.push(`  ${c.dim}kimi-secrets check${c.reset}`);
      lines.push(`  ${c.dim}kimi-secrets list --json${c.reset}`);
      lines.push(`  ${c.dim}kimi-secrets get database password${c.reset}`);
      break;

    case "kimi-guardian":
      lines.push(`${c.section}Commands:${c.reset}`);
      lines.push("  check    Verify lockfile, scan CVEs, check trusted deps");
      lines.push("  fix      Update baseline hash and apply fixes");
      lines.push("  sign     Sign lockfile manifest");
      lines.push("  verify   Verify manifest signature");
      lines.push("  report   Full security report");
      lines.push("  doctor   Health check");
      lines.push("");
      lines.push(`${c.section}Options:${c.reset}`);
      lines.push("  --project <dir> Project directory");
      lines.push("  --json          Output as JSON");
      lines.push("  --version, -v   Print build banner and exit");
      lines.push("");
      lines.push(`${c.section}Examples:${c.reset}`);
      lines.push(`  ${c.dim}kimi-guardian check${c.reset}`);
      lines.push(`  ${c.dim}kimi-guardian report --json${c.reset}`);
      break;

    case "general":
      lines.push(`${c.section}Tools:${c.reset}`);
      lines.push("  kimi-secrets   Secret management");
      lines.push("  kimi-guardian  Supply chain security");
      lines.push("  install-secure Secure install with scanning");
      lines.push("");
      lines.push(`${c.section}Documentation:${c.reset}`);
      lines.push(tableOfContents);
      lines.push("");
      lines.push(`${c.section}Install Guide:${c.reset}`);
      lines.push(installGuide);
      break;
  }

  lines.push("");
  return lines.join("\n");
}

/** Print colored help text to stdout. */
export function printHelp(tool: "kimi-secrets" | "kimi-guardian" | "general"): void {
  console.log(getHelpText(tool));
}

/** Get the build summary line with color. */
export function coloredBuildSummary(): string {
  return `${c.success}${buildSummary}${c.reset}`;
}
