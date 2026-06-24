---
name: kimi-toolchain
description: |
  Teaches agents to operate kimi-toolchain CLI and align with Kimi Code docs.
  Use for kimi-doctor, kimi-governance, kimi-guardian, kimi-fix, kimi-heal,
  kimi-decision, or project health.
  For Kimi Code config/MCP/sessions use `kimi` and `kimi doctor` (official).
whenToUse: |
  Project health, R-Score, lockfile security, scaffolding, failure healing,
  decision rationale, Bun quality gates, cross-tool health telemetry.
  Kimi Code slash commands (/mcp, /goal) and ACP are separate from toolchain CLIs.
layer: L1
trigger:
  - kimi-doctor or project health check
  - bun run check or pre-push gates
  - governance score or guardian
  - scaffold (bun create kimi-toolchain, kimi-new, kimi-fix)
  - sync runtime assets
  - cross-tool health events (kimi-resource-governor health-listen)
dependencies: []
loaded_by: System / On-demand
role: Toolchain meta-runbook — CLI routing, gates, Kimi vs toolchain split
token_estimate: 1350
run_as: inline
metadata:
  companionSkills:
    - create-template
    - effect-discipline
    - effect-hardening
    - herdr
---

# Kimi-Toolchain (L1)

## Kimi Code vs toolchain

| Need                                | Use                                                   |
| ----------------------------------- | ----------------------------------------------------- |
| Kimi config, OAuth, models          | `kimi doctor` (official)                              |
| MCP servers, `/mcp-config`          | `kimi` TUI or edit `~/.kimi-code/mcp.json`            |
| Sessions, goals, subagents          | `kimi` / `kimi --continue` / `kimi --session`         |
| Zed/JetBrains agent                 | `kimi acp` (absolute path to `~/.kimi-code/bin/kimi`) |
| R-Score, guardian, hooks, Bun gates | `kimi-doctor`, `kimi-governance`, `bun run check`     |

**`kimi doctor` (Moonshot) ≠ `kimi-doctor` (toolchain).** Run both after toolchain changes.

Full product matrix: `~/.kimi-code/UNIFIED.md`. Toolchain agent guide: `~/.kimi-code/AGENTS.md`.

## Kimi Code CLI (official)

Docs: https://moonshotai.github.io/kimi-code/en/reference/kimi-command.html

| Flag                           | Short | Notes                                                     |
| ------------------------------ | ----- | --------------------------------------------------------- |
| `--continue`                   | `-C`  | Resume most recent session in cwd                         |
| `--session [id]`               | `-S`  | Resume specific session                                   |
| `--model <alias>`              | `-m`  | One-shot model override                                   |
| `--prompt <text>`              | `-p`  | Non-interactive stdout mode                               |
| `--yolo` / `--auto` / `--plan` |       | Permission / exploration modes — see official config docs |
| `--skills-dir <dir>`           |       | Replace auto-discovered skills                            |

**Conflicts (startup error):** `--continue`+`--session`, `--yolo`+`--auto`, `--plan`+resume flags, `--prompt`+permission flags.

| Slash                     | Purpose                   |
| ------------------------- | ------------------------- |
| `/mcp`                    | MCP connection status     |
| `/mcp-config`             | Interactive MCP editor    |
| `/goal next <text>`       | Queue multi-turn goal     |
| `/reload` / `/reload-tui` | Reload config or TUI only |

| Subcommand                                            | Purpose                           |
| ----------------------------------------------------- | --------------------------------- |
| `kimi login`                                          | OAuth device flow                 |
| `kimi doctor [config\|tui] [path]`                    | Validate config files             |
| `kimi acp`                                            | IDE Agent Client Protocol (stdio) |
| `kimi export [id]`                                    | Session ZIP export                |
| `kimi migrate` / `kimi upgrade`                       | Legacy data / version check       |
| `kimi provider list` / `catalog list` / `catalog add` | Provider management               |

