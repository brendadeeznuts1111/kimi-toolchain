# Production validation — Herdr orchestration layer

**Run type:** full production validation (single machine, single operator)  
**Target repo:** `kimi-toolchain` (`~/kimi-toolchain`)  
**Profile:** `dx.config.toml` `[herdr]` + `[herdr.orchestrator]` (live reference)  
**Date:** 2026-06-16

---

## Objective

Prove that the **kimi-toolchain Herdr orchestration layer** works end-to-end on this Mac as a daily-driver workflow:

1. **Reactive coordination** — `watch-events` routes Herdr socket + git HEAD signals to `context-sync` and `react` with configured debounce and allowlist.
2. **Agent handoff** — primary (kimi) → secondary (codex) on idle transitions, with scrollback brief and workspace-scoped pane targets.
3. **Worktree isolation** — a linked checkout opens as its own Herdr workspace without colliding with the parent repo workspace.
4. **Effect gates integration** — `kimi-doctor --watch` emits `effect.gates.changed`; orchestrator reacts without manual polling.
5. **Session persistence** — detach/reattach preserves live processes; controlled server restart restores layout and native agent sessions per machine policy.

We are **not** shipping new features in this run. We are validating wiring, docs alignment, and acceptance criteria before treating orchestration as production-ready.

---

## In scope

| Component | Implementation | Config / entry |
|-----------|----------------|----------------|
| **Reactive orchestrator** | `src/lib/herdr-orchestrator-events.ts`, `src/bin/herdr-orchestrator.ts` | `[herdr.orchestrator.events]` in `dx.config.toml`; bootstrap starts `watch-events` |
| **Handoff + context sync** | `src/lib/herdr-orchestrator.ts`, `src/lib/herdr-project-context.ts` | `[herdr.orchestrator]` (`handoffFrom`, `handoffTo`, `contextOnIdle`) |
| **Finish-work escalation** | `src/lib/finish-work-herdr.ts` | `[finishWork]` gates; reviewer tab label `reviewer` — see [finish-work close-loop](./finish-work-close-loop.md) |
| **Effect gates signal** | `src/lib/doctor-watch.ts`, `kimi-doctor --watch` | Doctor tab command; metadata `effect.gates.changed` |
| **Worktree workspace** | `herdr worktree create` / `herdr-project` | `[worktrees].directory` in machine `herdr.toml` → `~/Projects/herdr-worktrees` |
| **Remote agent attach** | Herdr `herdr agent attach` / `herdr --remote` (thin client) | Machine `[remote] manage_ssh_config` in `~/dx-config/config/dx/herdr.toml` |
| **Session restore** | Herdr server snapshot + native integrations | `[session] resume_agents_on_restore` (global); Homebrew = no live handoff |

**Supporting checks (preflight only):**

- `herdr-doctor` — machine integration health (`dx-config`)
- `kimi-doctor --effect-gates` — Effect discipline baseline ([ADR-0001](adr/ADR-0001-effect-gates-baseline.md))
- `bun run sync && bun run sync:verify` — runtime deploy parity ([AGENTS.md](../AGENTS.md))

---

## Out of scope

- Performance tuning, load testing, or debounce optimization
- Multi-user / multi-machine orchestration
- Live handoff across Herdr upgrades (disabled on Homebrew installs)
- `pane_history` replay ([experimental] off on this machine)
- Cloudflare / MCP / dashboard integration plans
- CI/GitHub Actions (local validation only; billing-blocked server CI)
- Authoring or publishing a **worktree-bootstrap** Herdr plugin (optional in Step 4; not required for pass)
- Changes to `kimi-toolchain` source unless a blocking defect is found and fixed in a follow-up commit

---

## Success criteria (acceptance checklist)

All items must pass on the same run date. Record command output or log excerpts in the run notes.

### Preflight

- [ ] `herdr status` — server `running`, client/server protocol compatible
- [ ] `herdr-doctor` — `Status: ready`
- [ ] `kimi-doctor --effect-gates --json` — `summary.ok: true` (no regressions)
- [ ] `bun run sync && bun run sync:verify` — exit 0
- [ ] `bun test test/herdr-orchestrator.unit.test.ts test/herdr-orchestrator-events.unit.test.ts` — exit 0

### Orchestrator bootstrap

