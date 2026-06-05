# Unified naming, paths, and development

> How **Kimi Code** (Moonshot agent), **kimi-toolchain** (this repo), **dx** (global Bun platform), and `~/.kimi-code/` fit together.

## Name matrix

| Name                        | What it is                                                                            | Canonical path                     |
| --------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------- |
| **Kimi Code**               | Moonshot terminal coding agent (Node/TypeScript, single-binary SEA)                   | `~/.kimi-code/bin/kimi`            |
| **kimi-toolchain**          | Bun-native dev-tools package (this repo)                                              | `~/kimi-toolchain/` (clone path)   |
| **~/.kimi-code/**           | Shared runtime home for Kimi Code + toolchain extensions                              | `~/.kimi-code/`                    |
| **dx**                      | Global Bun dev/audit platform (separate codebase)                                     | `~/.local/bin/dx`, `~/.config/dx/` |
| **kimi** vs **kimi-doctor** | `kimi doctor` = official Kimi Code config check; `kimi-doctor` = toolchain aggregator | Different commands                 |

**Do not rename** `~/.kimi-code/` — it is the official Kimi Code data directory.

## Directory layout

```
~/.kimi-code/                          # Official Kimi Code home (Moonshot)
├── bin/kimi                           # Kimi Code CLI (Node SEA, v0.11+)
├── config.toml                        # Agent: models, loop_control, providers
├── tui.toml                           # UI: theme, notifications, auto_upgrade
├── credentials/                       # OAuth (managed:kimi-code)
├── sessions/                          # Kimi Code session store
├── mcp.json                           # MCP servers (incl. unified-shell-bridge)
│
├── tools/*.ts                         # EXTENSION: synced from kimi-toolchain src/bin/
├── lib/*.ts                           # EXTENSION: synced from kimi-toolchain src/lib/
├── governor/                          # EXTENSION: resource governor
├── guardian/                          # EXTENSION: lockfile security
├── AGENTS.md, UNIFIED.md              # EXTENSION: copied from repo

~/kimi-toolchain/                      # Source of truth (this repo)
├── src/bin/kimi-*.ts                  # Edit here
├── src/lib/*.ts
├── package.json                       # name: "kimi-toolchain"
└── scripts/sync-to-desktop.ts         # Repo → ~/.kimi-code/

~/.local/bin/kimi-*                    # Thin wrappers → ~/.kimi-code/tools/*.ts
~/.config/dx/                          # dx global config + project registry
```

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
bun test
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

`kimi-doctor --json` emits structured output for agents. `kimi-doctor --fix` runs `sync` + wrapper install when desktop drift is detected.
