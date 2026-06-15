# CONTEXT — kimi-toolchain

> `https://github.com/brendadeeznuts1111/kimi-toolchain`

## Domain

Bun-native extension layer for Kimi Code and project governance. This repo provides diagnostics, MCP bridge provisioning, and scaffolding synced into `~/.kimi-code/` — it does not replace the official Moonshot `kimi` agent (see UNIFIED.md for Kimi Work vs Kimi Code vs kimi-toolchain).

## Architecture

### Repo Structure (source of truth)

```
kimi-toolchain/
  src/
    bin/              # CLI entry points (git-tracked)
      ├── kimi-doctor.ts
      ├── kimi-governance.ts
      ├── kimi-guardian.ts
      ├── kimi-memory.ts
      ├── kimi-githooks.ts
      ├── kimi-context-gen.ts
      ├── kimi-debug.ts
      ├── kimi-resource-governor.ts
      ├── kimi-release.ts
      ├── kimi-snapshot.ts
      └── unified-shell-bridge.ts
    lib/
      └── utils.ts    # Shared utilities (was kimi-utils.ts)
    install-hooks/
      └── postinstall.ts   # Sets up ~/.kimi-code/ on install (bun package hook)
    kimi-hooks/
      └── log-tool-failure.ts  # Kimi Code PostToolUseFailure handler
    guardian/
      └── verify.ts        # Lockfile integrity
    drift/
      └── check.ts         # Dependency drift
```

### Live Runtime (managed by postinstall)

```
~/.kimi-code/
  tools/              # Copied from src/bin/ on install
  lib/                # Copied from src/lib/ on install
  scripts/            # Copied gate scripts
  mcp.json            # User MCP (toolchain seeds unified-shell)
  skills/             # Kimi Code user skills
  var/                # Toolchain sessions.db (not Kimi sessions/)
  guardian/           # Lockfile manifests
  governor/           # Resource cache
  AGENTS.md           # Copied from repo
  CODE_REFERENCES.md  # Copied from repo
  UNIFIED.md          # Copied from repo
  TEMPLATES.md        # Copied from repo
```

## Tech Stack

| Layer    | Choice              |
| -------- | ------------------- |
| Runtime  | Bun >=1.3.14        |
| Language | TypeScript          |
| Database | SQLite (bun:sqlite) |
| Config   | TOML (bunfig.toml)  |
| Deps     | effect, js-yaml     |

## Commands

```bash
# Install globally
bun install -g github:brendadeeznuts1111/kimi-toolchain

# Quality gates
kimi-doctor              # Full toolchain diagnostics
kimi-fix                 # Auto-repair gaps
kimi-guardian check      # Lockfile + CVE scan
kimi-governance score    # Compute R-Score
kimi-governance fix      # Generate missing files

# Session & memory
kimi-memory doctor       # DB health check
kimi-memory trends       # Persistent warnings
kimi-memory autosave start

# Git hooks
kimi-githooks install    # Install pre-commit + pre-push

# Context
kimi-context-gen update  # Regenerate CONTEXT.md
```

## Governance

| Check           | Status  |
| --------------- | ------- |
| License         | MIT     |
| CONTRIBUTING.md | present |
| CODEOWNERS      | present |
| README.md       | present |
| CHANGELOG.md    | present |
| CONTEXT.md      | present |

## Success Metrics

These are enforced by `kimi-doctor --success-metrics` and `bun run check`.

| Metric                  | Contract                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Drift latency**       | One `kimi doctor` or `kimi-doctor` run must produce a pass/fail for documented command drift with no manual inspection.               |
| **Error coverage**      | >= 90% of managed contract, hook, and integration failures must classify to taxonomy ids with stack, inputs, and environment context. |
| **Integration agility** | New cloud providers require only a contract declaration and a thin credential adapter using `getSecret(scope) -> string`.             |

The metrics are not frozen. As the toolchain learns, the taxonomy may expand,
the definition of core logic may tighten, and new metrics may emerge from the
failure ledger. The metrics section follows the toolchain release cadence, and
threshold changes require justification linked to real ledger data.

## Agent References

- `AGENTS.md` — operating rules for future agents
- `CODE_REFERENCES.md` — local exemplar map for Effect, tool runner, logging, config/schema, packages, tests, and Cloudflare/MCP boundaries
- `UNIFIED.md` — Kimi Code vs kimi-toolchain vs DX/MCP product map
- `TEMPLATES.md` — scaffold templates and generated AGENTS.md reference

## Decisions

No ADRs yet. Create one: `kimi-governance adr "<title>"`

## Port Policy

- Default to `0` for auto-assignment. Log actual port on startup.
- Never hardcode ports in source.

## Safety

- No secrets in source. Use `Bun.env` or `Bun.secrets`.
- Validate all external input at system boundaries.

## Notes

- This is a meta-project: it manages the tools that manage other projects.
- Future agents should read `CODE_REFERENCES.md` before adding new modules or packages.
- All tools are Bun-native: use `Bun.file`, `Bun.spawn`, `Bun.hash`, etc.
- Shared utilities in `src/lib/utils.ts` — import from there, don't duplicate.
- Live runtime at `~/.kimi-code/` is managed by `postinstall.ts` — don't edit manually.
- Run `kimi-doctor` for full toolchain diagnostics

---

_Auto-generated by kimi-context-gen. Updated manually._