Built-in subagents: `coder`, `explore`, `plan`. Env overrides: `KIMI_MODEL_*` (non-persistent), `KIMI_CODE_BACKGROUND_KEEP_ALIVE_ON_EXIT`, `KIMI_CODE_EXPERIMENTAL_SUB_SKILL`.

## Meta-binary discovery

`kimi-toolchain` itself exposes a few global flags in addition to routing subcommands:

| Flag           | Purpose                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `--help`       | Print usage + tool list                                                 |
| `--version`    | Print toolchain version, commit, and build channel                      |
| `--list-tools` | Emit JSON catalog of every registered tool and its resolved script path |

Use `--list-tools` when automating or shell-completing. If an unknown tool name is passed, the router suggests the closest registered name (e.g. `kimi-toolchain docto` → `Did you mean doctor?`).

## Decision Protocol

Invoke when: project health, `package.json`/`bun.lock`/`bunfig.toml` edits, failures/loops, or scaffold requests.

Effect code or a new CLI using `runCliExit` → load **effect-discipline** (`skills/effect-discipline/SKILL.md`) first; L3 service/stream scaffolds → **effect-hardening** (`skills/effect-hardening/SKILL.md`).

### Examples

Repo-root playbooks in `examples/` (also linked from `error-taxonomy.yml` `docLink` where noted):

- [Dependency push blocked](~/kimi-toolchain/examples/guardian-failure.md) — `lockfile_issue`
- [Project feels off](~/kimi-toolchain/examples/project-health-check.md)
- [What broke?](~/kimi-toolchain/examples/what-broke.md) — `test_failure`
- [Artifact trading loop](~/kimi-toolchain/examples/artifact-trading-loop.md) — L1→L2 feedback loop
- [Control plane layers](~/kimi-toolchain/examples/control-plane-layers.md) — L0–L3 artifact model
- [Artifact dependency graphs](~/kimi-toolchain/examples/artifact-dependency-graphs.md) — data lineage vs gate order
- [Dependency graphs dev workflow](~/kimi-toolchain/examples/dependency-graphs-developer-workflow.md) — CLI, debugging, dashboard

### Project Health Check

```
0. bun run config:status  → after clone or when touching bunfig.toml, constants-parity.toml,
   or manifest-related files; must pass before other checks
1. kimi-toolchain workspace verify  → if cursor slug blocker: reopen ~/kimi-toolchain; kimi-toolchain doctor --fix --fix-cursor
2. kimi doctor
3. kimi-toolchain doctor --ecosystem --quick
4. kimi-heal plan --json
5. kimi-governance score --preflight --quick
6. IF lockfile warn → kimi-guardian check
7. IF coverage gap → bun run test:coverage:fast (or test:coverage:ci)
8. IF governance gap → kimi-governance fix
9. kimi-memory trends
10. PRESENT state + trend + next action
```

### Dependency Changes

```
1. kimi-guardian check (mandatory)
2. IF hash mismatch → block push; ask before kimi-guardian fix (hash baseline); use kimi-guardian sign only for v2 signed manifest protection
3. IF pass → continue
```

### Failure Recovery

```
1. kimi-debug last
2. kimi-debug wire          # auto-discovers latest session
3. ~/.kimi-code/var/tool-failures.jsonl
4. kimi-heal clusters --json && kimi-heal plan --json
5. kimi-decision audit --json
6. kimi-memory trends
7. IF CONTEXT stale → kimi-context-gen freshness / update
8. PRESENT timeline + taxonomyId + heal plan steps
```

Taxonomy lookup: `kimi-debug analyze --json` or `kimi-debug classify <text>` (`~/.kimi-code/error-taxonomy.yml`).

### Scaffold New Project

