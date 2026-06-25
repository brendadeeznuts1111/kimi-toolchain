/**
 * scaffold-modules.ts — KIMI_MODULES domain effect scaffolding for kimi-fix.
 *
 * Default: doctor (perf harness + perf-doctor CLI from examples/dashboard).
 */

import { join } from "path";
import { makeDir, pathExists } from "./bun-io.ts";
import { readPackageManifest } from "./utils.ts";

/** Modules scaffolded when KIMI_MODULES is unset. */
export const DEFAULT_KIMI_MODULES = ["doctor"] as const;

export type KimiModuleName =
  | "doctor"
  | "image"
  | "trace"
  | "perf"
  | "clock"
  | "uuid"
  | "http"
  | "trading"
  | "db"
  | "terminal"
  | "transpiler";

export function parseKimiModules(
  env: Record<string, string | undefined> = Bun.env
): KimiModuleName[] {
  const raw = (env.KIMI_MODULES ?? "").trim();
  if (!raw) return [...DEFAULT_KIMI_MODULES];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as KimiModuleName[];
}

export function toolchainRoot(): string {
  const dir = import.meta.dir;
  if (dir.includes("kimi-toolchain")) {
    return dir.split("kimi-toolchain")[0] + "kimi-toolchain";
  }
  return join(dir, "../..");
}

const DOCTOR_COPY_PATHS = [
  { from: "examples/dashboard/src/harness", to: "src/harness" },
  { from: "examples/dashboard/src/bin/perf-doctor.ts", to: "src/bin/perf-doctor.ts" },
  { from: "examples/dashboard/src/lib/isolation", to: "src/lib/isolation" },
  { from: "examples/dashboard/src/harness/__fixtures__", to: "src/harness/__fixtures__" },
] as const;

const DOCTOR_PACKAGE_SCRIPTS: Record<string, string> = {
  perf: "bun run src/bin/perf-doctor.ts --perf-gates --report",
  "perf:gates": "bun run src/bin/perf-doctor.ts --perf-gates",
  "perf:gates:changed":
    "bun run src/bin/perf-doctor.ts --perf-gates --changed-only --base=origin/main",
  "perf:train": "bun run src/bin/perf-doctor.ts --perf-gates --train --out=.",
  "perf:watch": "bun run src/bin/perf-doctor.ts --watch --perf-gates --report",
  "perf:nightly": "bun run src/bin/perf-doctor.ts --perf-gates --train --report --out=.",
};

const IMAGE_TEMPLATE = join("templates", "modules", "image", "src", "processor.ts");
const CLOCK_TEMPLATE = join("templates", "modules", "clock", "src", "processor.ts");
const UUID_TEMPLATE = join("templates", "modules", "uuid", "src", "processor.ts");
const HTTP_TEMPLATE = join("templates", "modules", "http", "src", "processor.ts");
const DB_TEMPLATE = join("templates", "modules", "db", "src", "processor.ts");
const TERMINAL_TEMPLATE = join("templates", "modules", "terminal", "src", "processor.ts");
const TRANSPILER_TEMPLATE = join("templates", "modules", "transpiler", "src", "processor.ts");
const REGISTER_EFFECT_TEMPLATE = join("templates", "modules", "register-effect.ts");

const TRADING_TREE_PATH = {
  from: "templates/modules/trading/src/trading",
  to: "src/trading",
} as const;

const TRADING_DOCTOR_BIN = join(
  "templates",
  "modules",
  "trading",
  "src",
  "bin",
  "trading-doctor.ts"
);

const TRADING_PACKAGE_SCRIPTS: Record<string, string> = {
  trading: "bun run src/bin/trading-doctor.ts --all --save-artifact",
  "trading:gates": "bun run src/bin/trading-doctor.ts --all --save-artifact",
  "trading:perf": "bun run src/bin/trading-doctor.ts --gate strategy-performance --save-artifact",
  "trading:drift": "bun run src/bin/trading-doctor.ts --gate model-drift --save-artifact",
  "trading:graph": "bun run src/bin/trading-doctor.ts --gate model-drift --gate-graph",
};