- [ ] `herdr-project bootstrap ~/kimi-toolchain` — agents tab: kimi + shell + codex; doctor + shell + **test** (`grok --role`) + reviewer tabs present
- [ ] `herdr-orchestrator status ~/kimi-toolchain` — `enabled`, handoff `kimi → codex`, events `enabled`
- [ ] Shell bootstrap started `watch-events` — `/tmp/herdr-orchestrator-events.log` exists and shows subscription / dispatch lines

### Reactive events

- [ ] `finish-work` commit (or manual `emitWorkspaceUpdatedMetadata`) triggers `context-sync` — codex/kimi panes receive updated brief
- [ ] `git commit` on repo branch triggers `git.ref.changed` → `context-sync` (HEAD watch)
- [ ] `kimi-doctor --watch` gate change emits `effect.gates.changed` → orchestrator `react` (check log + secondary pane message)
- [ ] Disallowed event (not in allowlist) is ignored — no spurious `react`/`context-sync`

### Handoff

- [ ] Primary kimi transitions **working → idle** → handoff message appears in codex pane (`[orchestrator handoff from kimi]`)
- [ ] `herdr-orchestrator context-sync ~/kimi-toolchain --force-context` — delivers `/tmp/workspace-context.md` (or `HERDR_CONTEXT_FILE` override)
- [ ] Pane targets are **workspace-scoped** (pane ids from `herdr agent list`, not bare agent labels when multiple workspaces open)

### Worktree isolation

- [ ] `herdr worktree create --workspace <parent> --branch <slug>` (or CLI equivalent) — checkout under `~/Projects/herdr-worktrees/kimi-toolchain/<slug>`
- [ ] New workspace appears grouped under parent; parent close does not delete checkout
- [ ] Orchestrator `status` / `react` scoped to **kimi-toolchain parent workspace** still behave after worktree workspace is open

### Remote agent (if remote host available)

