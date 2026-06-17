#!/usr/bin/env bun
import { pathExists } from "../lib/bun-io.ts";
/**
 * kimi-context-gen — Auto-generate CONTEXT.md from project scan
 * P1: Tech stack inference, config hash tree, freshness scoring
 *
 * Usage:
 *   kimi-context-gen [scan|freshness|update|doctor|fix]
 */

import { $, semver, TOML } from "bun";
import { join } from "path";
import { ensureDir, getProjectName, resolveProjectRoot } from "../lib/utils.ts";

import { checkDocDrift } from "../lib/readme-sync.ts";
import { guardianDir } from "../lib/paths.ts";
import { createLogger } from "../lib/logger.ts";
import { Effect } from "effect";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";

const logger = createLogger(Bun.argv, "kimi-context-gen");

const GUARDIAN_DIR = guardianDir();
const CONTEXT_META = join(GUARDIAN_DIR, "context-meta.json");

interface TechStack {
  runtime?: string;
  framework?: string;
  database?: string;
  deploy?: string;
  test?: string;
  lint?: string;
}

interface ConfigHash {
  file: string;
  hash: string;
  mtime: number;
}

interface ContextMeta {
  project: string;
  generatedAt: string;
  configHashes: ConfigHash[];
  freshnessScore: number;
}

// ── Tech Stack Inference ─────────────────────────────────────────────

async function inferTechStack(projectDir: string): Promise<TechStack> {
  const stack: TechStack = {};

  const pkgPath = join(projectDir, "package.json");
  const bunfigPath = join(projectDir, "bunfig.toml");
  const wranglerPath = join(projectDir, "wrangler.toml");
  const dockerPath = join(projectDir, "Dockerfile");

  if (pathExists(bunfigPath) || pathExists(join(projectDir, "bun.lock"))) {
    stack.runtime = "Bun >=1.3.14";
    if (pathExists(bunfigPath)) {
      try {
        const config = TOML.parse(await Bun.file(bunfigPath).text()) as any;
        if (config.install?.registry) {
          stack.runtime += ` (registry: ${config.install.registry})`;
        }
      } catch {
        /* ignore */
      }
    }
  } else if (pathExists(pkgPath)) {
    stack.runtime = "Node.js";
  }

  if (pathExists(pkgPath)) {
    const pkg = (await Bun.file(pkgPath).json()) as any;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps.hono) stack.framework = "Hono";
    else if (deps.express) stack.framework = "Express";
    else if (deps.next) stack.framework = "Next.js";
    else if (deps.react) stack.framework = "React";
    else if (deps.vue) stack.framework = "Vue";
    else if (deps.svelte) stack.framework = "Svelte";

    if (deps.typescript || deps.tsx) stack.runtime += " + TypeScript";

    if (deps.vitest || deps.jest) stack.test = deps.vitest ? "Vitest" : "Jest";
    if (deps.oxfmt) stack.lint = deps.oxlint ? "oxfmt + oxlint" : "oxfmt";
    else if (deps.eslint || deps.biome) stack.lint = deps.eslint ? "ESLint" : "Biome";

    const engineBun = pkg.engines?.bun;
    if (engineBun && stack.runtime?.includes("Bun")) {
      try {
        if (!semver.satisfies(Bun.version, engineBun)) {
          stack.runtime += ` (⚠ engine mismatch: needs ${engineBun})`;
        }
      } catch {
        /* ignore */
      }
    }
  }

  const hasPrisma = pathExists(join(projectDir, "prisma", "schema.prisma"));
  const hasDrizzle = pathExists(join(projectDir, "drizzle.config.ts"));
  if (hasPrisma) stack.database = "Prisma + SQLite/PostgreSQL";
  else if (hasDrizzle) stack.database = "Drizzle + SQLite";
  else if (pathExists(join(projectDir, "migrations")))
    stack.database = "D1/SQLite (migrations found)";

  if (pathExists(wranglerPath)) stack.deploy = "Cloudflare Workers";
  else if (pathExists(dockerPath)) stack.deploy = "Docker";
  else if (pathExists(join(projectDir, "fly.toml"))) stack.deploy = "Fly.io";

  return stack;
}

// ── Config Hash Tree ─────────────────────────────────────────────────

