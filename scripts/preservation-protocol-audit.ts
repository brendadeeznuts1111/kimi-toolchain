#!/usr/bin/env bun
/** @see DIRECTIVE.md — single-file audit CLI; no lib indirection. */
import { $ } from "bun";
import { relative } from "path";
import { scanSourceText } from "../src/lib/autophagy-scan.ts";
import {
  DEFAULT_MIN_DELETION_RATIO,
  deletionMetricReport,
  parseDiffStat,
  passesDeletionMetric,
} from "../src/lib/deletion-metric.ts";
import { repoRoot, scanSourceFilesSync } from "../src/lib/globs.ts";

const ROOT = repoRoot(`${import.meta.dir}/..`);

const GAPS = [
  { file: "src/lib/archive-persistence.ts", re: /Bun\.hash\.crc32/, msg: "Bun.hash.crc32" },
  { file: "src/lib/archive-persistence.ts", re: /\bBun\.Archive\b/, msg: "Bun.Archive" },
  { file: "src/lib/globs.ts", re: /\.scanSync\s*\(/, msg: "Bun.Glob.scanSync" },
  { file: "src/lib/safe-parse.ts", re: /Bun\.JSONC\.parse/, msg: "Bun.JSONC.parse" },
] as const;

type Finding = { kind: string; file: string; line?: number; message: string };

async function gitDiffStat(staged: boolean) {
  const ref = staged ? "--cached" : "HEAD";
  return parseDiffStat(await $`git diff --stat ${ref}`.cwd(ROOT).text());
}

async function changedTs(): Promise<string[]> {
  return (await $`git diff --name-only HEAD`.cwd(ROOT).text())
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\.tsx?$/.test(l));
}

function auditTag(kind: string): string {
  return kind.startsWith("gap") ? "[GAP]" : "[KILL]";
}

/** Pattern Recognition Playbook — DIRECTIVE.md §V */
function scanPatterns(rel: string, text: string): Finding[] {
  const out: Finding[] = [];

  if (rel.endsWith("utils.ts") || rel.endsWith("helpers.ts")) {
    const exports = (text.match(/^export /gm) ?? []).length;
    if (exports >= 8) {
      out.push({
        kind: "utility-drawer",
        file: rel,
        message: `${exports} exports — break monolith; colocate with sole consumer`,
      });
    }
  }

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const n = i + 1;

    if (/export\s+interface\s+I[A-Z]\w+/.test(line)) {
      out.push({ kind: "premature-interface", file: rel, line: n, message: line.trim() });
    }

    if (
      !rel.includes("/test/") &&
      !/\.test\.|\.spec\./.test(rel) &&
      /from\s+["'](?:node:(?:fs|crypto|child_process|http|https|zlib)|fs)["']/.test(line) &&
      !line.includes("not.toContain") &&
      !line.includes("not.toMatch")
    ) {
      out.push({ kind: "node-shim", file: rel, line: n, message: line.trim() });
    }

    if (/export\s+type\s+(\w+)\s*=/.test(line)) {
      const name = line.match(/export\s+type\s+(\w+)\s*=/)?.[1];
      if (name && (text.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length <= 2) {
        out.push({ kind: "single-use-type", file: rel, line: n, message: line.trim() });
      }
    }

    const oneLine = line.replace(/\s+/g, " ");
    if (
      /export\s+async\s+function\s+\w+[^{]*\{\s*return\s+await\s+/.test(oneLine) &&
      /\}\s*$/.test(oneLine)
    ) {
      out.push({ kind: "redundant-async", file: rel, line: n, message: line.trim() });
    }

    if (
      /export\s+(?:async\s+)?function\s+\w+[^{]*\{\s*return\s+\w+\s*\([^)]*\)\s*;?\s*\}\s*$/.test(
        oneLine
      )
    ) {
      out.push({ kind: "middleman-fn", file: rel, line: n, message: line.trim() });
    }

    if (/^\s*try\s*\{/.test(line)) {
      const block = lines.slice(i, Math.min(lines.length, i + 12)).join("\n");
      if (
        /catch\s*\([^)]*\)\s*\{\s*throw\s+[^;]+;\s*\}/.test(block) &&
        !/TaggedError|new \w+Error/.test(block)
      ) {
        out.push({
          kind: "try-catch-chasm",
          file: rel,
          line: n,
          message: "catch log-and-rethrow — let propagate",
        });
      }
      if (/catch\s*\{[^}]*\}/.test(block) && /catch\s*\{\s*\}/.test(block)) {
        out.push({
          kind: "try-catch-chasm",
          file: rel,
          line: n,
          message: "empty catch swallows error",
        });
      }
    }

    if (/process\.env\b/.test(line) && !/\.test\.|\/test\//.test(rel)) {
      const fnHead = lines.slice(Math.max(0, i - 8), i + 1).join("\n");
      if (
        /function\s+\w*[Cc]onfig\w*\s*\(/.test(fnHead) &&
        (fnHead.match(/process\.env|Bun\.env/g) ?? []).length >= 2
      ) {
        out.push({
          kind: "abstracted-config",
          file: rel,
          line: n,
          message: "config builder reads env — use Bun.env at consumption site",
        });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (
      /\bclass\s+\w+(?:Manager|Service|Handler)\b/.test(line) &&
      !/Context\.Tag|extends\s+Effect|@directive-exempt/.test(line)
    ) {
      out.push({ kind: "manager-indirection", file: rel, line: i + 1, message: line.trim() });
    }
  }

  return out;
}

function scanFile(rel: string, text: string): Finding[] {
  const out: Finding[] = [
    ...scanSourceText(rel, text).map((f) => ({
      kind: f.kind,
      file: rel,
      line: f.line,
      message: f.snippet,
    })),
    ...scanPatterns(rel, text),
  ];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (rel === "src/lib/bun-io.ts" && /^\s*return\s+Bun\./.test(line)) {
      out.push({ kind: "wrapper-proxy", file: rel, line: i + 1, message: line.trim() });
    }
    if (/\b(TODO|FIXME|HACK)\b/.test(line) && !line.includes("@directive-exempt")) {
      out.push({ kind: "todo-marker", file: rel, line: i + 1, message: line.trim() });
    }
  }
  return out;
}

async function auditGaps(): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const g of GAPS) {
    const path = `${ROOT}/${g.file}`;
    if (!(await Bun.file(path).exists())) {
      out.push({ kind: "gap-missing-native", file: g.file, message: `missing ${g.msg}` });
      continue;
    }
    const text = await Bun.file(path).text();
    if (!g.re.test(text))
      out.push({ kind: "gap-missing-native", file: g.file, message: `gap — ${g.msg}` });
  }
  return out;
}

async function phase1(changedOnly: boolean, json: boolean): Promise<number> {
  const changed = changedOnly ? await changedTs() : undefined;
  const paths = changed?.length
    ? changed.map((p) => `${ROOT}/${p}`)
    : scanSourceFilesSync(ROOT, { includeScripts: true });
  const findings: Finding[] = changed?.length ? [] : await auditGaps();
  for (const full of paths) {
    if (!(await Bun.file(full).exists())) continue;
    findings.push(...scanFile(relative(ROOT, full), await Bun.file(full).text()));
  }
  const rank = (k: string) =>
    k.startsWith("gap")
      ? 0
      : k === "node-shim" || k === "wrapper-proxy"
        ? 1
        : k.startsWith("manager") || k.startsWith("middleman") || k === "redundant-async"
          ? 2
          : k === "utility-drawer" || k === "premature-interface" || k === "single-use-type"
            ? 3
            : k === "try-catch-chasm" || k === "abstracted-config"
              ? 4
              : 5;
  findings.sort((a, b) => rank(a.kind) - rank(b.kind) || a.file.localeCompare(b.file));

  const lines = ["[PHASE: AUDIT]", "[AUDIT] Phase 1 — [KILL] / [GAP] targets:"];
  if (!findings.length) lines.push("- (none)");
  else {
    for (const f of findings.slice(0, 80)) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`- ${auditTag(f.kind)} ${loc} [${f.kind}] ${f.message}`);
    }
  }
  const report = lines.join("\n");
  if (json) console.log(JSON.stringify({ findings, report }, null, 2));
  else console.log(report);
  return 0;
}

