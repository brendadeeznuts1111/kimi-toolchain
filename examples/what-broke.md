---
title: "What Broke"
tags: [examples]
category: examples
status: draft
priority: medium
---
# Example: "What Broke?"

## User

> Tests were passing yesterday. What broke?

## Agent (following skill protocol)

Per Failure Recovery:

```bash
kimi-debug last
kimi-debug wire
kimi-heal clusters --json && kimi-heal plan --json
kimi-guardian check
git log -5 --oneline
```

```
── Step 1: kimi-debug last ───────────────────────────────────
  taxonomyId: test_failure
  tool: bun test (pre-push hook)
  suggestion: Test failure — run 'bun test' to see details.

── Step 2: tool-failures.jsonl (recent) ───────────────────────
  kimi-governance  README-drift (4× today, warn)
  kimi-memory      0 warnings

── Step 3: git log -5 --oneline ───────────────────────────────
  cf0b6aa docs: update README and CONTEXT for package structure
  ae2dfc9 docs: expand README with all commands
  a7e3180 feat: add kimi-doctor and kimi-fix implementations
  …

── Step 4: kimi-guardian check ────────────────────────────────
  ✓ Hash matches baseline

── Analysis ───────────────────────────────────────────────────
No lockfile drift. Governance README-drift is a persistent warn —
non-fixable when there are no package.json scripts to drift against.

Tests "breaking" may be:
1. A flaky test (`bun test <file>` to isolate)
2. An environment change (`kimi-snapshot list`)
3. A recent edit — check files mentioned in the failure output

Next: `bun test` on the failing file, then `kimi-decision audit --json`
if the failure repeats.
```
## Related

- [INDEX.md](../INDEX.md) — Documentation index
