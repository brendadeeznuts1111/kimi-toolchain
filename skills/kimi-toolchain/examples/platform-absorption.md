# Platform Absorption — How Kimi Absorbs Bun Improvements

When Bun improves (faster transpilation, better TLS, native `using`), the Kimi toolchain automatically tightens its performance thresholds without code changes.

## Substrate Improvements Digest

| #   | Feature               | Bun Change                                                                                                                                   | Kimi Impact                                                                                                    |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | Windows CA Store      | Full Node.js parity: ROOT/CA/TrustedPeople stores, GROUP_POLICY/ENTERPRISE locations, EKU server-auth filtering                              | `kimi.effect.http` benchmarks succeed on Windows enterprise machines instead of throwing TLS errors            |
| 2   | HTTP Protocol Pinning | `fetch(url, { protocol: "http2" \| "http1.1" \| "http3" })` per-request; HTTP/2 hardening (PING flood cap, CONTINUATION limit, GOAWAY fixes) | Network effects benchmarkable per protocol version; safer by default — no silent truncation or memory blow-ups |
| 3   | `fs.watch` Rewrite    | Recursive watching tracks new directories (Linux); recreated files emit `change` (Linux); macOS FSEvents-only (halved thread overhead)       | `kimi-doctor --watch` misses no files in new dirs, uses fewer threads, behaves identically across platforms    |
| 4   | `--no-orphans`        | Auto-exit with recursive child-killing when parent dies; `prctl(PR_SET_PDEATHSIG)` on Linux, `kqueue` on macOS                               | Long-running daemons (`--watch`, `train`) won't zombie under supervisors; half-written artifacts impossible    |
| 5   | `process.execve`      | Replace current process image in-place (POSIX `execve(2)`), inherits stdio, resets signal mask                                               | Optional `IsolationEffect.execve()` for clean process replacement; no zombie chains when chaining scripts      |

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