```
1. bun create kimi-toolchain <name>  OR  kimi-new <name>  OR  mkdir + bun init -m -y + kimi-fix .
2. Default KIMI_MODULES=doctor → perf-doctor harness + isolation factory (override with KIMI_MODULES=image,trace)
3. kimi-fix --profile toolchain when finish-work / Herdr layout needed
4. bun run perf:gates  → verify perf harness after scaffold
5. kimi-fix doctor .
6. kimi-governance score (target ≥ C)
7. kimi login
8. Customize AGENTS.md one-liner, CODE_REFERENCES.md, CODEOWNERS
9. IF editing repo templates → bun run check:template-policy (see create-template skill)
```

### Effect Discipline Repair

```
1. kimi-heal effect audit --check-tags --event-streams --json
2. kimi-heal --fix --dry-run   → preview bare-promise / import rewrites
3. kimi-heal --fix --yes       → apply repairs (src/lib/effect-heal-fix.ts)
4. kimi-doctor --effect-gates  → confirm clean
```

### Agent Operating Loop

| Step     | Action                                                                                       |
| -------- | -------------------------------------------------------------------------------------------- |
| Observe  | `kimi-capabilities --json`, `kimi-trace <trace-id> --json`, or `kimi-doctor --probe`         |
| Scope    | Read `CODE_REFERENCES.md` and pick the closest existing pattern.                             |
| Guard    | Add a detector or gate; search generated scaffolds for the same stale pattern before commit. |
| Validate | Targeted tests, then `bun run check:fast`; full `bun run check` before push.                 |

### Regression Hygiene

After a root-cause fix: add a detector or gate, add a regression test, and search generated scaffolds for siblings with the same mistake.

### Safe git and shell

After index-touching commands: `git diff --cached --stat`; undo staging with `git restore --staged`.
Quote shell searches safely: `rg -e 'pattern'` when the pattern contains shell metacharacters.

### Self-healing

`kimi-heal apply --dry-run` first; `kimi-heal apply --yes` only runs `safeToAutoApply` actions.

### Before Commit or Push

```
1. kimi-githooks doctor
2. bun run check:fast (iterate); bun run check (before push)
3. kimi-guardian check
4. IF runtime assets changed → bun run sync && bun run sync:verify
5. kimi-governance score --preflight --quick  (pre-push blocks D/F)
```

## R-Score

Points out of 110; grades A≥90%, B≥80%, C≥70%, D≥60%, F<60%. Preflight auto-fix: `kimi-governance score --preflight`. Details: [AGENTS.md](~/.kimi-code/AGENTS.md) § R-Score.

## Security Boundaries

- Never suggest `git push --no-verify`
- Never ignore `kimi-guardian` failures
- Never use YOLO (`-y`) with untrusted MCP shell tools
- Never hand-edit `~/.kimi-code/sessions/` or `credentials/`
- Prefer `Bun.secrets` over `.env` files

## Runtime & MCP

- **Memory:** `~/.kimi-code/var/sessions.db` (not Kimi `sessions/wd_*`) — `kimi-memory trends|recall|search`
- **MCP:** `unified-shell` and `bun-docs` auto-registered in `~/.kimi-code/mcp.json` on `bun run sync`; verify with `kimi-doctor --quick`, `kimi-mcp probe bun-docs`, or `/mcp`
- **Capabilities:** `kimi-capabilities --json` — structured capability manifest; pair with `kimi-doctor --probe` for agent automation
- **Introspection:** `kimi-trace <trace-id> --json`, `kimi-contract validate --json`, `kimi-why <topic> --json`; compose via `KimiIntrospectionLive` (`src/lib/effect/kimi-introspection-services.ts`)
- **Decision ledger:** `kimi-decision log --json` — prior rationale for handoffs and audits
- **Hooks:** Git (`kimi-githooks`), Bun postinstall, Kimi lifecycle (`kimi-hooks/`) — see [AGENTS.md](~/.kimi-code/AGENTS.md) § Hooks taxonomy
- **Paths:** `src/lib/paths.ts` helpers; layout in [UNIFIED.md](~/.kimi-code/UNIFIED.md)
- **Skills sync:** `bun run sync` → `~/.kimi-code/skills/` + `~/.agents/skills/` (`kimi-toolchain`, `create-template`, `cloudflare-access`, `effect-discipline`, `effect-hardening`, `herdr`, `orchestrator`, `finish-work`); catalog: `bun run skills:table`
- **Health channel:** `~/.kimi-code/var/health-events.jsonl` — cross-tool telemetry. `kimi-doctor` publishes, `kimi-resource-governor health-listen` subscribes. See `src/lib/health-channel.ts`.

