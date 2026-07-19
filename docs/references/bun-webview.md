# Bun.WebView — grounded reference (kimi-toolchain)

Grounding for every `Bun.WebView` usage in this repo. Source of truth is the
Bun documentation; this file pins versions, contract points, and our usage policy.

## Release

- **Introduced:** Bun **v1.3.12** (2026-04-09) — "WebView — Headless Browser Automation".
- **Status:** experimental; API may change between releases.
- **Repo floor:** `.bun-version` = 1.4.0 (canary line) — all WebView features used here are available.

## Canonical links

| Doc                                                        | URL                                               |
| ---------------------------------------------------------- | ------------------------------------------------- |
| Release blog (v1.3.12)                                     | https://bun.com/blog/bun-v1.3.12                  |
| Runtime guide                                              | https://bun.com/docs/runtime/webview              |
| API reference                                              | https://bun.com/reference/bun/WebView             |
| Constructor options                                        | https://bun.com/reference/bun/WebView/constructor |
| Known issue: actionability timeouts on the v1.3.12 example | https://github.com/oven-sh/bun/issues/29156       |

## How it works (contract we rely on)

- Two backends, one API: `"webkit"` (macOS default, system WKWebView, zero deps)
  and `"chrome"` (cross-platform, CDP over pipe/WebSocket). We default to WebKit.
- WebKit backend spawns a **host subprocess once per Bun process** (the bun
  binary re-executed in a special mode); every WebKit view in the process shares
  it. Chrome spawns once per process too; each view is a tab.
- Selector input (`click(selector)`, `scrollTo`) **auto-waits for actionability**
  at `requestAnimationFrame` rate: attached, non-zero box, in viewport, stable
  for 2 frames, unobscured. Default timeout 30_000 ms; always pass an explicit
  `timeout` in tests.
- Input dispatches native OS events (`isTrusted: true`).
- Lifecycle: `view.close()` is synchronous and idempotent; `using`/`await using`
  dispose to `close()`. `Bun.WebView.closeAll()` SIGKILLs all browser
  subprocesses and is called automatically at process exit.
- Event loop: an open view keeps the process alive **only while an operation is
  pending**. A settled, unclosed view does not block exit.
- Concurrency: one in-flight op per slot per view; second concurrent op throws
  `ERR_INVALID_STATE` (no queueing). Always `await` each call.

## Usage in this repo

| Surface                   | Files                                                                                  | Notes                                                              |
| ------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Automation contract tests | `test/bun-webview-automation.unit.test.ts`                                             | isTrusted + actionability regression guard                         |
| Dashboard thumbnails      | `src/lib/bun-image.ts`, `src/lib/herdr-dashboard/effect-image.ts`                      | screenshot pipeline; see `docs/references/dashboard-thumbnails.md` |
| Examples dashboard        | `src/lib/examples-dashboard-webview.ts`, `src/lib/examples-dashboard-webview-probe.ts` | live probes + screenshots                                          |
| Herdr dashboard shell     | `src/lib/herdr-webview-dashboard.ts`, `src/lib/herdr-dashboard/webview/options.ts`     | orchestrator UI shell                                              |
| Console capture           | `src/lib/webview-console.ts`                                                           | page console → Bun console                                         |
| Bun docs surfaces         | `src/lib/bun-docs-webview.ts`                                                          | docs rendering probes                                              |

## Usage policy (tests and gates)

1. Always `await using view = new Bun.WebView(...)` (or `try/finally view.close()`).
2. Always pass an explicit `timeout` to selector actions in tests (we use 8_000 ms).
3. Call `Bun.WebView.closeAll()` in `afterAll` in any test file that creates
   views — do not rely on exit-time cleanup inside the test runner.
4. Skip when `typeof Bun.WebView !== "function"` (runtime feature guard).
5. WebView tests spawn real OS browser processes — keep them out of tight
   pre-commit paths; heavy thumbnail/screenshot flows belong to integration tier.

## Known issues

- **oven-sh/bun#29156** — `timeout waiting for … to be actionable` on the v1.3.12
  blog example. Our actionability tests use explicit timeouts and generous
  reveal margins to stay clear of this.
- **Test-runner spin (this repo, 2026-07-18)** — batches containing WebView tests
  intermittently spun at ~99% CPU in the harness runner after tests completed
  (canary 452139e36 and a227ad991, macOS arm64). Mitigations: gate wall-clock
  watchdog in `runGate`, per-file `afterAll(closeAll)`. Tracked in
  `docs/flake-register.md`.
