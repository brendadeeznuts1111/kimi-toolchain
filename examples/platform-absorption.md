---
title: "Platform Absorption"
tags: [examples]
category: examples
status: draft
priority: medium
---
# Platform Absorption — How Kimi Absorbs Bun Improvements

When Bun improves (faster transpilation, better TLS, native `using`), the Kimi toolchain automatically tightens its performance thresholds without code changes.

## Substrate Improvements Digest

| #   | Feature                | Bun Change                                                                                                                                   | Kimi Impact                                                                                                    |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Windows CA Store       | Full Node.js parity: ROOT/CA/TrustedPeople stores, GROUP_POLICY/ENTERPRISE locations, EKU server-auth filtering                              | `kimi.effect.http` benchmarks succeed on Windows enterprise machines instead of throwing TLS errors            |
| 2   | HTTP Protocol Pinning  | `fetch(url, { protocol: "http2" \| "http1.1" \| "http3" })` per-request; HTTP/2 hardening (PING flood cap, CONTINUATION limit, GOAWAY fixes) | Network effects benchmarkable per protocol version; safer by default — no silent truncation or memory blow-ups |
| 3   | `fs.watch` Rewrite     | Recursive watching tracks new directories (Linux); recreated files emit `change` (Linux); macOS FSEvents-only (halved thread overhead)       | `kimi-doctor --watch` misses no files in new dirs, uses fewer threads, behaves identically across platforms    |
| 4   | `--no-orphans`         | Auto-exit with recursive child-killing when parent dies; `prctl(PR_SET_PDEATHSIG)` on Linux, `kqueue` on macOS                               | Long-running daemons (`--watch`, `train`) won't zombie under supervisors; half-written artifacts impossible    |
| 5   | `process.execve`       | Replace current process image in-place (POSIX `execve(2)`), inherits stdio, resets signal mask                                               | Optional `IsolationEffect.execve()` for clean process replacement; no zombie chains when chaining scripts      |
| 6   | `bun test --changed`   | Import-graph test selection vs a git ref — run only tests affected by source changes                                                         | `perf:gates:changed` scopes `MODULE_REGISTRY` the same way on PR/pre-push; full suite stays on `perf:nightly`  |
| 7   | Streaming install      | `bun install` streams tarballs to disk; peer-heavy monorepos up to ~8.5× faster                                                              | `kimi.effect.packageInstall` fixture (`--frozen-lockfile`) captures lower `actualMs`; `--train` tightens entry |
| 8   | Source map memory      | Bit-packed maps (~8× less memory on large files); mimalloc v3 + libpas scavenger (~5% process memory)                                        | Harness overhead drops; more benchmark iterations per CI window; scanner pressure reduced in parallel runs     |
| 9   | JavaScriptCore         | Inline caches (array length, `undefined` keys), `toUpperCase` intrinsic, SIMD string ops                                                     | Pure-JS workloads (`perfGate`, HTML reporters, control-plan formatters) speed up; thresholds auto-tighten      |
| 10  | File streaming + Range | `new Response(Bun.file(path))` streams on SSL/Windows; `Bun.serve` native `Range` / 206 partial content                                      | `kimi.effect.fileServer` benchmarks full vs ranged downloads; `perf-report.html` shows streaming matrix        |

## The Self‑Calibrating Chain

```
Bun improves (any of the above)
        ↓
Kimi effects become more reliable, measurable, or safe
        ↓
Benchmarks produce consistent, representative metrics
        ↓
kimi-doctor --train updates thresholds to the new baseline
        ↓
CI gates enforce the tighter, more accurate thresholds
```

## Why This Matters

- **No code changes** — the Symbol contracts, typed interfaces, and harness API are unchanged.
- **Automatic** — training picks up the improvement organically.
- **Cross‑platform** — the same gate passes on macOS, Linux, and Windows.
- **Proven** — any future Bun improvement is absorbed by the same loop.

## Key Architectural Principle

The toolchain treats the runtime as a **substrate**, not a dependency. It measures real behavior, trains on the observed baseline, and gates against regression — making every Bun release an opportunity for tighter performance contracts.

## CI split (PR vs nightly)

| Tier              | Command                      | When                                                                                     |
| ----------------- | ---------------------------- | ---------------------------------------------------------------------------------------- |
| PR / pre-push     | `bun run perf:gates:changed` | Dashboard harness paths changed vs `origin/main`; benchmarks only affected registry keys |
| Nightly / release | `bun run perf:nightly`       | Full `MODULE_REGISTRY` + `--train` + `perf-report.html`                                  |

Escape hatches: `KIMI_SKIP_PERF_GATES=1` (pre-push); `KIMI_PERF_INSTALL=1` (enable install benchmark on CI).
## Related

- [INDEX.md](../INDEX.md) — Documentation index