## Doctor gates (dependency graphs)

| Need               | Command                                                               |
| ------------------ | --------------------------------------------------------------------- |
| Run gate + deps    | `kimi-doctor --gate <name> [--save-artifact]`                         |
| Plan without run   | `kimi-doctor --gate <name> --dryrun --json`                           |
| All built-in gates | `kimi-doctor --run-gates [--save-artifact]`                           |
| Execution DAG      | `kimi-doctor --gate-graph [--gate <name>]`                            |
| Artifact lineage   | `kimi-doctor --artifacts-lineage <gate>` or `--artifact-graph <gate>` |

Workflow: `examples/dependency-graphs-developer-workflow.md`. API tables: `docs/references/kimi-doctor.md` § gate graphs.

## Templates & audit scripts

### Bun-create templates

Local `bun create <template>` (from `.bun-create/`) **copies files but does not execute `bun-create.postinstall` commands in Bun 1.3.14/1.4.0**. Therefore:

- Any file a verification checklist expects to exist immediately after `bun create` must be present as a static file in the template directory.
- The `scripts.postinstall` hook should still exist and be idempotent; users run it manually after `bun create` to hydrate placeholders (e.g. `dx.config.toml`).
- Keep template `package.json` dependency fields empty (`{}` or omitted) so `bun create` does not fall back to npm/pnpm/yarn.

Verify a template with:

```bash
bun run check-templates          # registry/package/postinstall constraints
rm -rf /tmp/tmpl && bun create <name> /tmp/tmpl
find /tmp/tmpl -type f | sort    # inspect generated layout
```

### Audit scripts

Read-only audit scripts are safe to run in parallel:

| Script                  | Purpose                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `bun run audit:secrets` | Scan for raw secret-style `Bun.env` / `process.env` access outside `com.herdr.*` registry    |
| `bun run audit:config`  | Verify canonical-references, constants-manifest, constant-parity, bun-install-runtime layers |
| `bun run audit:images`  | Scan image files for anomalies                                                               |
| `bun run audit:network` | Verify `NO_PROXY` bypass configuration                                                       |
| `bun run audit`         | Run the four above in parallel via `bun run --parallel`                                      |
| `bun run audit:dry-run` | Parallel dry-run of all audits                                                               |

Run them after config changes or before a release gate. They do not write files, so `--parallel` is safe.

## Troubleshooting `bun run check:fast`

`check:fast` runs success-metrics, format, `lint --names-only`, typecheck, and unit tests in parallel. It stops at the first failing gate, so fix them in order.

### 1. README drift (`success-metrics` → `drift-latency`)

Every `package.json` script must be discoverable in `README.md`. If you add a script, sync the docs:

```bash
bun run docs:sync        # patches README Project Scripts table
bun run check:fast
```

If `docs:sync` reports "README scripts already in sync" but the gate still fails, verify no manual table references a non-existent script (e.g. `bun run doctor` requires a matching `"doctor": "..."` script in `package.json`).

If new scripts keep appearing in `package.json` after you sync, see § Background process hygiene below.

### 2. Bun-native enforce-mode violations (`lint --names-only` → `bun-native`)

The bun-native gate is in enforce mode for a subset of rules. Two common failures:

