#!/usr/bin/env bun
/**
 * Bun profiler wrapper — CPU or heap, Markdown or DevTools formats.
 *
 * Usage:
 *   bun run profile --cpu --md --target script.js
 *   bun run profile --heap --md --target script.js -- --arg1 --arg2
 *   bun run profile --heap --target script.js
 *   bun run profile --cpu --md --dir .kimi-artifacts/profiles --name run1 --target script.js
 */

import { isAbsolute, join, resolve } from "path";
import { $ } from "bun";
import { DEFAULT_PROFILE_OUTPUT_DIR } from "../src/lib/root-hygiene.ts";

interface ProfileOptions {
  mode: "cpu" | "heap";
  md: boolean;
  dir: string;
  name?: string;
  target: string;
  targetArgs: string[];
}

function parseCli(): ProfileOptions {
  const argv = Bun.argv.slice(2);
  let mode: "cpu" | "heap" | null = null;
  let md = false;
  let dir = DEFAULT_PROFILE_OUTPUT_DIR;
  let name: string | undefined;
  let target: string | undefined;
  const targetArgs: string[] = [];

  let sawSeparator = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      sawSeparator = true;
      continue;
    }
    if (sawSeparator) {
      targetArgs.push(arg);
      continue;
    }
    if (arg === "--cpu") {
      mode = "cpu";
      continue;
    }
    if (arg === "--heap") {
      mode = "heap";
      continue;
    }
    if (arg === "--md") {
      md = true;
      continue;
    }
    if (arg === "--dir") {
      dir = argv[++i] ?? dir;
      continue;
    }
    if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
      continue;
    }
    if (arg === "--name") {
      name = argv[++i] ?? name;
      continue;
    }
    if (arg.startsWith("--name=")) {
      name = arg.slice("--name=".length);
      continue;
    }
    if (arg === "--target") {
      target = argv[++i];
      continue;
    }
    if (arg.startsWith("--target=")) {
      target = arg.slice("--target=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!mode) throw new Error("Missing --cpu or --heap");
  if (!target) throw new Error("Missing --target <script>");

  return { mode, md, dir, name, target, targetArgs };
}

function printUsage(): void {
  console.log(`profile — Bun CPU / heap profiler wrapper

Usage:
  bun run profile --cpu --md --target script.js
  bun run profile --heap --md --target script.js -- --arg1
  bun run profile --heap --target script.js
  bun run profile --cpu --dir .kimi-artifacts/profiles --name run1 --target script.js

Options:
  --cpu        CPU profile mode
  --heap       Heap profile mode
  --md         Emit Markdown report (default for CPU is JSON unless --md)
  --dir        Output directory (default: .kimi-artifacts/profiles)
  --name       Output filename stem (default: <mode>-<timestamp>)
  --target     Script to profile
  --           Pass remaining args to the target script`);
}

function resolveDir(dir: string): string {
  return isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
}

function defaultName(mode: "cpu" | "heap", md: boolean): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ext = mode === "cpu" ? (md ? "cpu.md" : "cpuprofile") : md ? "heap.md" : "heapsnapshot";
  return `${mode}-${ts}.${ext}`;
}

function buildCommand(options: ProfileOptions): { cmd: string[]; outputPath: string } {
  const dir = resolveDir(options.dir);
  const name = options.name ?? defaultName(options.mode, options.md);
  const outputPath = join(dir, name);

  if (options.mode === "cpu") {
    const cmd = ["bun"];
    if (options.md) {
      cmd.push("--cpu-prof-md");
    } else {
      cmd.push("--cpu-prof");
    }
    cmd.push("--cpu-prof-dir", dir, "--cpu-prof-name", name, options.target, ...options.targetArgs);
    return { cmd, outputPath };
  }

  // heap
  const cmd = ["bun"];
  if (options.md) {
    cmd.push("--heap-prof-md");
  } else {
    cmd.push("--heap-prof");
  }
  cmd.push("--heap-prof-dir", dir, "--heap-prof-name", name, options.target, ...options.targetArgs);
  return { cmd, outputPath };
}

async function main(): Promise<void> {
  const options = parseCli();
  const { cmd, outputPath } = buildCommand(options);

  console.log(`$ ${cmd.join(" ")}`);
  const result = await $`${cmd}`.cwd(process.cwd()).nothrow().quiet();

  if (result.exitCode !== 0) {
    console.error(result.stderr.toString());
    process.exit(result.exitCode ?? 1);
  }

  console.log(result.stdout.toString().trim());
  console.log(`Profile written to: ${outputPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
