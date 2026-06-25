#!/usr/bin/env bun
/**
 * kimi-bake — Artifact assembler for kimi-toolchain.
 *
 * Reads manifest.toml, validates the environment, and assembles
 * artifacts from template + example sources into a target directory.
 *
 * Usage:
 *   kimi-bake <artifact> [--output <dir>] [--dry-run]
 *   kimi-bake list                          # list available artifacts
 *   kimi-bake doctor                        # validate manifest + PATH
 */

import { join } from "path";
import { isDirectRun } from "../lib/bun-utils.ts";
import { pathExists, readText } from "../lib/bun-io.ts";
import { loadTomlConfig } from "../lib/toml-config.ts";

// ── Types ──────────────────────────────────────────────────────────

interface ManifestArtifactSource {
  template?: string;
  example?: string;
}

interface ManifestArtifactBunfig {
  install?: Record<string, unknown>;
  test?: Record<string, unknown>;
}

interface ManifestArtifact {
  description?: string;
  requires?: string[];
  path_check?: boolean;
  secrets_check?: boolean;
  sources?: ManifestArtifactSource;
  bunfig?: ManifestArtifactBunfig;
}

interface Manifest {
  artifact?: Record<string, ManifestArtifact>;
}

// ── CLI ────────────────────────────────────────────────────────────

const args = Bun.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log("kimi-bake — Artifact assembler for kimi-toolchain");
  console.log("");
  console.log("Usage:");
  console.log("  kimi-bake <artifact> [--output <dir>] [--dry-run]");
  console.log("  kimi-bake list");
  console.log("  kimi-bake doctor");
  console.log("");
  console.log("Reads manifest.toml and assembles artifacts from");
  console.log("template + example sources into a target directory.");
}

// ── Manifest schema ────────────────────────────────────────────────

const isManifestSchema = (v: unknown): v is Manifest =>
  typeof v === "object" &&
  v !== null &&
  (typeof (v as Manifest).artifact === "undefined" ||
    (typeof (v as Manifest).artifact === "object" && (v as Manifest).artifact !== null));

// ── Manifest loading ───────────────────────────────────────────────

function resolveManifestPath(): string {
  const candidates = [
    join(import.meta.dir, "..", "..", "manifest.toml"),
    join(import.meta.dir, "..", "manifest.toml"),
  ];
  const found = candidates.find((d) => pathExists(d));
  return found ?? candidates[0];
}

async function loadManifest(): Promise<Manifest> {
  const path = resolveManifestPath();
  const result = await loadTomlConfig(path, isManifestSchema, {});
  if (!result.ok) {
    console.error(`manifest.toml: ${result.error} (${result.code})`);
    process.exit(1);
  }
  return result.config;
}

// ── PATH validation ────────────────────────────────────────────────

function validatePath(requires: string[]): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const bin of requires) {
    if (!Bun.which(bin)) missing.push(bin);
  }
  return { ok: missing.length === 0, missing };
}

// ── Secrets probe ──────────────────────────────────────────────────

function probeSecrets(): { ok: boolean; methods: string[] } {
  if (typeof Bun.secrets !== "object" || Bun.secrets === null) {
    return { ok: false, methods: [] };
  }
  const methods: string[] = [];
  if (typeof Bun.secrets.get === "function") methods.push("get");
  if (typeof Bun.secrets.set === "function") methods.push("set");
  if (typeof Bun.secrets.delete === "function") methods.push("delete");
  return { ok: methods.length === 3, methods };
}

// ── Commands ───────────────────────────────────────────────────────

async function cmdList(): Promise<number> {
  const manifest = await loadManifest();
  const artifacts = manifest.artifact || {};
  const names = Object.keys(artifacts);
  if (names.length === 0) {
    console.log("No artifacts defined in manifest.toml");
    return 0;
  }
  console.log("Available artifacts:");
  for (const name of names) {
    const desc = artifacts[name]?.description ?? "(no description)";
    console.log(`  ${name} — ${desc}`);
  }
  return 0;
}

async function cmdDoctor(): Promise<number> {
  const manifest = await loadManifest();
  const artifacts = manifest.artifact || {};
  let errors = 0;

  console.log("── kimi-bake doctor ──");
  console.log(`manifest: ${resolveManifestPath()}`);
  console.log(`artifacts: ${Object.keys(artifacts).length}`);

  for (const [name, artifact] of Object.entries(artifacts)) {
    const requires = artifact.requires || [];

    if (requires.length > 0) {
      const { ok, missing } = validatePath(requires);
      if (ok) {
        console.log(`  ✓ ${name}: ${requires.join(", ")} on PATH`);
      } else {
        console.log(`  ✗ ${name}: missing ${missing.join(", ")}`);
        errors++;
      }
    }

    if (artifact.secrets_check) {
      const secrets = probeSecrets();
      if (secrets.ok) {
        console.log(`  ✓ ${name}: Bun.secrets (${secrets.methods.join(", ")})`);
      } else {
        console.log(
          `  ✗ ${name}: Bun.secrets unavailable (${secrets.methods.join(", ") || "none"})`
        );
        errors++;
      }
    }
  }

  if (errors > 0) {
    console.log(`\n${errors} artifact(s) have missing dependencies.`);
    console.log('Run: dx setup   or   export PATH="$HOME/.kimi-code/bin:$PATH"');
  } else {
    console.log("\n✓ All artifact dependencies satisfied.");
  }

  return errors > 0 ? 1 : 0;
}

