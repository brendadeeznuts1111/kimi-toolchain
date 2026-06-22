---
title: "Project Health Check"
tags: [examples]
category: examples
status: draft
priority: medium
---
# Example: Project Health Check

## User

> My project feels off. Can you check it?

## Agent (following skill protocol)

Per Project Health Check: `bun run config:status`, then `kimi doctor`, then
`kimi-toolchain doctor --ecosystem --quick` (full tool doctors without `--quick`):

```bash
bun run config:status
kimi doctor
kimi-toolchain doctor --ecosystem --quick
```

```
── System ───────────────────────────────────────────────────
  ✓ disk: 45%
  ✓ memory: ~4200MB free
  ✓ load: 1.23

── Toolchain Health ─────────────────────────────────────────
  ✓ kimi-guardian: doctor passed
  ✓ kimi-governance: doctor passed
  ⚠ kimi-context-gen: CONTEXT.md stale (32 days)
  ✓ kimi-memory: doctor passed

── Global Context ───────────────────────────────────────────
  ✓ AGENTS.md: present
  ✓ UNIFIED.md: present
  ✓ TEMPLATES.md: present

── Summary ──────────────────────────────────────────────────
  ⚠ 1 warning(s) found

  Run with --fix to apply tool fixes.
```

The project is healthy overall. One thing: **CONTEXT.md is 32 days stale**.

```bash
kimi-context-gen update
```

This will refresh the architecture docs. Want me to run it?
## Related

- [INDEX.md](../INDEX.md) — Documentation index