- [ ] `herdr agent attach <target>` from outside Herdr UI — streams one agent terminal; `ctrl+b q` detaches without stopping server
- [ ] **Or** `herdr --remote <host>` — thin client attach; local keybindings per [persistence-remote](https://herdr.dev/docs/persistence-remote/)

If no remote host is configured, mark **N/A** and do not fail the run.

### Session persistence

- [ ] **Live path:** `ctrl+b q` detach → external `herdr` reattach — panes and agent processes still running (canonical detach)
- [ ] **Restart path (Homebrew):** `herdr server stop` → `herdr` — layout restored from `~/.config/herdr/session.json`; kimi/codex resume via native integrations where session refs exist
- [ ] No `server shut down: server is shutting down` on reattach after server is `running` (`herdr status server`)

### Docs alignment

- [ ] `~/dx-config/config/dx/herdr.md` session matrix matches observed detach vs restart behavior
- [ ] `~/.config/agents/skills/orchestrator/SKILL.md` event → action table matches `routeOrchestratorEvent` in code
- [ ] `dx.config.toml` `[herdr.orchestrator*]` matches `resolveOrchestratorConfig` output from `herdr-orchestrator status --json`

---

## Test sequence (runbook steps 1–7)

Execute in order. Times are indicative; do not skip preflight.

| Step | Action | Pass signal |
|------|--------|-------------|
| **1. Preflight** | `herdr-doctor`; `kimi-doctor --effect-gates --json`; `bun run sync && bun run sync:verify`; unit tests above | All exit 0 / `summary.ok` |
| **2. Bootstrap** | `herder ~/kimi-toolchain` (or `herdr-project bootstrap ~/kimi-toolchain --attach`); confirm tabs/panes and `watch-events` log | Workspace `kimi-toolchain` focused; orchestrator `status` enabled |
| **3. Reactive smoke** | Small commit or `herdr-orchestrator context-sync . --force-context`; confirm doctor tab running `kimi-doctor --watch` | Context files updated; log shows `context-sync` dispatch |
| **4. Worktree** | Create branch worktree workspace (CLI or **optional** [worktree-bootstrap](https://herdr.dev/docs/plugins/) plugin if installed); verify path under `~/Projects/herdr-worktrees/` | Separate workspace id; git checkout isolated |
| **5. Handoff** | Complete a kimi task chunk → idle; optional `herdr-orchestrator react . --force-handoff` | Codex pane receives handoff brief |
| **6. Remote** | `herdr agent attach <kimi-or-codex-target>` from external terminal **or** `herdr --remote <host>` if configured | Attach/detach without server stop |
| **7. Persistence** | Detach (`ctrl+b q`) + reattach; then optional controlled `herdr server stop` + `herdr` to validate snapshot + native restore | Live path keeps processes; restart path restores layout + agent resume |

**Optional plugin (Step 4):** If using Herdr's worktree-bootstrap plugin, install via `herdr plugin install <owner>/<repo>/…` per [plugins docs](https://herdr.dev/docs/plugins/). Record plugin id and action id in run notes. Default validation uses built-in `herdr worktree create` only.

---

## Boundaries — committed vs local

### Committed (git)

| Repo | Path | Role |
|------|------|------|
| **kimi-toolchain** | `dx.config.toml` `[herdr]`, `[herdr.orchestrator*]`, `[finishWork]` | Project orchestration profile (source of truth for this repo) |
| **kimi-toolchain** | `src/lib/herdr-orchestrator*.ts`, `src/bin/herdr-orchestrator.ts` | Orchestration implementation |
| **kimi-toolchain** | `templates/scaffold/dx.config.toolchain.toml` | Scaffold parity with live `dx.config.toml` |
| **dx-config** | `config/dx/herdr.toml`, `herdr.json`, `herdr.md` | Machine theme, keys, worktree root, session/remote policy |
| **dx-config** | `config/agents/skills/orchestrator/SKILL.md` | Agent coordination contract |

### Local / ephemeral (never commit)

| Path | Role |
|------|------|
| `~/.config/herdr/session.json`, sockets, `herdr-*.log` | Herdr runtime state |
| `~/.kimi-code/` | Synced toolchain runtime (`bun run sync`) |
| `/tmp/herdr-orchestrator-events.log` | `watch-events` background log from bootstrap |
| `/tmp/workspace-context.md`, `/tmp/workspace-context.json` | Context-sync deliverables (override via `HERDR_CONTEXT_*`) |
| `~/Projects/herdr-worktrees/` | Git worktree checkouts |
| `.kimi/var/effect-gates.ndjson` | Effect-gates snapshot history |

### Symlink chain (do not flatten)

```
~/.config/herdr/config.toml → ~/.config/dx/herdr.toml → ~/dx-config/config/dx/herdr.toml
```

See [CODE_REFERENCES.md](../CODE_REFERENCES.md) and [dx-config SCOPE.md](https://github.com/brendadeeznuts1111/dx-config/blob/main/SCOPE.md).

### Doc alignment confirmed

- Upstream Herdr: [how-to-work](https://herdr.dev/docs/how-to-work/), [session-state](https://herdr.dev/docs/session-state/), [persistence-remote](https://herdr.dev/docs/persistence-remote/), [agents](https://herdr.dev/docs/agents/), [socket-api](https://herdr.dev/docs/socket-api/)
- Machine layer: `~/dx-config/config/dx/herdr.md` (cross-checked 2026-06-16)
- Orchestrator skill: `~/.config/agents/skills/orchestrator/SKILL.md`
- Effect gates: [ADR-0001](adr/ADR-0001-effect-gates-baseline.md), [DEEP-QUALITY.md](../DEEP-QUALITY.md)

---

## References

### Canonical (upstream)

- [Herdr documentation](https://herdr.dev/docs/)
- [Session state and restore](https://herdr.dev/docs/session-state/)
- [Persistence and remote access](https://herdr.dev/docs/persistence-remote/)
- [Agents and detection](https://herdr.dev/docs/agents/)
- [CLI / socket API](https://herdr.dev/docs/socket-api/)
- [Plugins (worktree-bootstrap)](https://herdr.dev/docs/plugins/)
- [Agent guide](https://herdr.dev/agent-guide.md)

### Local (this machine)

- `~/dx-config/config/dx/herdr.md` — agent matrix, session paths, Homebrew policy
- `~/dx-config/SCOPE.md` — dx-config repo boundaries
- `~/dx-config/config/agents/skills/orchestrator/SKILL.md` — event → action runbook for agents
- [CODE_REFERENCES.md](../CODE_REFERENCES.md) — `[herdr]` ownership and deploy chain
- [AGENTS.md](../AGENTS.md) — sync/handoff validation requirements

### Implementation entry points

```bash
herdr-orchestrator status ~/kimi-toolchain
herdr-orchestrator watch-events ~/kimi-toolchain   # normally via bootstrap
herdr-orchestrator react ~/kimi-toolchain
herdr-orchestrator context-sync ~/kimi-toolchain
kimi-doctor --effect-gates
kimi-doctor --watch
herdr-doctor
```

---

*End of scope document. Update this file when acceptance criteria or the runbook sequence changes.*