async function hashConfigs(projectDir: string): Promise<ConfigHash[]> {
  const configs = ["package.json", "bunfig.toml", "tsconfig.json", "wrangler.toml", "Dockerfile"];
  const hashes: ConfigHash[] = [];

  for (const cfg of configs) {
    const path = join(projectDir, cfg);
    if (!pathExists(path)) continue;
    const file = Bun.file(path);
    const content = await file.arrayBuffer();
    const hash = new Bun.CryptoHasher("sha256");
    hash.update(content);
    hashes.push({ file: cfg, hash: hash.digest("hex"), mtime: file.lastModified });
  }

  return hashes;
}

// ── Multi-Source Freshness ───────────────────────────────────────────

interface FreshnessResult {
  score: number;
  changed: string[];
  readmeDrift: { fresh: boolean; missingFromReadme: string[]; extraInReadme: string[] };
  adrStaleness: { count: number; sourceCommits: number };
  gitActivity: { lastSrcCommit: number; lastContextUpdate: number; daysBehind: number };
}

async function checkReadmeDrift(projectDir: string): Promise<FreshnessResult["readmeDrift"]> {
  const drift = await checkDocDrift(projectDir);
  if (!drift) return { fresh: false, missingFromReadme: [], extraInReadme: [] };
  return {
    fresh: drift.fresh,
    missingFromReadme: drift.missingFromReadme,
    extraInReadme: drift.extraInReadme,
  };
}

async function checkAdrStaleness(projectDir: string): Promise<FreshnessResult["adrStaleness"]> {
  const adrDir = join(projectDir, "docs", "adr");
  let count = 0;
  if (pathExists(adrDir)) {
    const glob = new Bun.Glob("*.md");
    for await (const _ of glob.scan({ cwd: adrDir, absolute: false })) {
      count++;
    }
  }

  let sourceCommits = 0;
  try {
    const result = await $`git log --oneline --since="30 days ago" -- src/`
      .cwd(projectDir)
      .nothrow()
      .quiet();
    sourceCommits = result.stdout.toString().split("\n").filter(Boolean).length;
  } catch {
    sourceCommits = 0;
  }

  return { count, sourceCommits };
}

async function checkGitActivity(projectDir: string): Promise<FreshnessResult["gitActivity"]> {
  let lastSrcCommit = 0;
  let lastContextUpdate = 0;

  try {
    const srcResult = await $`git log -1 --format=%ct -- src/`.cwd(projectDir).nothrow().quiet();
    lastSrcCommit = parseInt(srcResult.stdout.toString().trim()) || 0;
  } catch {
    lastSrcCommit = 0;
  }

  try {
    const ctxResult = await $`git log -1 --format=%ct -- CONTEXT.md`
      .cwd(projectDir)
      .nothrow()
      .quiet();
    lastContextUpdate = parseInt(ctxResult.stdout.toString().trim()) || 0;
  } catch {
    lastContextUpdate = 0;
  }

  const daysBehind =
    lastSrcCommit > lastContextUpdate ? Math.round((lastSrcCommit - lastContextUpdate) / 86400) : 0;

  return { lastSrcCommit, lastContextUpdate, daysBehind };
}

async function computeFreshness(
  projectDir: string,
  currentHashes: ConfigHash[]
): Promise<FreshnessResult> {
  ensureDir(GUARDIAN_DIR);

  let meta: ContextMeta | null = null;
  if (pathExists(CONTEXT_META)) {
    try {
      meta = (await Bun.file(CONTEXT_META).json()) as ContextMeta;
    } catch {
      meta = null;
    }
  }

  const changed: string[] = [];
  if (meta) {
    for (const current of currentHashes) {
      const stored = meta.configHashes.find((h) => h.file === current.file);
      if (!stored || stored.hash !== current.hash) {
        changed.push(current.file);
      }
    }
  } else {
    changed.push(...currentHashes.map((h) => h.file));
  }
  const configScore = Math.max(0, 5 - changed.length);

  const readmeDrift = await checkReadmeDrift(projectDir);
  const readmeScore = readmeDrift.fresh ? 2 : 0;

  const adrStaleness = await checkAdrStaleness(projectDir);
  const adrScore = adrStaleness.count > 0 || adrStaleness.sourceCommits < 5 ? 2 : 0;

  const gitActivity = await checkGitActivity(projectDir);
  const gitScore = gitActivity.daysBehind < 7 ? 1 : 0;

  const score = configScore + readmeScore + adrScore + gitScore;

  return {
    score,
    changed,
    readmeDrift,
    adrStaleness,
    gitActivity,
  };
}

