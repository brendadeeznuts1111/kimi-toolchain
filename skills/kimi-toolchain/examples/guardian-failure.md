# Example: Dependency Change Blocked

## User

> I updated some deps. Can you help me push?

## Agent (following skill protocol)

First, let me check the lockfile integrity:

```bash
kimi-guardian check
```

```
── Lockfile Guardian ────────────────────────────────────────
  ✗ HASH MISMATCH
    Expected: a3f7c2...
    Actual:   9e1d4b...
    File:     bun.lock

  Run 'kimi-guardian sign' to baseline the new lockfile.
```

🚫 **Push blocked.** The lockfile changed but wasn't re-baselined.

This is a security measure — it means someone (or something) modified
`bun.lock` without updating the stored hash.

**Did you intentionally modify dependencies?** If so:

```bash
kimi-guardian sign
```

Then re-check:

```bash
kimi-guardian check && kimi-doctor
```

If you **didn't** change deps, this could indicate:

- A supply chain attack (lockfile tampered)
- A tool that auto-modified deps without your knowledge

Want me to show the diff?
