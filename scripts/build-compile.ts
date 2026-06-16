#!/usr/bin/env bun
/**
 * Compile package bin entries into extensionless Bun executables under dist/.
 */

import { basename, join } from "path";
import { $ } from "bun";

const REPO_ROOT = join(import.meta.dir, "..");

interface PackageManifest {
  bin?: Record<string, string> | string;
}

export interface BuildCompileEntry {
  name: string;
  entrypoint: string;
  outfile: string;
}

export interface BuildCompileOptions {
  only?: string[];
  outdir?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildCompilePlan(
  manifest: PackageManifest,
  options: BuildCompileOptions = {}
): BuildCompileEntry[] {
  const outdir = options.outdir ?? "dist";
  const only = new Set(options.only ?? []);
  const entries: BuildCompileEntry[] = [];

  if (typeof manifest.bin === "string") {
    const name = basename(manifest.bin).replace(/\.[^.]+$/, "");
    if (only.size === 0 || only.has(name)) {
      entries.push({
        name,
        entrypoint: manifest.bin,
        outfile: join(outdir, name),
      });
    }
    return entries;
  }

  if (!isRecord(manifest.bin)) return entries;

  for (const [name, entrypoint] of Object.entries(manifest.bin)) {
    if (typeof entrypoint !== "string") continue;
    if (only.size > 0 && !only.has(name)) continue;
    entries.push({
      name,
      entrypoint,
      outfile: join(outdir, name),
    });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function parseCli(): { dryRun: boolean; json: boolean; only: string[] } {
  const argv = Bun.argv.slice(2);
  const only: string[] = [];
  let dryRun = false;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "--dryrun") {
      dryRun = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--only") {
      const value = argv[++i];
      if (value) only.push(...value.split(",").filter(Boolean));
      continue;
    }
    if (arg.startsWith("--only=")) {
      only.push(...arg.slice("--only=".length).split(",").filter(Boolean));
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
  }

  return { dryRun, json, only };
}

async function compileEntry(
  entry: BuildCompileEntry,
  jsonMode: boolean
): Promise<{ entry: BuildCompileEntry; exitCode: number }> {
  const proc = Bun.spawn(
    ["bun", "build", "--compile", entry.entrypoint, "--outfile", entry.outfile],
    {
      cwd: REPO_ROOT,
      stdout: jsonMode ? "pipe" : "inherit",
      stderr: jsonMode ? "pipe" : "inherit",
    }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    proc.stdout ? Bun.readableStreamToText(proc.stdout) : Promise.resolve(""),
    proc.stderr ? Bun.readableStreamToText(proc.stderr) : Promise.resolve(""),
  ]);
  if (jsonMode) {
    if (stdout) process.stderr.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }
  return { entry, exitCode };
}

async function main(): Promise<number> {
  const { dryRun, json, only } = parseCli();
  const manifest = (await Bun.file(join(REPO_ROOT, "package.json")).json()) as PackageManifest;
  const entries = buildCompilePlan(manifest, { only });

  if (entries.length === 0) {
    if (json) {
      process.stdout.write(
        `${JSON.stringify({ schemaVersion: 1, ok: false, entries: [], error: "no bin entries matched" }, null, 2)}\n`
      );
    } else {
      console.error("build:compile: no bin entries matched");
    }
    return 1;
  }

  if (dryRun) {
    const payload = { schemaVersion: 1, ok: true, dryRun: true, entries };
    if (json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else {
      console.log("build:compile — dry run");
      for (const entry of entries)
        console.log(`  ${entry.name}: ${entry.entrypoint} -> ${entry.outfile}`);
    }
    return 0;
  }

  await $`rm -rf ${join(REPO_ROOT, "dist")}`;
  await $`mkdir -p ${join(REPO_ROOT, "dist")}`;

  const results = [];
  for (const entry of entries) {
    const result = await compileEntry(entry, json);
    results.push(result);
    if (result.exitCode !== 0) break;
  }

  const ok = results.length === entries.length && results.every((result) => result.exitCode === 0);
  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          schemaVersion: 1,
          ok,
          entries: results.map((result) => ({
            ...result.entry,
            exitCode: result.exitCode,
          })),
        },
        null,
        2
      )}\n`
    );
  } else if (ok) {
    console.log(`build:compile OK (${results.length} executable(s))`);
  }

  return ok ? 0 : 1;
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("build:compile failed:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