#### `src/lib/globs.ts` — replace `node:fs` glob with `Bun.Glob`

Before:

```ts
import { globSync } from "node:fs";
const files = globSync(["src/**/*.{ts,tsx}"], { cwd, exclude: ["**/*.test.*"] });
```

After:

```ts
const excludeGlobs = exclude.map((e) => new Glob(e));
const seen = new Set<string>();
for (const rel of new Glob("src/**/*.{ts,tsx}").scanSync({ cwd, onlyFiles: true })) {
  if (excludeGlobs.some((g) => g.match(rel))) continue;
  seen.add(rel);
}
const files = [...seen].sort();
```

#### `src/doctor/secret-audit.ts` — avoid literal `process.env` in source

The audit regex must match `process.env` in scanned files, but the rule also flags the literal string in the auditor's own source. Build it dynamically:

Before:

```ts
const ENV_RES = [
  { type: "Bun.env" as const, re: /Bun\.env.../g },
  { type: "process.env" as const, re: /process\.env.../g },
];
```

After:

```ts
const PROCESS_ENV = ["process", "env"].join(".") as const;
function envAccessRegex(prefix: string): RegExp {
  return new RegExp(
    prefix.replaceAll(".", "\\.") +
      "(?:\\[(?:[\"'])([^\"']+)(?:[\"'])\\]|\\.\\s*([A-Z_][A-Z0-9_]*))",
    "g"
  );
}
const ENV_RES = [
  { type: "Bun.env" as const, re: envAccessRegex("Bun.env") },
  { type: PROCESS_ENV, re: envAccessRegex(PROCESS_ENV) },
];
```

Do not use `@bun-native-exempt` comments to silence active code paths.

### 3. Background process hygiene

Orphaned `bun test --watch`, `bun test src/doctor`, `bun run typecheck`, or `kimi-githooks run-gates` processes can mutate `package.json`, create/delete source files, and destabilize lint/format output. Symptoms: lint errors that reference files that no longer exist, README drift reappearing after `docs:sync`, or `package.json` scripts accumulating without your edits.

Checklist:

```bash
# 1. List active Bun/toolchain processes
ps aux | grep -E "bun test|bun run typecheck|run-gates|kimi-doctor|kimi-githooks" | grep -v grep

# 2. Kill obvious orphans (keep legitimate MCP/kimi-doctor --mcp-server processes if you use them)
kill <PID>

# 3. Verify workspace state
bun run config:status
bun run check:fast
```

Safe to kill: leftover `--watch`, `--run`, `bun test src/doctor`, and `run-gates` processes that are not attached to your current shell. Keep: `kimi-doctor --mcp-server` if it is your active MCP bridge.

### 4. Format / typecheck / test debt

After lint passes, older format/typecheck/test failures may surface. Iterate faster by skipping tests:

```bash
bun run check:fast:skip-tests
```

Fix format with `bun run format`. For typecheck debt, confirm the error files are in your change set; if they are pre-existing and unrelated, note them rather than widening the PR.

## Related

### Configuration layers & audit

