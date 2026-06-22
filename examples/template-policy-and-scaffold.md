---
title: "Template Policy & Scaffold — Usage Examples"
tags: [templates, scaffold, bun-create, kimi-new, secrets, skills]
category: "examples"
priority: high
---

<!-- status: stable; owner: @nolarose; review-date: 2026-07-21 -->

# Template Policy & Scaffold — Usage Examples

Runnable paths for greenfield projects, template authoring, and the `check:template-policy` gate.

## Three bootstrap paths

| Path           | Command                                                     | When                                                                 |
| -------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| **bun create** | `bun create kimi-toolchain my-app`                          | From npm/local template; postinstall runs `kimi-fix` (no `bun init`) |
| **kimi-new**   | `kimi-new my-app`                                           | Greenfield bridge: `mkdir` + `bun init -m -y` + `kimi-fix`           |
| **Manual**     | `mkdir my-app && cd my-app && bun init -m -y && kimi-fix .` | Same bridge without the CLI wrapper                                  |

**Collision rule:** Full `bun init` (without `-m`) creates basic `tsconfig.json`, `README.md`, `index.ts`, and `.gitignore` that block `kimi-fix`'s hardened scaffold. Postinstall hooks must **not** call `bun init`.

## User: scaffold a new app

> I need a Bun project with kimi-toolchain gates.

## Agent (following skill protocol)

Load `create-template` + `kimi-toolchain` skills. Default path:

```bash
bun create kimi-toolchain my-app
cd my-app
kimi-fix doctor .
bun run check:fast
```

Or greenfield from an empty directory:

```bash
kimi-new my-app
cd my-app
kimi-fix doctor .
```

`kimi-new` enforces `bun init -m -y` before `kimi-fix` — see `src/bin/kimi-new.ts` and `auditTemplateBootstrapBridge()`.

## User: edit a repo template

> I changed something under `templates/`.

## Agent

After any edit under `templates/**`:

```bash
bun run check:template-policy          # 29 layers (TEMPLATE_POLICY_CHECK_IDS)
bun run check:template-policy --dry-run
bun test test/template-policy-audit.unit.test.ts
bun run verify:bun-features:strict     # when touching verify ritual wiring
```

Policy SSOT: `src/lib/template-policy-audit.ts`. Runbook: `skills/create-template/SKILL.md`.

Layer groups: install/registry, scaffold files + markers, secrets slice + env docs, bootstrap bridge, oxlint, **oxfmt**, typecheck, bun test.

## Secrets in templates

| Template                 | Layout                                           | Bootstrap                                           |
| ------------------------ | ------------------------------------------------ | --------------------------------------------------- |
| `herdr-service-template` | `src/lib/secrets/` stubs + postinstall generator | `Bun.secrets` → env fallback; `resolveDevSecrets()` |
| `kimi-toolchain`         | Optional `secrets/` via `--with-secrets`         | Same contract when flag is set                      |
| All bun-create           | `.env.example` only                              | Document `Bun.secrets` first; never commit `.env`   |

Postinstall scripts that `Bun.spawn` before a secrets registry exists must include a `template-bootstrap` header comment.

## Skill catalog (authoring)

```bash
bun run skills:table              # layer, contract, lib/test coverage
bun run skills:table --verbose    # lib module basenames per skill
bun run skills:table --json       # full paths in skills[]
```

Indexed skills synced by `bun run sync`: `kimi-toolchain`, `create-template`, `cloudflare-access`, `effect-discipline`, `effect-hardening`, `herdr`, `orchestrator`, `finish-work`.

Contract map: `src/lib/skill-contract.ts` · deployed catalog: `templates/scaffold/skills-readme.md`.

## Module slices (optional)

```bash
KIMI_MODULES=trading kimi-fix <path>   # templates/modules/trading
KIMI_MODULES=image kimi-fix <path>     # templates/modules/image
```

Default (`KIMI_MODULES` unset → `doctor`): copies perf harness from `examples/dashboard/src/harness/`.

## Related docs

| Doc                                                                         | Purpose                       |
| --------------------------------------------------------------------------- | ----------------------------- |
| [TEMPLATES.md](../TEMPLATES.md)                                             | Inline copy-paste templates   |
| [docs/references/template-matrix.md](../docs/references/template-matrix.md) | File matrix + collision rules |
| [templates/README.md](../templates/README.md)                               | Template families index       |
| [examples/README.md](README.md)                                             | Runnable showcase hub         |

Dashboard: `GET /api/scaffold` · hub: `http://127.0.0.1:5678/?example=template-policy-and-scaffold&canvas=scaffold`