async function storeMeta(projectDir: string, hashes: ConfigHash[], score: number) {
  const meta: ContextMeta = {
    project: await getProjectName(projectDir),
    generatedAt: new Date().toISOString(),
    configHashes: hashes,
    freshnessScore: score,
  };
  await Bun.write(CONTEXT_META, JSON.stringify(meta, null, 2));
}

// ── CONTEXT.md Generator ─────────────────────────────────────────────

async function generateContext(projectDir: string): Promise<string> {
  const name = await getProjectName(projectDir);
  const stack = await inferTechStack(projectDir);

  const structure: string[] = [];
  const glob = new Bun.Glob("*");
  for await (const file of glob.scan({ cwd: projectDir, absolute: false })) {
    if (file.startsWith(".") || file === "node_modules") continue;
    structure.push(file);
  }

  const pkgPath = join(projectDir, "package.json");
  let commands = "";
  if (pathExists(pkgPath)) {
    const pkg = (await Bun.file(pkgPath).json()) as any;
    const scripts = pkg.scripts || {};
    const relevant = Object.entries(scripts)
      .filter(([k]) =>
        ["dev", "test", "build", "lint", "typecheck", "start"].some((s) => k.includes(s))
      )
      .slice(0, 6);
    if (relevant.length > 0) {
      commands = relevant.map(([k, v]) => `bun run ${k}  # ${v}`).join("\n");
    }
  }

  const techRows = Object.entries(stack)
    .map(([k, v]) => `| ${k.charAt(0).toUpperCase() + k.slice(1)} | ${v} |`)
    .join("\n");

  const govLines: string[] = [];
  const licenseFiles = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"];
  let licenseType: string | null = null;
  for (const f of licenseFiles) {
    if (pathExists(join(projectDir, f))) {
      const content = (await Bun.file(join(projectDir, f)).text()).slice(0, 500).toLowerCase();
      if (content.includes("mit")) licenseType = "MIT";
      else if (content.includes("apache")) licenseType = "Apache-2.0";
      else if (content.includes("bsd")) licenseType = "BSD";
      else if (content.includes("gpl")) licenseType = "GPL";
      else licenseType = "Unknown";
      break;
    }
  }
  govLines.push(`| License | ${licenseType || "missing — add LICENSE"} |`);
  govLines.push(
    `| CONTRIBUTING.md | ${pathExists(join(projectDir, "CONTRIBUTING.md")) ? "present" : "missing"} |`
  );

  const codeownersPaths = [
    join(projectDir, "CODEOWNERS"),
    join(projectDir, ".github", "CODEOWNERS"),
    join(projectDir, "docs", "CODEOWNERS"),
  ];
  let codeownersPresent = false;
  let codeownersList: string[] = [];
  for (const path of codeownersPaths) {
    if (pathExists(path)) {
      codeownersPresent = true;
      const lines = (await Bun.file(path).text()).split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const match = trimmed.match(/@[\w-]+/g);
          if (match) codeownersList.push(...match);
        }
      }
      break;
    }
  }
  govLines.push(
    `| CODEOWNERS | ${codeownersPresent ? codeownersList.join(", ") || "present" : "missing"} |`
  );

  const adrDir = join(projectDir, "docs", "adr");
  const adrs: string[] = [];
  if (pathExists(adrDir)) {
    const glob = new Bun.Glob("*.md");
    for await (const file of glob.scan({ cwd: adrDir, absolute: false })) {
      adrs.push(file.replace(/\.md$/, ""));
    }
  }
  const agentReferenceLines = ["AGENTS.md", "CODE_REFERENCES.md", "UNIFIED.md", "TEMPLATES.md"]
    .filter((file) => pathExists(join(projectDir, file)))
    .map((file) => `- \`${file}\``);

  const successMetricsSection = pathExists(join(projectDir, "src/lib/success-metrics.ts"))
    ? `## Success Metrics

Tracked by \`kimi-doctor --success-metrics\`:

| Metric | Contract |
|--------|----------|
| **Drift latency** | Documented commands checkable in one doctor run |
| **Error coverage** | >= 90% of failures classified with taxonomy context |
| **Integration agility** | Providers need only contract + credential adapter |

The metrics are not frozen. Threshold changes follow toolchain **release cadence** and are justified with **failure ledger** evidence.

`
    : "";

  const domainBlurb = pathExists(join(projectDir, "src/bin/kimi-doctor.ts"))
    ? "Bun-native CLI meta-toolkit: project health (`kimi-doctor`), governance (R-Score), supply-chain security (`kimi-guardian`), git hooks, session memory, and scaffolding. Runtime syncs to `~/.kimi-code/` for Kimi Code agents."
    : "[Auto-generated. Describe what this project does and who uses it.]";

  const notesBlurb = pathExists(join(projectDir, "src/bin/kimi-doctor.ts"))
    ? "Canonical clone path: `~/kimi-toolchain`. Agent entry: `kimi-toolchain <tool>`; read `AGENTS.md` before editing. Regenerate this file with `kimi-context-gen update` when layout or scripts change."
    : "[Add domain-specific notes, key decisions, gotchas]";

  return `# CONTEXT — ${name}

## Domain

${domainBlurb}

## Architecture

\`\`\`
${structure.slice(0, 15).join("\n")}
${structure.length > 15 ? "..." : ""}
\`\`\`

## Tech Stack

| Layer | Choice |
|-------|--------|
${techRows || "| Runtime | Unknown |"}

## Commands

\`\`\`bash
${commands || "bun run dev    # Start dev server\nbun test       # Run tests"}
\`\`\`

## Governance

| Check | Status |
|-------|--------|
${govLines.join("\n")}

## Agent References

${agentReferenceLines.length > 0 ? agentReferenceLines.join("\n") : "- Add `AGENTS.md` for project-local agent rules"}

${
  adrs.length > 0
    ? `## Decisions (${adrs.length} ADRs)