async function cmdBake(name: string, outputDir?: string, dryRun = false): Promise<number> {
  const manifest = await loadManifest();
  const artifact = manifest.artifact?.[name];
  if (!artifact) {
    console.error(`Unknown artifact: ${name}`);
    console.error(`Available: ${Object.keys(manifest.artifact || {}).join(", ") || "(none)"}`);
    return 1;
  }

  // PATH check
  if (artifact.path_check && artifact.requires) {
    const { ok, missing } = validatePath(artifact.requires);
    if (!ok) {
      console.error(`PATH check failed: missing ${missing.join(", ")}`);
      return 1;
    }
    console.log(`✓ PATH: ${artifact.requires.join(", ")}`);
  }

  // Secrets check
  if (artifact.secrets_check) {
    const secrets = probeSecrets();
    if (!secrets.ok) {
      console.error("Secrets check failed: Bun.secrets unavailable");
      return 1;
    }
    console.log(`✓ Secrets: ${secrets.methods.join(", ")}`);
  }

  const target = outputDir ?? join(process.cwd(), name);
  console.log(`artifact: ${name}`);
  console.log(`target:   ${target}`);

  if (dryRun) {
    console.log("[dry-run] would assemble artifact files here");
    if (artifact.bunfig) {
      console.log("[dry-run] would merge bunfig sections:");
      if (artifact.bunfig.install)
        console.log("  [install]", JSON.stringify(artifact.bunfig.install));
      if (artifact.bunfig.test) console.log("  [test]", JSON.stringify(artifact.bunfig.test));
    }
    return 0;
  }

  // Assemble: copy source files
  const root = join(import.meta.dir, "..", "..");
  const sources = artifact.sources || {};

  if (sources.template) {
    const src = join(root, sources.template);
    if (pathExists(src)) {
      console.log(`  copy: ${sources.template}/ → ${target}/`);
      await Bun.$`cp -r ${src}/. ${target}/`.quiet();
    }
  }

  if (sources.example) {
    const src = join(root, sources.example);
    if (pathExists(src)) {
      console.log(`  copy: ${sources.example}/ → ${target}/`);
      await Bun.$`cp -r ${src}/. ${target}/`.quiet();
    }
  }

  // Merge bunfig sections
  if (artifact.bunfig) {
    const bunfigPath = join(target, "bunfig.toml");
    const existing = pathExists(bunfigPath) ? readText(bunfigPath) : "";

    let merged = existing;
    if (!merged.includes("[install]") && artifact.bunfig.install) {
      merged += "\n[install]\n";
      for (const [k, v] of Object.entries(artifact.bunfig.install)) {
        merged += `${k} = ${typeof v === "string" ? `"${v}"` : v}\n`;
      }
    }
    if (!merged.includes("[test]") && artifact.bunfig.test) {
      merged += "\n[test]\n";
      for (const [k, v] of Object.entries(artifact.bunfig.test)) {
        if (Array.isArray(v)) {
          merged += `${k} = [\n`;
          for (const item of v) merged += `  "${item}",\n`;
          merged += "]\n";
        } else {
          merged += `${k} = ${typeof v === "string" ? `"${v}"` : v}\n`;
        }
      }
    }

    await Bun.write(bunfigPath, merged.trim() + "\n");
    console.log(`  merge: bunfig.toml`);
  }

  console.log(`\n✓ Baked ${name} → ${target}`);
  return 0;
}

// ── Main ────────────────────────────────────────────────────────────

if (isDirectRun(import.meta.path)) {
  const result = await (async (): Promise<number> => {
    switch (command) {
      case "list":
        return await cmdList();
      case "doctor":
        return await cmdDoctor();
      case undefined:
      case "--help":
      case "-h":
        printHelp();
        return 0;
      default: {
        const outputIdx = args.indexOf("--output");
        const outputDir = outputIdx !== -1 ? args[outputIdx + 1] : undefined;
        const dryRun = args.includes("--dry-run");
        return cmdBake(command, outputDir, dryRun);
      }
    }
  })();

  process.exit(result);
}
