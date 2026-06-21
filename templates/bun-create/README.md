# bun-create templates

This directory contains the templates consumed by `bun create <name>`. They are minimal `package.json`-only starters whose postinstall hooks delegate the real scaffolding to `kimi-fix`.

Registry SSOT: [`templates.json`](./templates.json).

## Templates

| Template                      | Type      | Complexity | Example / specialization                       | Purpose                                                                                                           |
| ----------------------------- | --------- | ---------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `kimi-toolchain`              | scaffold  | minimal    | none (generic)                                 | Greenfield Bun project with governance, guardian, and quality gates.                                              |
| `kimi-dashboard`              | server    | minimal    | [`examples/dashboard/`](../examples/dashboard) | Bun-native HTTP dashboard starter; full showcase is in `examples/dashboard/src/handlers/`.                        |
| `kimi-gates`                  | cli       | medium     | [`examples/gates/`](../examples/gates)         | Generic L1→L2 gate tree with artifact persistence and lineage. `examples/trading-workspace/` is a specialization. |
| `artifact-portal-convergence` | workspace | minimal    | [`examples/portal/`](../examples/portal)       | Artifact Portal convergence — Canvas + Dashboard + Herdr → disk.                                                  |

## Important naming note

`kimi-gates` is intentionally **generic**: it scaffolds `src/gates/` and `src/lib/`. The matching runnable example is [`examples/gates/`](../examples/gates).

[`examples/trading-workspace/`](../examples/trading-workspace) is a **domain specialization** of that pattern: it uses `src/trading/gates/` and `src/trading/lib/` because the gates are trading-specific. When authoring a new gate tree, copy the `kimi-gates` layout and rename `gates/` / `lib/` to your domain if the gates are not generic.

## Template rules

- **Zero dependencies.** If a template `package.json` includes `dependencies`/`devDependencies`, `bun create` may run an npm client other than Bun. Keep dependencies empty; let `kimi-fix` install tools.
- **No README in the template.** `kimi-fix` generates the project README from `templates/scaffold/README.md`. A README inside the bun-create template would be skipped by `kimi-fix`'s `!pathExists()` guard.
- **Postinstall must be idempotent.** The `kimi-toolchain` template installs the toolchain globally and runs `kimi-fix .`; both operations are safe to repeat.

## Local development

```bash
# From the repo root
bun create kimi-toolchain /tmp/my-app

# Or point BUN_CREATE_DIR at this folder for rapid iteration
export BUN_CREATE_DIR="$PWD/templates/bun-create"
bun create kimi-toolchain /tmp/my-app
```

## Runtime mirror

`.bun-create/` at the repo root is a generated mirror of this directory. It is created by `bun install -g github:brendadeeznuts1111/kimi-toolchain` and refreshed by `bun run sync`. It is gitignored — edit `templates/bun-create/` instead.

## Adding a new bun-create template

See [`skills/create-template/SKILL.md`](../skills/create-template/SKILL.md).