${adrs.map((a) => `- \`docs/adr/${a}.md\``).join("\n")}
`
    : "## Decisions\n\nNo ADRs yet. Create one: 'kimi-governance adr <title>'\n"
}

${successMetricsSection}## Port Policy

- Default to \`0\` for auto-assignment. Log actual port on startup.
- Never hardcode ports in source.

## Safety

- No secrets in source. Use \`Bun.env\` or \`Bun.secrets\`.
- Validate all external input at system boundaries.

## Notes

${notesBlurb}

---
*Auto-generated by kimi-context-gen. Update manually as project evolves.*
`;
}

// ── Doctor ───────────────────────────────────────────────────────────

async function doctor(
  projectDir: string
): Promise<
  Array<{ name: string; status: "ok" | "warn" | "error"; message: string; fixable: boolean }>
> {
  const checks: Array<{
    name: string;
    status: "ok" | "warn" | "error";
    message: string;
    fixable: boolean;
  }> = [];

  const contextPath = join(projectDir, "CONTEXT.md");
  checks.push({
    name: "CONTEXT.md",
    status: pathExists(contextPath) ? "ok" : "warn",
    message: pathExists(contextPath) ? "present" : "missing",
    fixable: !pathExists(contextPath),
  });

  const hashes = await hashConfigs(projectDir);
  const { score, changed, readmeDrift, gitActivity } = await computeFreshness(projectDir, hashes);
  checks.push({
    name: "freshness",
    status: score >= 4 ? "ok" : score >= 2 ? "warn" : "error",
    message: `${score}/10 freshness`,
    fixable: score < 4,
  });

  if (changed.length > 0) {
    checks.push({
      name: "config-drift",
      status: "warn",
      message: `${changed.join(", ")} changed since last update`,
      fixable: true,
    });
  }

  checks.push({
    name: "readme-drift",
    status: readmeDrift.fresh ? "ok" : "warn",
    message: readmeDrift.fresh
      ? "in sync"
      : `${readmeDrift.missingFromReadme.length} script(s) missing from README`,
    fixable: false,
  });

  checks.push({
    name: "context-age",
    status: gitActivity.daysBehind < 7 ? "ok" : "warn",
    message:
      gitActivity.daysBehind > 0 ? `${gitActivity.daysBehind} day(s) behind src/` : "up to date",
    fixable: gitActivity.daysBehind >= 7,
  });

  // Check for broken ADR links
  const adrDir = join(projectDir, "docs", "adr");
  if (pathExists(adrDir) && pathExists(contextPath)) {
    const ctxContent = await Bun.file(contextPath).text();
    const adrMatches = ctxContent.match(/docs\/adr\/[^`\]]+/g) || [];
    let broken = 0;
    for (const adrRef of adrMatches) {
      const adrFile = adrRef.replace(/^docs\/adr\//, "").replace(/\/$/, "") + ".md";
      if (!pathExists(join(adrDir, adrFile))) broken++;
    }
    if (broken > 0) {
      checks.push({
        name: "adr-links",
        status: "warn",
        message: `${broken} broken ADR link(s)`,
        fixable: false,
      });
    }
  }

  return checks;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0] || "scan";
  const projectDir = await resolveProjectRoot(Bun.cwd);
  const name = await getProjectName(projectDir);

  logger.projectBanner("Kimi Context Generator", name);

  if (command === "scan") {
    logger.section("Tech Stack Inference");
    const stack = await inferTechStack(projectDir);
    for (const [k, v] of Object.entries(stack)) {
      logger.info(`${k}: ${v}`);
    }

    logger.section("Config Hash Tree");
    const hashes = await hashConfigs(projectDir);
    for (const h of hashes) {
      logger.info(`${h.file}: ${h.hash.slice(0, 16)}...`);
    }

    logger.section("Freshness Score");
    const { score, changed } = await computeFreshness(projectDir, hashes);
    (score >= 4 ? logger.info : score >= 2 ? logger.warn : logger.error)(`Score: ${score}/10`);
    if (changed.length > 0) {
      logger.warn(`Changed configs: ${changed.join(", ")}`);
    }

    await storeMeta(projectDir, hashes, score);

    const contextPath = join(projectDir, "CONTEXT.md");
    if (!pathExists(contextPath)) {
      logger.info("CONTEXT.md missing. Run 'kimi-context-gen update' to create.");
    }
  } else if (command === "update") {
    logger.section("Generating CONTEXT.md");
    const content = await generateContext(projectDir);
    const contextPath = join(projectDir, "CONTEXT.md");

    if (pathExists(contextPath)) {
      logger.warn("CONTEXT.md exists — backing up to CONTEXT.md.bak");
      await Bun.write(join(projectDir, "CONTEXT.md.bak"), await Bun.file(contextPath).text());
    }

    await Bun.write(contextPath, content);
    logger.info(`Written to ${contextPath}`);

    const hashes = await hashConfigs(projectDir);
    await storeMeta(projectDir, hashes, 10);
    logger.info("Freshness baselined at 10/10");
  } else if (command === "freshness") {
    logger.section("Freshness Check");
    const hashes = await hashConfigs(projectDir);
    const { score, changed } = await computeFreshness(projectDir, hashes);

    (score >= 4 ? logger.info : score >= 2 ? logger.warn : logger.error)(`Score: ${score}/10`);
    if (changed.length > 0) {
      for (const c of changed) {
        logger.warn(`${c} changed since last CONTEXT.md update`);
      }
      logger.info("Run 'kimi-context-gen update' to regenerate.");
    } else {
      logger.info("All configs match — CONTEXT.md is fresh");
    }
  } else if (command === "doctor") {
    const checks = await doctor(projectDir);
    return logger.runDoctor(
      "kimi-context-gen",
      checks,
      "Context Doctor",
      "Run 'kimi-context-gen fix' to regenerate CONTEXT.md"
    );
  } else if (command === "fix") {
    logger.section("Fixing CONTEXT.md");
    const hashes = await hashConfigs(projectDir);
    const { score } = await computeFreshness(projectDir, hashes);
    const threshold = parseInt(args[1], 10) || 7;

    if (score < threshold) {
      logger.warn(`Freshness ${score}/10 < threshold ${threshold}/10 — regenerating`);
      const content = await generateContext(projectDir);
      const contextPath = join(projectDir, "CONTEXT.md");
      if (pathExists(contextPath)) {
        await Bun.write(join(projectDir, "CONTEXT.md.bak"), await Bun.file(contextPath).text());
      }
      await Bun.write(contextPath, content);
      await storeMeta(projectDir, hashes, 10);
      logger.info("CONTEXT.md regenerated and freshness baselined");
    } else {
      logger.info(`Freshness ${score}/10 ≥ threshold ${threshold}/10 — no action needed`);
    }
  } else {
    logger.section("Commands");
    logger.info("  scan (default)   Infer tech stack and show freshness");
    logger.info("  update           Generate/regenerate CONTEXT.md");
    logger.info("  freshness        Check freshness score");
    logger.info("  doctor           Check CONTEXT.md health");
    logger.info("  fix [threshold]  Regenerate if freshness below threshold (default 7)");
  }
  return 0;
}

if (import.meta.main) {
  const exitCode = await runCliExit(
    Effect.tryPromise({
      try: () => main(),
      catch: (e) =>
        new CliError({
          message: e instanceof Error ? e.message : String(e),
        }),
    }),
    { toolName: "kimi-context-gen", logger }
  );
  process.exit(exitCode);
}
