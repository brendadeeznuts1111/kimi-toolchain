# Example: "What Broke?"

## User
> Tests were passing yesterday. What broke?

## Agent (following skill protocol)

```
── Step 1: kimi-doctor ──────────────────────────────────────
  ✓ All system checks passed
  ✓ All tool doctors passed

── Step 2: Recent doctor runs (last 24h) ────────────────────
  2024-06-04 14:23  kimi-governance  4 warnings (LICENSE, CODEOWNERS, CHANGELOG, README-drift)
  2024-06-04 18:45  kimi-governance  1 warning  (README-drift)
  2024-06-05 09:12  kimi-memory      0 warnings

── Step 3: Git history ──────────────────────────────────────
  a7e3180 feat: add kimi-doctor and kimi-fix TypeScript implementations
  ae2dfc9 docs: expand README with all commands and subcommands
  cf0b6aa docs: update README and CONTEXT for package structure

── Step 4: Persistent warnings ──────────────────────────────
  ⚠ README-drift [kimi-governance]: 4× since today

── Analysis ─────────────────────────────────────────────────
The 4 governance warnings from yesterday were auto-fixed (LICENSE,
CODEOWNERS, CHANGELOG generated). Only README-drift persists — this
is non-fixable because there's no package.json scripts to drift against.

No new failures detected. Tests "breaking" may be:
1. A flaky test (run `bun test` again?)
2. An environment change (check `kimi-snapshot list`)
3. A dependency that updated silently (check `kimi-guardian check`)

Want me to run the full diagnostic chain?
```
