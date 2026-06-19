# Example: Project Health Check

## User

> My project feels off. Can you check it?

## Agent (following skill protocol)

```
── Running kimi-doctor ──────────────────────────────────────

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
