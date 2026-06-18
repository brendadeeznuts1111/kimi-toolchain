---
name: finish-work
description: |
  Agent close-loop for kimi-toolchain: run quality gates, commit/push, detect dirty
  post-push tree, escalate to reviewer pane, and signal orchestrator. Load when
  closing a work chunk inside Herdr (HERDR_ENV=1) or when user asks to commit/push
  with gates.
whenToUse: |
  End of an implementation chunk in a Herdr workspace — run gates, conventional commit,
  optional push, handle dirty-tree escalation, and trigger context-sync on clean closes.
  For cross-pane handoffs after idle transitions, load orchestrator instead.
layer: L3
trigger:
  - close-loop commit and push with gates
  - dirty-tree escalation to reviewer
  - workspace.updated after clean push
  - finish-work:handoff-ready probe
dependencies:
  - orchestrator
  - effect-discipline
loaded_by: HERDR_ENV gate
role: Agent close-loop — gates, git, escalation, orchestrator signals
token_estimate: 560
run_as: inline
metadata:
  companionSkills:
    - orchestrator
---

# Finish-Work (L3)

`finish-work` answers: _"I pushed my work — did gates pass, is the tree clean, and does the team know what happened?"_

Depth (socket semantics, status persistence, smoke recipes): `~/kimi-toolchain/docs/finish-work-close-loop.md`. Code: `src/lib/finish-work-herdr.ts`, `scripts/finish-work.ts`.

## Command

```bash
bun run finish-work --message "feat: …"           # gates + commit
bun run finish-work --message "…" --push         # gates + commit + push
bun run finish-work --skip-git --message "…"     # gates only
bun run finish-work --json --message "…" --push  # machine-readable report
```

Report on disk: `.kimi/finish-work-report.json` (gitignored).

## Pipeline order (critical)

Order is intentional — do not reorder:

1. **Gates** — `[finishWork].gates` (default: `check:fast`, `kimi-doctor --effect-gates`, `kimi-heal effect audit`). Any failure → exit 1.
2. **Git** — `git add -u`, `git commit -m`, optional `git push`. Requires `--message`.
3. **Dirty-tree check** — `git status --porcelain` after successful push.
4. **Escalation** — if pushed and tree not clean → reviewer pane **before** followUp.
5. **followUp** — `[finishWork.followUp].command` (default: `kimi-doctor --effect-floor`). Skipped when post-push tree is dirty.
6. **Workspace metadata** — `emitWorkspaceUpdatedMetadata()` only on **non-escalated** clean closes → orchestrator `context-sync`.

When `HERDR_ENV=1`, `kimi-heal effect audit` runs in the **doctor tab** via `herdr pane run` (hard-fail if doctor tab missing).

## Outcomes

| `outcome`            | Meaning                                          | Exit                             |
| -------------------- | ------------------------------------------------ | -------------------------------- |
| `ok` / `clean`       | Gates passed; tree clean after push (or no push) | 0                                |
| `escalated`          | Pushed with dirty tree; reviewer notified        | 0 (2 if Herdr escalation failed) |
| `failed` / `aborted` | Gate, git, or followUp failure                   | 1                                |

## Herdr integration

Requires `HERDR_ENV=1` and `HERDR_PANE_ID` for escalation and metadata. Outside Herdr: gates and git still run; escalation skipped (`herdr.skipped: "not inside herdr"`).

### Semantic vs display status

| RPC                    | Effect                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| `pane.report_agent`    | **Semantic** — `agent_status` (`blocked`, `idle`, …)                      |
| `pane.report_metadata` | **Display-only** — `custom_status`, title; does not change semantic state |

On escalation:

1. `pane.report_agent` — `--state blocked`, `--agent finish-work`, `--custom-status needs-review`
2. `pane.report_metadata` — `--custom-status needs-review` (wins over stale `workspace.updated` TTL)

On clean close only: `emitWorkspaceUpdatedMetadata()` with `--custom-status workspace.updated` (orchestrator routes to `context-sync`).

Guard: skip metadata when `outcome === "escalated"` or pane is blocked for review (`isPaneBlockedForReview`).

## Configuration

```toml
[finishWork]
gates = [
  "bun run check:fast",
  "kimi-doctor --effect-gates",
  "kimi-heal effect audit",
]

[finishWork.followUp]
command = "kimi-doctor --effect-floor"
```

Reviewer tab: `[[herdr.tabs]]` with `label = "reviewer"`. Doctor tab: `label = "doctor"`, `command = "kimi-doctor --watch"`.

Bootstrap should start the event watcher:

```toml
# [herdr].bootstrap
"herdr-orchestrator watch-events . >/tmp/herdr-orchestrator-events.log 2>&1 &"
```

## Dirty-tree notes

- `git add -u` stages **tracked** modifications only.
- **Untracked** files outside `.gitignore` remain dirty → escalation after push.
- `.kimi/` is gitignored — does not trigger escalation.

## Handoff probe

Post-review orchestrator rules use probe `finish-work:handoff-ready` with `when = { finishWorkReport.review.resolved = true, pane.status = "idle" }`.

## Related skills

- **orchestrator** — `watch-events`, `context-sync`, handoff after `workspace.updated`
- **herdr** — `HERDR_PANE_ID`, `pane report-agent`, session routing
- **effect-discipline** — effect-gates and heal audit failures

## Do not

- Run `followUp` before dirty-tree check — escalation must win.
- Emit `workspace.updated` on escalated closes — it overrides `needs-review` display.
- Use `finish-work` as a substitute for `bun run check` during iteration — use `check:fast` locally first.