export interface ScaffoldModulesResult {
  modules: string[];
  filesWritten: string[];
  skipped: string[];
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const stat = await Bun.file(path).stat();
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function copyTree(
  src: string,
  dest: string,
  dryRun: boolean,
  written: string[]
): Promise<void> {
  if (!pathExists(src)) return;
  if (!(await isDirectory(src))) {
    // Single-file source: copy directly to dest path.
    if (pathExists(dest)) return;
    if (!dryRun) {
      makeDir(join(dest, ".."), { recursive: true });
      await Bun.write(dest, Bun.file(src));
    }
    written.push(dest);
    return;
  }
  const glob = new Bun.Glob("**/*");
  for await (const rel of glob.scan({ cwd: src, absolute: false, onlyFiles: true })) {
    const from = join(src, rel);
    const to = join(dest, rel);
    if (pathExists(to)) continue;
    if (!dryRun) {
      makeDir(join(to, ".."), { recursive: true });
      await Bun.write(to, Bun.file(from));
    }
    written.push(to);
  }
}

async function mergePackageScripts(
  project: string,
  scripts: Record<string, string>,
  dryRun: boolean
): Promise<void> {
  const pkgPath = join(project, "package.json");
  if (!pathExists(pkgPath)) return;
  const pkg = await readPackageManifest(project);
  if (!pkg) return;
  pkg.scripts = { ...pkg.scripts, ...scripts };
  if (!dryRun) await Bun.write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function initTsContent(modules: string[]): string {
  const effectModules = modules.filter((m) =>
    ["image", "clock", "uuid", "http", "db", "terminal", "transpiler"].includes(m)
  );
  const lines = [
    "/**",
    " * init.ts — KIMI_MODULES symbol registration (generated by kimi-fix).",
    " */",
    "",
  ];
  if (effectModules.length > 0) {
    lines.push("import { registerEffect } from './effect/register-effect.ts';");
    lines.push("");
  }
  if (modules.includes("image")) {
    lines.push("import * as image from './effect/image/processor.ts';");
    lines.push("registerEffect('image', image);");
    lines.push("");
  }
  if (modules.includes("clock")) {
    lines.push("import * as clock from './effect/clock/processor.ts';");
    lines.push("registerEffect('clock', clock);");
    lines.push("");
  }
  if (modules.includes("uuid")) {
    lines.push("import * as uuid from './effect/uuid/processor.ts';");
    lines.push("registerEffect('uuid', uuid);");
    lines.push("");
  }
  if (modules.includes("http")) {
    lines.push("import * as http from './effect/http/processor.ts';");
    lines.push("registerEffect('http', http);");
    lines.push("");
  }
  if (modules.includes("doctor")) {
    lines.push("// doctor module: perf harness in src/harness — run `bun run perf:gates`");
    lines.push("");
  }
  if (modules.includes("trading")) {
    lines.push("// trading module: artifact loop in src/trading — run `bun run trading:gates`");
    lines.push("");
  }
  if (modules.includes("db")) {
    lines.push("import * as db from './effect/db/processor.ts';");
    lines.push("registerEffect('db', db);");
    lines.push("");
  }
  if (modules.includes("terminal")) {
    lines.push("import * as terminal from './effect/terminal/processor.ts';");
    lines.push("registerEffect('terminal', terminal);");
    lines.push("");
  }
  if (modules.includes("transpiler")) {
    lines.push("import * as transpiler from './effect/transpiler/processor.ts';");
    lines.push("registerEffect('transpiler', transpiler);");
    lines.push("");
  }
  return lines.join("\n");
}

export async function scaffoldKimiModules(
  project: string,
  modules: string[],
  dryRun: boolean
): Promise<ScaffoldModulesResult> {
  const root = toolchainRoot();
  const written: string[] = [];
  const skipped: string[] = [];

  for (const mod of modules) {
    if (mod === "doctor") {
      for (const { from, to } of DOCTOR_COPY_PATHS) {
        const src = join(root, from);
        const dest = join(project, to);
        if (!pathExists(src)) {
          skipped.push(`${mod}:${from} (source missing)`);
          continue;
        }
        await copyTree(src, dest, dryRun, written);
      }
      await mergePackageScripts(project, DOCTOR_PACKAGE_SCRIPTS, dryRun);
    }

    if (mod === "image") {
      const src = join(root, IMAGE_TEMPLATE);
      const dest = join(project, "src/effect/image/processor.ts");
      if (pathExists(dest)) {
        skipped.push("image:processor.ts");
      } else if (pathExists(src)) {
        if (!dryRun) {
          makeDir(join(dest, ".."), { recursive: true });
          await Bun.write(dest, Bun.file(src));
        }
        written.push(dest);
      }
    }

    if (mod === "clock") {
      const src = join(root, CLOCK_TEMPLATE);
      const dest = join(project, "src/effect/clock/processor.ts");
      if (pathExists(dest)) {
        skipped.push("clock:processor.ts");
      } else if (pathExists(src)) {
        if (!dryRun) {
          makeDir(join(dest, ".."), { recursive: true });
          await Bun.write(dest, Bun.file(src));
        }
        written.push(dest);
      }
    }

    if (mod === "uuid") {
      const src = join(root, UUID_TEMPLATE);
      const dest = join(project, "src/effect/uuid/processor.ts");
      if (pathExists(dest)) {
        skipped.push("uuid:processor.ts");
      } else if (pathExists(src)) {
        if (!dryRun) {
          makeDir(join(dest, ".."), { recursive: true });
          await Bun.write(dest, Bun.file(src));
        }
        written.push(dest);
      }
    }

    if (mod === "http") {
      const src = join(root, HTTP_TEMPLATE);
      const dest = join(project, "src/effect/http/processor.ts");
      if (pathExists(dest)) {
        skipped.push("http:processor.ts");
      } else if (pathExists(src)) {
        if (!dryRun) {
          makeDir(join(dest, ".."), { recursive: true });
          await Bun.write(dest, Bun.file(src));
        }
        written.push(dest);
      }
    }

    if (mod === "db") {
      const src = join(root, DB_TEMPLATE);
      const dest = join(project, "src/effect/db/processor.ts");
      if (pathExists(dest)) {
        skipped.push("db:processor.ts");
      } else if (pathExists(src)) {
        if (!dryRun) {
          makeDir(join(dest, ".."), { recursive: true });
          await Bun.write(dest, Bun.file(src));
        }
        written.push(dest);
      }
    }

    if (mod === "terminal") {
      const src = join(root, TERMINAL_TEMPLATE);
      const dest = join(project, "src/effect/terminal/processor.ts");
      if (pathExists(dest)) {
        skipped.push("terminal:processor.ts");
      } else if (pathExists(src)) {
        if (!dryRun) {
          makeDir(join(dest, ".."), { recursive: true });
          await Bun.write(dest, Bun.file(src));
        }
        written.push(dest);
      }
    }

    if (mod === "transpiler") {
      const src = join(root, TRANSPILER_TEMPLATE);
      const dest = join(project, "src/effect/transpiler/processor.ts");
      if (pathExists(dest)) {
        skipped.push("transpiler:processor.ts");
      } else if (pathExists(src)) {
        if (!dryRun) {
          makeDir(join(dest, ".."), { recursive: true });
          await Bun.write(dest, Bun.file(src));
        }
        written.push(dest);
      }
    }

    if (mod === "trading") {
      const treeSrc = join(root, TRADING_TREE_PATH.from);
      const treeDest = join(project, TRADING_TREE_PATH.to);
      if (!pathExists(treeSrc)) {
        skipped.push(`${mod}:${TRADING_TREE_PATH.from} (source missing)`);
      } else {
        await copyTree(treeSrc, treeDest, dryRun, written);
      }

      const doctorSrc = join(root, TRADING_DOCTOR_BIN);
      const doctorDest = join(project, "src/bin/trading-doctor.ts");
      if (pathExists(doctorDest)) {
        skipped.push("trading:trading-doctor.ts");
      } else if (pathExists(doctorSrc)) {
        if (!dryRun) {
          makeDir(join(doctorDest, ".."), { recursive: true });
          await Bun.write(doctorDest, Bun.file(doctorSrc));
        }
        written.push(doctorDest);
      } else {
        skipped.push(`${mod}:${TRADING_DOCTOR_BIN} (source missing)`);
      }

      await mergePackageScripts(project, TRADING_PACKAGE_SCRIPTS, dryRun);
    }
  }

  const effectModules = modules.filter((m) =>
    ["image", "clock", "uuid", "http", "db", "terminal", "transpiler"].includes(m)
  );
  if (effectModules.length > 0) {
    const regSrc = join(root, REGISTER_EFFECT_TEMPLATE);
    const regDest = join(project, "src/effect/register-effect.ts");
    if (pathExists(regDest)) {
      skipped.push("register-effect.ts");
    } else if (pathExists(regSrc)) {
      if (!dryRun) {
        makeDir(join(regDest, ".."), { recursive: true });
        await Bun.write(regDest, Bun.file(regSrc));
      }
      written.push(regDest);
    } else {
      skipped.push(`${REGISTER_EFFECT_TEMPLATE} (source missing)`);
    }
  }

  const initPath = join(project, "src/init.ts");
  if (!pathExists(initPath)) {
    if (!dryRun) {
      makeDir(join(project, "src"), { recursive: true });
      await Bun.write(initPath, initTsContent(modules));
    }
    written.push(initPath);
  }

  return { modules, filesWritten: written, skipped };
}
