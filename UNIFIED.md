# Unified naming, paths, and development

> How **Kimi Code** (Moonshot agent), **kimi-toolchain** (this repo), **dx** (global Bun platform), and `~/.kimi-code/` fit together.

## Name matrix

| Name                               | What it is                                                                      | Canonical path                                            |
| ---------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Kimi Work**                      | Desktop knowledge-work agent (WebBridge, cron, local mounts)                    | `Kimi.app`, `~/Library/Application Support/kimi-desktop/` |
| **Kimi Code**                      | Moonshot terminal coding agent (Node/TypeScript, single-binary SEA)             | `~/.kimi-code/bin/kimi`                                   |
| **kimi-toolchain**                 | Bun-native dev-tools package (this repo)                                        | `~/kimi-toolchain/` (clone path)                          |
| **~/.kimi-code/**                  | Shared runtime home for Kimi Code + toolchain extensions                        | `~/.kimi-code/`                                           |
| **dx**                             | Global Bun dev/audit platform (separate codebase)                               | `~/.local/bin/dx`, `~/.config/dx/`                        |
| **kimi doctor** vs **kimi-doctor** | `kimi doctor` = official Kimi Code config; `kimi-doctor` = toolchain aggregator | Different commands                                        |

**Do not rename** `~/.kimi-code/` — it is the official Kimi Code data directory.

## Directory layout

```
~/.kimi-code/                          # Official Kimi Code home (Moonshot) — DO NOT hand-edit
├── bin/kimi                           # Kimi Code CLI (Node SEA, v0.11+)
├── config.toml                        # Agent: models, permissions, providers
├── tui.toml                           # UI: theme, notifications, auto_upgrade
├── credentials/                       # OAuth (managed:kimi-code)
├── sessions/wd_*/                     # Kimi Code chat sessions (workDir-bound)
├── session_index.jsonl                # Session index (cwd binding)
├── mcp.json                           # User-level MCP (toolchain seeds unified-shell)
├── plugins/                           # Kimi Code plugins
├── skills/                            # User skills (toolchain syncs kimi-toolchain skill)
├── logs/                              # Diagnostic logs
│
├── tools/*.ts                         # EXTENSION: synced from kimi-toolchain src/bin/
├── lib/*.ts                           # EXTENSION: synced from kimi-toolchain src/lib/
├── scripts/*.ts                       # EXTENSION: synced gate scripts
├── var/sessions.db                    # EXTENSION: toolchain memory (not Kimi sessions)
├── governor/                          # EXTENSION: resource governor
├── guardian/                          # EXTENSION: lockfile security
├── toolchain-manifest.json            # EXTENSION: sync metadata
├── AGENTS.md, UNIFIED.md              # EXTENSION: copied from repo

~/kimi-toolchain/                      # Source of truth (this repo)
├── .kimi-code/mcp.json                # Optional project MCP overrides
├── src/bin/kimi-*.ts                  # Edit here
└── scripts/sync-to-desktop.ts         # Repo → ~/.kimi-code/

~/.local/bin/kimi-*                    # Thin wrappers → ~/.kimi-code/tools/*.ts
~/.agents/skills/kimi-toolchain/       # Cursor/Codex skill copy
~/.config/dx/                          # dx global config
```

**Agents: do not edit** `sessions/`, `credentials/`, or `config.toml` from toolchain code. Use `kimi doctor`, `/mcp-config`, or user-approved edits.

## Install Kimi Code (official)

Recommended — single binary, Node bundled inside:

```bash
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
kimi --version
kimi doctor
```

Docs: https://moonshotai.github.io/kimi-code/en/guides/getting-started

Alternative: `npm install -g @moonshot-ai/kimi-code` (Node ≥ 24.15).

## Install kimi-toolchain (this repo)

```bash
git clone https://github.com/brendadeeznuts1111/kimi-toolchain.git ~/kimi-toolchain
cd ~/kimi-toolchain
bun install
bun install -g .                    # global link + postinstall → ~/.kimi-code/
bash scripts/install-bin-wrappers.sh
```

## Development loop

```bash
cd ~/kimi-toolchain

# 1. Edit source
#    src/bin/*.ts  src/lib/*.ts

# 2. Test from repo (fastest)
bun run check:fast          # unit tests @ 100ms (~1s total gate)
bun run check:dry-run       # preview format/lint/typecheck/test steps
bun test                    # full suite (unit + smoke)
bun run doctor --quick

# 3. Push to live runtime
bun run sync

# 4. Verify PATH commands match
kimi-doctor --quick
```

Optional during active toolchain work: `bun run sync:daemon` (every 5 min).

**Rule:** never hand-edit `~/.kimi-code/tools/` — always sync from repo.

## Command routing

| You type         | Resolves to                                                      | Runs                                |
| ---------------- | ---------------------------------------------------------------- | ----------------------------------- |
| `kimi`           | `~/.kimi-code/bin/kimi`                                          | Kimi Code agent TUI                 |
| `kimi doctor`    | same binary                                                      | Official config validator           |
| `kimi-doctor`    | `~/.local/bin/kimi-doctor` → `~/.kimi-code/tools/kimi-doctor.ts` | Toolchain diagnostics               |
| `bun run doctor` | repo `src/bin/kimi-doctor.ts`                                    | Same logic, reads repo package.json |
| `dx config`      | `~/.local/bin/dx`                                                | Machine-wide Bun/DX audit           |

## dx vs kimi-toolchain

| Tool                                              | Scope                                                |
| ------------------------------------------------- | ---------------------------------------------------- |
| `kimi-doctor`, `kimi-guardian`, `kimi-governance` | Project + `~/.kimi-code/` health                     |
| `dx setup`, `dx config`, `dx remediate`           | Machine-wide Bun environment                         |
| `dx.config.toml` in repo                          | Project policy (`containers = "none"`, `memoryGate`) |

## Legacy cleanup

| Path                        | Action                                       |
| --------------------------- | -------------------------------------------- |
| `~/.kimi/`                  | Deprecated — run `kimi migrate`, then remove |
| `~/.kimi-code/bin/kimi.bak` | Safe to delete after upgrade                 |
| `kimicode-cli` folder name  | Done — clone path is `~/kimi-toolchain`      |

## Unify checklist

Required after every clone or toolchain pull:

```bash
cd ~/kimi-toolchain
bun run unify                         # sync + wrappers + doctor + check
```

Or step-by-step:

```bash
cd ~/kimi-toolchain
kimi migrate                          # if ~/.kimi exists
bun run sync                          # repo → ~/.kimi-code/ (+ scripts/)
bash scripts/install-bin-wrappers.sh
kimi doctor                           # Kimi Code config
kimi-doctor --quick                   # toolchain + sync drift + memory
bun run memory-check                  # pre-session gate
```

`kimi-doctor --json` emits structured output for agents. `kimi-doctor --fix` runs `sync`, MCP provisioning, and wrapper install when drift is detected.

## MCP (Model Context Protocol)

Docs: https://moonshotai.github.io/kimi-code/en/customization/mcp.html

| Level   | Path                              | Precedence                 |
| ------- | --------------------------------- | -------------------------- |
| User    | `~/.kimi-code/mcp.json`           | Default for all projects   |
| Project | `.kimi-code/mcp.json` in repo cwd | Overrides same server name |

Toolchain auto-registers **unified-shell** (stdio → `unified-shell-bridge.ts`). Tool name in Kimi: `mcp__unified-shell__execute`.

```bash
bun run sync                    # refreshes bridge + mcp.json entry
kimi-doctor --quick             # MCP section validates wiring
```

In Kimi TUI: `/mcp` (status), `/mcp-config` (interactive edit). Permission rules: `templates/kimi-config-permissions.toml`.

## Editor workflows

### Terminal (Kimi Code TUI)

```bash
cd ~/kimi-toolchain
kimi              # new session for this workDir
kimi --continue   # resume previous session for this directory
```

### Cursor

- Open folder: `~/kimi-toolchain` (not legacy `kimicode-cli`)
- **Composer** uses Cursor's agent (separate from Kimi MCP)
- Integrated terminal `kimi` shares `~/.kimi-code/mcp.json`
- Toolchain: `kimi-doctor`, `bun run check`

### Zed / JetBrains (ACP)

Kimi Code speaks [Agent Client Protocol](https://moonshotai.github.io/kimi-code/en/reference/kimi-acp.html) via `kimi acp`. Use **absolute path** to `kimi`:

```json
{
  "agent_servers": {
    "Kimi Code CLI": {
      "type": "custom",
      "command": "/Users/you/.kimi-code/bin/kimi",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

Run `kimi login` once in terminal before IDE ACP sessions.

## Kimi Code features (0.11.0)

| Feature                 | How                                  |
| ----------------------- | ------------------------------------ |
| Official config check   | `kimi doctor`                        |
| Goal queue              | `/goal next`, `/goal next manage`    |
| MCP                     | `/mcp`, `/mcp-config`                |
| Subagents               | built-in `coder`, `explore`, `plan`  |
| Experimental sub-skills | `KIMI_CODE_EXPERIMENTAL_SUB_SKILL=1` |
| Reload config           | `/reload`, `/reload-tui`             |
