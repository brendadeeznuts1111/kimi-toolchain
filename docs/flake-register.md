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

| Test file                                          | Test name                                              | First seen              | Failure rate                          | Failure mode                                                                                                  | Root cause                                                                                                                                                                                                    | Fix                                                                                                                                                                                                    | Verified                                                     |
| -------------------------------------------------- | ------------------------------------------------------ | ----------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `test/tool-runner.unit.test.ts`                    | `invokeTool applies env overlay`                       | 2026-06-16 shuffle hunt | 1/5 under randomized load             | Test timed out at 500 ms; empty stdout                                                                        | Fast-gate 500 ms per-test timeout was too tight for a child-process spawn under concurrent load                                                                                                               | Increased per-test timeout to 3000 ms for all spawn-heavy tool-runner tests                                                                                                                            | `test:shuffle` 3040 pass / 0 fail                            |
| `test/bun-image.unit.test.ts`                      | `dashboardWebpThumbnail shrinks a WebView PNG capture` | 2026-06-18 pre-commit   | 1/2 under `--changed` concurrent load | Test timed out at 15000 ms; WebView + screenshot + thumbnail pipeline exceeds 15s under concurrent load       | Bun.WebView creation + navigation + capture runs slower when 35 test files execute concurrently                                                                                                               | Increased per-test timeout to 30000 ms                                                                                                                                                                 | TBD                                                          |
| `test/bun-webview-automation.unit.test.ts` (batch) | full `test:fast` batches containing WebView tests      | 2026-07-18 check:fast   | 3/6 gate runs under machine load      | Runner process spun at ~99% CPU after all tests in the batch passed; never exited (no per-test timeout fired) | Bun 1.4.0 canary test-runner: worker teardown race with the shared WebKit host subprocess (see `docs/references/bun-webview.md`; aggravated by concurrent gates sharing `.kimi-test-locks`-less entry points) | Wall-clock watchdog in `runGate` (kills stuck steps), `afterAll(closeAll)` in WebView test files, project test gate serializing `check.ts`/`test-fast.ts`, `timeoutMs` default restored to tier values | batches pass standalone; gate-level spin bounded by watchdog |

## Current baseline

- **Flake hunt**: TBD.
- **Shuffle hunt**: TBD.
- **Normal run**: 608 pass, 0 fail.
- **Fast gate**: 482 pass, 0 fail.