- **Hub doc**: `~/.kimi-code/docs/references/configuration-layers.md` (manifest id `configuration-layers`) — explains the four-layer model.
- **Bun runtime scaffold**: `~/.kimi-code/docs/references/bun-runtime-scaffold.md` (manifest id `bun-runtime-scaffold`) — Bun install config, global virtual store, `process.execve()`, `Bun.Terminal` on Windows, `using`/`await using`.
- **One-shot audit**: `bun run config:status` — checks freshness of `canonical-references.json`, `constants-manifest.json`, parity alignment, and scaffold integrity (step 0 in Project Health Check).
- **Canonical references architecture**: `~/.kimi-code/docs/references/canonical-references-system.md` § System architecture — TOML SSOT loop; edit `canonical-references.toml` → `bun run references:generate` → `bun run sync`.
- **Bun runtime capabilities**: `bun run bun-install:status --json` — 21-key `runtimeCapabilities` inventory (incl. `workspaceFilter`, `workspaceCatalogs`, `bunLink`, `bunPmCli`, `bunPublish`) + `runtimeApiDocs`; `packageManagerFixes` (13) + `runtimeRegressionFixes` (7). PM/monorepo gates: `probe:bun-install:workspace-filter`, `probe:bun-install:workspace-catalogs`, `probe:bun-install:bun-pm`, `probe:bun-install:bun-link`, `probe:bun-install:publish-dry-run`. Doc anchors: [workspaces guide](https://bun.com/guides/install/workspaces#configuring-a-monorepo-using-workspaces), [filter#matching](https://bun.com/docs/pm/filter#matching), [catalogs#overview](https://bun.com/docs/pm/catalogs#overview), [bun link](https://bun.com/docs/pm/cli/link). SSOT: `src/lib/bun-install-config.ts`.
- **Canvas companions** (repo pointers via `cursorCanvas`; not synced to runtime):
  - Conventions: `docs/canvases/README.md`
  - `docs/canvases/kimi-toolchain.canvas.tsx` — project hub (manifest id `unified`)
  - `docs/canvases/kimi-fix.canvas.tsx` — scaffold · bun create · profiles (manifest id `templates`)
  - `docs/canvases/namespace-boundaries.canvas.tsx` — doctor trinity and binding layers (manifest id `namespace`)
  - `docs/canvases/configuration-layers.canvas.tsx` — four-layer config model (manifest id `configuration-layers`)
  - `docs/canvases/doc-links-and-see-ladder.canvas.tsx` — doc-links lint and `@see` ladder (manifest id `code-references`)
  - `docs/canvases/herdr-dashboard-automation.canvas.tsx` — `--automation` gate (manifest id `kimi-doctor`)
  - `docs/canvases/herdr-dashboard-thumbnails.canvas.tsx` — thumbnail pipeline (manifest id `dashboard-thumbnails`)
  - `docs/canvases/herdr-unified-plugin-architecture.canvas.tsx` — Herdr plugin plan (manifest id `herdr-plugin-architecture`)
  - `docs/canvases/kimi-heal-doctor-scaffold.canvas.tsx` — Effect heal + doctor scaffold (manifest id `deep-quality`)
  - `docs/canvases/dashboard-card-registry.canvas.tsx` — card registry · v5.4 wiring (manifest id `v53-architecture`)
  - `docs/canvases/artifact-lineage.canvas.tsx` — run manifests · lineage APIs (manifest id `artifact-lineage`)
- **IDE pickup**: `~/.cursor/projects/Users-nolarose-kimi-toolchain/canvases/*.canvas.tsx` — open beside chat; sync with `bun run sync:cursor-canvases`
- **Canvas generate**: `bun run canvas:generate` — regenerates `CANVAS_ROUTING` + hub stats/inventory from `canonical-references.toml` / `LOCAL_DOC_REFERENCES` and `package.json` (also runs after `bun run references:generate`)
- **Canvas lint**: `bun run scripts/lint-cursor-canvas.ts` — manifest `cursorCanvas` pointers + generated blocks fresh (13 canvases)

- Cached link manifest: `~/.kimi-code/canonical-references.json` (`bun run references:generate`)
- Repo: https://github.com/brendadeeznuts1111/kimi-toolchain
- [CODE_REFERENCES.md](~/.kimi-code/CODE_REFERENCES.md) — local coding exemplars + ecosystem link table
- **Inline doc routing (`@see`)**: [namespace.md § Practical @see ladder](~/.kimi-code/docs/references/namespace.md#practical-see-ladder) — `@see dx` · `@see namespace-boundaries` (name collision resolver + canvas) · lowest rung first; Bun URLs in `src/` via `bun run lint:doc-links`
- Kimi docs: https://moonshotai.github.io/kimi-code/
