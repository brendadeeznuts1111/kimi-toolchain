---
title: "Guardian Failure"
tags: [examples]
category: examples
status: draft
priority: medium
---
# Example: Dependency Change Blocked

## User

> I updated some deps. Can you help me push?

## Agent (following skill protocol)

First, let me check the lockfile integrity:

```bash
kimi-guardian check
```

```
── Lockfile Integrity ───────────────────────────────────────
  Hash: 9e1d4b8a2c...
  ✗ HASH MISMATCH — lockfile may have been tampered with
  ⚠ No signed manifest — run 'kimi-guardian sign' for v2 protection

  Run 'kimi-guardian fix' to baseline the new lockfile.
```

🚫 **Push blocked.** The lockfile changed but wasn't re-baselined.

This is a security measure — it means someone (or something) modified
`bun.lock` without updating the stored hash.

**Did you intentionally modify dependencies?** If so, use `bun add` / `bun update`
(not plain `bun install`), then:

```bash
kimi-guardian fix
kimi-guardian check
# optional v2: kimi-guardian sign
```

Then re-check:

```bash
kimi-guardian check && kimi-toolchain doctor --ecosystem --quick
```

If you **didn't** change deps, this could indicate:

- A supply chain attack (lockfile tampered)
- A tool that auto-modified deps without your knowledge

Want me to show the diff?
## Related

- [INDEX.md](../INDEX.md) — Documentation index