async function main(): Promise<number> {
  const argv = Bun.argv.slice(2);
  if (argv.includes("--metric")) {
    const m = await gitDiffStat(argv.includes("--staged"));
    const min = Number(Bun.env.KIMI_DELETION_RATIO_MIN ?? DEFAULT_MIN_DELETION_RATIO);
    const ok = passesDeletionMetric(m, min);
    console.log(deletionMetricReport(m, min));
    if (!ok) {
      console.error(
        `[SELF-REJECT] Deletion ratio insufficient (${m.deleted}:${m.added}). Re-pruning internally…`
      );
      console.error(`[DELETION-METRIC] need ${min}×`);
    }
    return ok ? 0 : 1;
  }

  const phase = Number(Bun.env.KIMI_AUDIT_PHASE ?? 0);
  const json = argv.includes("--json");
  const approve = argv.includes("--approve") || Bun.env.KIMI_PHASE2_APPROVED === "1";
  const min = Number(Bun.env.KIMI_DELETION_RATIO_MIN ?? DEFAULT_MIN_DELETION_RATIO);

  if (phase === 1) return phase1(argv.includes("--changed"), json);

  if (phase === 2) {
    const m = await gitDiffStat(true);
    if (!(m.deleted > 0 && m.deleted >= m.added)) {
      console.error(`[EXCISE] net-positive or empty diff (${m.added}+ ${m.deleted}-)`);
      return 1;
    }
    if (!approve) {
      console.error("[EXCISE] rerun with --approve");
      return 1;
    }
    console.log(`[EXCISE] ok — net -${m.deleted - m.added}`);
    return 0;
  }

  if (phase === 3) {
    await $`bun run scripts/lint-bun-native.ts --report`.cwd(ROOT).nothrow();
    console.log("[NATIVE-ALIGN] bun-native lint report");
    return 0;
  }

  if (phase === 4) {
    let fail = 0;
    for (const rel of await changedTs()) {
      const path = `${ROOT}/${rel}`;
      if (!(await Bun.file(path).exists())) continue;
      for (const f of scanFile(rel, await Bun.file(path).text())) {
        if (f.kind === "todo-marker") {
          console.log(`- ${f.file}:${f.line} ${f.message}`);
          fail = 1;
        }
      }
    }
    return fail;
  }

  if (phase === 5) {
    const m = await gitDiffStat(false);
    console.log(`[ADVERSARIAL]\n${deletionMetricReport(m, min)}`);
    return passesDeletionMetric(m, min) ? 0 : 1;
  }

  console.error("set KIMI_AUDIT_PHASE=1..5 or pass --metric");
  return 1;
}

process.exit(await main());
