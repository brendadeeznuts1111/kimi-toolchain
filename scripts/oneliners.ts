#!/usr/bin/env bun
/**
 * oneliners.ts — Categorized copy-paste one-liner catalog for kimi-toolchain.
 *
 * Usage:
 *   bun run oneliners                          # list all categories
 *   bun run oneliners --all                    # print every one-liner
 *   bun run oneliners scaffold                 # print one-liners for a category
 *   bun run oneliners scaffold secrets         # print multiple categories
 *   bun run oneliners --json                   # JSON output (all categories)
 *   bun run oneliners scaffold --copy          # strip comments, pipe-ready
 *   bun run oneliners --list                   # list category names only
 *   bun run oneliners --help
 */

// ── Types ───────────────────────────────────────────────────────────────

interface OnelinerEntry {
  description: string;
  command: string;
}

interface Category {
  id: string;
  title: string;
  entries: OnelinerEntry[];
}

// ── Data ────────────────────────────────────────────────────────────────

const CATEGORIES: Category[] = [
  {
    id: "scaffold",
    title: "Template Scaffold",
    entries: [
      {
        description: "Create new service from local template",
        command:
          'export BUN_CREATE_DIR="$PWD/templates/bun-create" && bun create herdr-service-template ./zones/zone-9-market-intel --service market-intel --secrets "buckeye-api-key,massey-db-url,webhook-signing-key"',
      },
      {
        description: "Verify generated registry",
        command: "cat ./zones/zone-9-market-intel/src/lib/secrets/_registry.ts",
      },
      {
        description: "Dry-run secret resolution (no env → all ❌, expected)",
        command:
          "cd ./zones/zone-9-market-intel && bun -e \"import {secrets} from './src/lib/secrets/index.ts'; secrets.dryRun()\"",
      },
      {
        description: "Re-run postinstall (idempotency check)",
        command: "cd ./zones/zone-9-market-intel && bun run scripts/postinstall.ts",
      },
    ],
  },
  {
    id: "secrets",
    title: "Secret Operations",
    entries: [
      {
        description: "Store a secret (Bun.secrets v1.3.13+)",
        command: "bun secrets set com.herdr.cli/github-token ghp_xxx",
      },
      {
        description: "Store per-service secret",
        command: "bun secrets set com.herdr.market-intel/buckeye-api-key bk_xxx",
      },
      {
        description: "List all herdr secrets",
        command: "bun secrets list | grep com.herdr",
      },
      {
        description: "Verify isolation (should throw for cross-service access)",
        command:
          "bun -e \"import {secrets} from './src/lib/secrets/index.ts'; secrets.get('com.herdr.other/api-key')\" 2>&1 | grep \"Isolation breach\"",
      },
      {
        description: "Resolve all dev secrets in one call (legacy bridge)",
        command:
          "bun -e \"import {resolveDevSecrets} from './src/lib/secrets/legacy.ts'; console.log(Bun.inspect(resolveDevSecrets()))\"",
      },
    ],
  },
  {
    id: "ci",
    title: "CI / Quality Gates",
    entries: [
      {
        description: "Check all templates have zero dependencies",
        command:
          "bun -e \"import { Glob } from 'bun'; const g=new Glob('*/package.json'); for (const p of g.scanSync({ cwd: 'templates/bun-create', absolute: true })) { const j=await Bun.file(p).json(); const c=Object.keys({...j.dependencies,...j.devDependencies}).length; if(c>0) console.error('❌',p.split('/').slice(-2)[0],c,'deps') }\"",
      },
      {
        description: "Check no bin spawns without resolving secrets",
        command:
          "bun -e \"import { Glob } from 'bun'; const g=new Glob('*.ts'); for (const f of g.scanSync({ cwd: 'src/bin', absolute: true })) { const t=await Bun.file(f).text(); if((t.includes('Bun.spawn')||t.includes('Bun.$'))&&!t.includes('resolveDevSecrets')&&!t.includes('resolveServiceSecrets')) console.error('❌',f.split('/').pop(),'spawns without resolver') }\"",
      },
      {
        description: "Full quality gate (fast)",
        command: "bun run check:fast",
      },
      {
        description: "Full quality gate + secret audit",
        command: "bun run quality:check:ci",
      },
    ],
  },
  {
    id: "audit",
    title: "Migration / Audit",
    entries: [
      {
        description: "Find all raw Bun.env secret access in codebase",
        command:
          "bun -e \"import { Glob } from 'bun'; const src=new Glob('src/**/*.ts'); const test=new Glob('**/*.test.ts'); for (const f of src.scanSync({ absolute: true })) { if(test.match(f)) continue; const t=await Bun.file(f).text(); if(/Bun\\.env\\s*\\[\\s*[\\\"\\'](?!com\\.herdr\\.)/.test(t)) console.log(f) }\"",
      },
      {
        description: "Find all process.env uppercase patterns (legacy)",
        command:
          "bun -e \"import { Glob } from 'bun'; const src=new Glob('src/**/*.ts'); const test=new Glob('**/*.test.ts'); for (const f of src.scanSync({ absolute: true })) { if(test.match(f)) continue; const t=await Bun.file(f).text(); if(/process\\.env\\.[A-Z_]+/.test(t)) console.log(f) }\"",
      },
      {
        description: "Count secrets per service",
        command:
          "bun -e \"import { Glob } from 'bun'; const g=new Glob('src/lib/secrets/_registry.ts'); for (const f of g.scanSync({ absolute: true })) { const t=await Bun.file(f).text(); const m=t.match(/SECRET_NAMES\\s*=\\s*\\[([\\s\\S]*?)\\]/); if(m) console.log(f.split('/').slice(-3)[0], m[1].split('\\\"').filter((_,i)=>i%2===1).length) }\"",
      },
      {
        description: "Generate constants manifest (if changed, commit)",
        command:
          'bun run scripts/generate-constants-manifest.ts && git diff --exit-code || echo "Manifest changed — commit it"',
      },
    ],
  },
  {
    id: "bun",
    title: "Bun-Native Utilities",
    entries: [
      {
        description: "Which kimi-fix binary",
        command: 'Bun.which("kimi-fix")',
      },
      {
        description: "Sleep 5s in agent loop",
        command: "await Bun.sleep(5000)",
      },
      {
        description: "Spawn with timeout and capture output",
        command:
          'const p=Bun.spawn(["git","status"],{timeout:30000,stdout:"pipe"}); const out=await Bun.readableStreamToText(p.stdout)',
      },
      {
        description: "Table inspect secrets status",
        command:
          'Bun.inspect.table([{service:"cli",key:"github-token",status:"✅"}],["service","key","status"])',
      },
      {
        description: "Color severity",
        command: 'Bun.color("red","ansi") + "ERROR" + Bun.color("reset","ansi")',
      },
      {
        description: "Glob + filter in one line",
        command:
          'import { Glob } from "bun"; const src=new Glob("src/**/*.ts"); const test=new Glob("**/*.test.ts"); for (const f of src.scanSync({ absolute: true })) if(!test.match(f)) console.log(f)',
      },
      {
        description: "Atomic file write",
        command: 'await Bun.write("out.ndjson", line + "\\n", {append: true})',
      },
      {
        description: "Fast file read + parse",
        command: 'const cfg = await Bun.file("dx.config.toml").text()',
      },
      {
        description: "Check if file exists",
        command: 'await Bun.file("src/index.ts").exists()',
      },
    ],
  },
  {
    id: "ritual",
    title: "The Daily Dev Ritual",
    entries: [
      {
        description: "Morning — verify all secrets",
        command:
          'for s in cli dashboard core harness metrics; do echo "=== $s ==="; bun -e "import {secrets} from \'./src/lib/secrets/index.ts\'; secrets.dryRun()" 2>/dev/null; done',
      },
      {
        description: "Before push — full gate",
        command: 'bun run quality:check:ci && bun test && git diff --check || echo "BLOCKED"',
      },
      {
        description: "After push — verify remote",
        command: "git log --oneline -3 && git status",
      },
    ],
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────

const BOLD = Bun.color("bold", "ansi") ?? "\x1b[1m";
const DIM = Bun.color("dim", "ansi") ?? "\x1b[2m";
const CYAN = Bun.color("cyan", "ansi") ?? "\x1b[36m";
const RESET = Bun.color("reset", "ansi") ?? "\x1b[0m";

function categoryById(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

function printCategory(cat: Category, copyMode: boolean): void {
  if (!copyMode) {
    console.log(`${BOLD}${CYAN}## ${cat.title}${RESET}`);
    console.log();
  }
  for (const entry of cat.entries) {
    if (!copyMode) {
      console.log(`${DIM}# ${entry.description}${RESET}`);
    }
    console.log(entry.command);
    if (!copyMode) console.log();
  }
  if (!copyMode) console.log();
}

function printList(): void {
  for (const cat of CATEGORIES) {
    const count = cat.entries.length;
    console.log(`  ${cat.id.padEnd(10)} ${DIM}(${count} entries)${RESET}  ${cat.title}`);
  }
}

function printAll(copyMode: boolean): void {
  for (const cat of CATEGORIES) {
    printCategory(cat, copyMode);
  }
}

function printHelp(): void {
  console.log(`${BOLD}oneliners${RESET} — Categorized copy-paste one-liner catalog

${BOLD}Usage:${RESET}
  bun run oneliners                          List all categories
  bun run oneliners --all                    Print every one-liner
  bun run oneliners <category>               Print one-liners for a category
  bun run oneliners <cat1> <cat2>            Print multiple categories
  bun run oneliners --list                   List category names only
  bun run oneliners --json                   JSON output (all categories)
  bun run oneliners <category> --copy        Strip comments, pipe-ready
  bun run oneliners --help                   Show this help

${BOLD}Categories:${RESET}`);
  for (const cat of CATEGORIES) {
    console.log(`  ${cat.id.padEnd(10)} ${cat.title}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────

const argv = Bun.argv.slice(2);

if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

const jsonMode = argv.includes("--json");
const listMode = argv.includes("--list");
const allMode = argv.includes("--all");
const copyMode = argv.includes("--copy");

const requested = argv.filter((a) => !a.startsWith("--"));

if (jsonMode) {
  const payload = CATEGORIES.map((c) => ({
    id: c.id,
    title: c.title,
    entries: c.entries.map((e) => ({ description: e.description, command: e.command })),
  }));
  console.log(JSON.stringify({ categories: payload }, null, 2));
  process.exit(0);
}

if (listMode) {
  printList();
  process.exit(0);
}

if (allMode) {
  printAll(copyMode);
  process.exit(0);
}

if (requested.length > 0) {
  const found: Category[] = [];
  const missing: string[] = [];
  for (const id of requested) {
    const cat = categoryById(id);
    if (cat) found.push(cat);
    else missing.push(id);
  }
  if (missing.length > 0) {
    console.error(`${BOLD}Unknown category:${RESET} ${missing.join(", ")}`);
    console.error(`Available: ${CATEGORIES.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }
  for (const cat of found) {
    printCategory(cat, copyMode);
  }
  process.exit(0);
}

// No positional args and no recognized mode — show help
printHelp();
process.exit(0);
