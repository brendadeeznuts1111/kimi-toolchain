# Flake Register

This register tracks flaky tests detected by the flake-hunt and shuffle-hunt scripts.
Follow the same discipline as the Effect Gates violation register: every entry has a
root-cause hypothesis, a fix, and a verification run.

## Detection commands

```bash
# Deterministic order, 5 reruns per file
bun run test:flake-hunt

# Randomized order, 5 reruns per file
bun run test:shuffle
```

Both scripts use `--bail=99999` so the full run completes and surface intermittent
failures that might only appear on attempt N.

## Register

| Test file                       | Test name                        | First seen              | Failure rate              | Failure mode                           | Root cause                                                                                      | Fix                                                                         | Verified                          |
| ------------------------------- | -------------------------------- | ----------------------- | ------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------- |
| `test/tool-runner.unit.test.ts` | `invokeTool applies env overlay` | 2026-06-16 shuffle hunt | 1/5 under randomized load | Test timed out at 500 ms; empty stdout | Fast-gate 500 ms per-test timeout was too tight for a child-process spawn under concurrent load | Increased per-test timeout to 3000 ms for all spawn-heavy tool-runner tests | `test:shuffle` 3040 pass / 0 fail |

## Current baseline

- **Flake hunt**: 3040 pass, 0 fail (75 files, 5 reruns, seed 0).
- **Shuffle hunt**: 3040 pass, 0 fail (75 files, 5 reruns, randomized).
- **Normal run**: 608 pass, 0 fail.
- **Fast gate**: 482 pass, 0 fail.
