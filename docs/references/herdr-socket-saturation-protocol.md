# Herdr Socket Saturation Protocol

**Version:** 1.0.0  
**Scope:** `herdr-doctor` EAGAIN remediation, socket transport taxonomy, and operational protocol  
**Target:** macOS / Linux Herdr deployments, especially `nolarose@nolas-Mac-mini`  
**Last updated:** 2026-06-18

## 1. The Error

### 1.1 What EAGAIN (os error 35) means on Herdr

When you run `herdr` and see:

```text
herdr: protocol error: I/O error: Resource temporarily unavailable (os error 35)
```

This is `EAGAIN` / `EWOULDBLOCK` on macOS (Darwin uses error 35; Linux uses error 11). It signals that the Unix domain socket Herdr uses for client-server communication is temporarily saturated — the server is not accepting new connections, or the socket buffer is full. This is distinct from `ECONNREFUSED` (os error 61), which means no server is listening at all.

### 1.2 Herdr-specific root causes

| Cause                     | Symptom                                           | Likely on                                                      |
| ------------------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| Socket saturation         | os error 35 on connect                            | Rapid client attach/detach cycles, stale client holding socket |
| Server stuck in bad state | `herdr status` shows running but new clients fail | Server process alive but event loop blocked                    |
| Stale lock file           | `herdr` fails immediately with protocol error     | Unclean shutdown (force-quit terminal, SIGKILL)                |
| Zombie herdr client       | Multiple `herdr` PIDs, one holding socket         | Client crashed without detaching properly                      |

Herdr's client-server architecture uses a Unix domain socket (or TCP on remote attach) for all communication. The server owns pane and process state; the client is just the TUI. When the socket is saturated, the client cannot attach even though the server may still be running.

**Socket paths (this repo):** primary `~/.config/herdr/herdr.sock`; named sessions `~/.config/herdr/sessions/<name>/herdr.sock`. Client attach uses `herdr-client.sock` alongside the server socket.

## 2. Taxonomy

### 2.1 `error-taxonomy.yml` — Herdr socket categories

Source: `error-taxonomy.yml` (synced to `~/.kimi-code/` after `bun run sync`).

```yaml
- id: herdr_socket_saturation
  name: Herdr socket saturation
  severity: warn
  autoFix: "herdr-doctor fix-socket --dry-run"
  patterns:
    - regex: "herdr: protocol error.*os error 35"
    - regex: "herdr: protocol error.*Resource temporarily unavailable"
    - regex: "Resource temporarily unavailable \\(os error 35\\)"
    - regex: "\\bEAGAIN\\b"

- id: herdr_cli_attach_refused
  name: Herdr client attach refused
  severity: warn
  autoFix: "herdr-doctor fix-socket --dry-run"
  patterns:
    - regex: "herdr: protocol error.*os error 61"
    - regex: "herdr: protocol error.*Connection refused"
```

**OS context:** Darwin EAGAIN = 35; Linux EAGAIN = 11. Classification uses regex on the error string, not platform tables.

### 2.2 Classification rules

- **First match wins.** `classifyFailure()` returns one category per input string.
- **Dedupe by categoryId per input.** `getSuggestions()` deduplicates so one error string never yields multiple remediation paths.
- **Alert-loop caveat:** If you classify `herdr-server` and `herdr-client` log tails separately, you get two ledger entries for the same incident. Batch lines into one blob, or dedupe by `(taxonomyId, pid, hour)` in the consumer (wave C — not shipped).

## 3. Remediation Protocol

### 3.1 The `herdr-doctor` command hierarchy

```text
herdr-doctor doctor              → full diagnostic sweep (no destructive actions)
herdr-doctor fix-socket --dry-run → observe and plan (safe, read-only)
herdr-doctor fix-socket --live   → execute recovery plan (destructive with gates)
```

### 3.2 `--dry-run` (observe)

```bash
herdr-doctor fix-socket --dry-run
herdr-doctor fix-socket --dry-run --error "herdr: protocol error: ... os error 35"
herdr-doctor fix-socket --json --dry-run
```

**What it does:**

1. Picks plan from `--error` (or socket probe; defaults to EAGAIN when inconclusive)
2. Runs `herdr status server`
3. Resolves PIDs via pgrep (cross-platform: `-fl` → `-a -f` → `-af`, plus `bunx herdr` probe)
4. Materializes `kill -TERM <pid>  # <command>` — **no execution**
5. Prints `[dry-run] would run:` / `operator runs:` per step

**PID parser rules:**

- Requires `\bherdr\s+server\b` as tokens
- Accepts: `/usr/local/bin/herdr server`, `herdr --session dev server`, `bunx herdr server`
- Rejects: `run-herdr-daemon.sh server`, `herdr server stop`, bare `herdr` clients

**Snapshot timing:** `pgrepBefore` is captured **before** any stop or kill. Dry-run and live share this pre-stop probe in `runFixSocket()`.

### 3.3 `--live` (execute)

```bash
herdr-doctor fix-socket --live
```

**Execution contract:**

| Phase               | Action                      | Timeout          | Safety gate                                                                                                       |
| ------------------- | --------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1. Graceful stop    | `herdr server stop`         | 10s              | `runCommandWithTimeout` wraps in `Promise.race`; on timeout, SIGTERM/SIGKILLs the **stop CLI child** and proceeds |
| 2. Status re-check  | `herdr status server`       | —                | **Diagnostics only** — recorded in `live.actions`; does **not** gate kill escalation                              |
| 3. PID re-resolve   | pgrep probe sequence        | —                | Only targets PIDs present in **pre-stop snapshot**                                                                |
| 4. Destructive kill | SIGTERM → wait 5s → SIGKILL | 5s (`Bun.sleep`) | PID alive, in pre-stop snapshot, cmdline unchanged, `isHerdrServerCommandLine()` passes                           |
| 5. Final status     | `herdr status server`       | —                | Reports outcome                                                                                                   |

**Total invocation ceiling:** 30s (`Promise.race` at CLI level in `src/bin/herdr-doctor.ts`).

**Respawn protection:** If a supervisor (launchd, systemd, PM2) respawns `herdr server` with a new PID between stop and re-check, the new PID is **not** in the pre-stop snapshot → kill is aborted. This prevents killing a fresh, healthy server.

**Stop subprocess cleanup:** `herdr server stop` is spawned via `Bun.spawn(["herdr", "server", "stop"])` — no shell. On timeout the doctor kills and reaps that CLI child only; it does not fork the long-running server as a grandchild.

### 3.4 Post-stop state matrix

| Post-stop state                | Behavior                        |
| ------------------------------ | ------------------------------- |
| Old PID gone                   | No pgrep match → no kill        |
| Old PID alive, same cmdline    | Kill (intended path)            |
| Old PID alive, cmdline changed | Abort                           |
| New PID (supervisor respawn)   | Abort — won't kill fresh server |

## 4. Transport Layer Backoff

When `herdr-socket-client.ts` detects a saturation error (EAGAIN / os error 35), the **first** reconnect delay is bumped to at least 8 seconds instead of the default 1-second churn. Subsequent attempts use the normal delay ladder.

```typescript
// resolveReconnectDelaysMs() default: [1000, 2000, 4000, 8000, 16000]
if (isSaturationError(reason) && reconnectAttempt === 0) {
  delay = Math.max(delay, 8_000);
}
```

`ECONNREFUSED` and other errors keep the default ladder (1s first delay).

## 5. Operational Runbook

### 5.1 When EAGAIN recurs on the Mac mini

```bash
# Step 1: Always observe first
herdr-doctor fix-socket --dry-run

# Step 2: If dry-run plan looks correct, execute
herdr-doctor fix-socket --live

# Step 3: Verify
herdr status
```

**Ground-truth gate:** Do not automate (waves B/C) until `--live` succeeds on a real EAGAIN recurrence.

### 5.2 Manual fallback (if doctor is unavailable)

```bash
# Check for zombie processes
ps aux | grep herdr
pgrep -fl 'herdr server'

# Graceful stop
herdr server stop

# If stuck, targeted kill (never blind pkill)
kill -TERM $(pgrep -f 'herdr server')
sleep 5
kill -9 $(pgrep -f 'herdr server')  # only if still alive

# Clear stale sockets only after confirming nothing is listening
rm -f ~/.config/herdr/herdr.sock ~/.config/herdr/herdr-client.sock
# Named session: ~/.config/herdr/sessions/<name>/herdr.sock

# Restart
herdr
```

### 5.3 Log sinks for debugging

```bash
# Server-side logs
kimi-debug logs --id herdr-server --tail 40

# Client-side logs
kimi-debug logs --id herdr-client --tail 40

# Classify an error string
kimi-debug classify "herdr: protocol error: I/O error: Resource temporarily unavailable (os error 35)"
```

## 6. Protocol References

| Topic                | Link                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------- |
| Herdr Socket API     | [herdr.dev/docs/socket-api](https://herdr.dev/docs/socket-api)                           |
| Herdr Session State  | [herdr.dev/docs/session-state](https://herdr.dev/docs/session-state)                     |
| Herdr Concepts       | [herdr.dev/docs/concepts](https://herdr.dev/docs/concepts)                               |
| Parallel EAGAIN case | [vercel-labs/agent-browser#322](https://github.com/vercel-labs/agent-browser/issues/322) |

## 7. Implementation Status

| Component                                             | Status  | Tests                                                |
| ----------------------------------------------------- | ------- | ---------------------------------------------------- |
| `error-taxonomy.yml` — `herdr_socket_saturation`      | Shipped | os 35 vs 61 separation                               |
| `error-taxonomy.yml` — `herdr_cli_attach_refused`     | Shipped | os 61 pattern                                        |
| `herdr-doctor.ts` — EAGAIN hint                       | Shipped | `HERDR_SOCKET_SATURATION_TAXONOMY_ID`                |
| `herdr-cli-error.ts` — `parseHerdrCliProtocolError()` | Shipped | parser + pgrep fixtures                              |
| `herdr-socket-transport.ts` — connect error codes     | Shipped | `parseSocketConnectErrorCode()`                      |
| `herdr-socket-client.ts` — saturation backoff         | Shipped | 8s min first reconnect                               |
| `paths.ts` — log sinks                                | Shipped | `herdr-server`, `herdr-client`                       |
| `fix-socket --dry-run`                                | Shipped | macOS/Linux pgrep, PID materialization               |
| `fix-socket --live`                                   | Shipped | hang→timeout, alive→kill, gone→safe, mismatch→abort  |
| `fix-socket --live` — respawn protection              | Shipped | new PID abort test                                   |
| Protocol-related unit suites                          | Green   | 45 tests across 5 files; 6 live escalation scenarios |

**Key source files:** `src/lib/herdr-cli-error.ts`, `src/lib/herdr-fix-socket-live.ts`, `src/lib/herdr-doctor.ts`, `src/bin/herdr-doctor.ts`.

**Orthogonal toolchain gates:** Finish-work `[finishWork].gates` may include `kimi-heal effect audit` and `kimi-heal --fix` for Effect discipline — separate from socket saturation recovery. See [namespace.md](./namespace.md).

## 8. Next Wave (Pending Ground Truth)

Scoped but not implemented until `--live` is validated on a real EAGAIN recurrence:

| Target                    | Description                                                                           | Blocker                                   |
| ------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- |
| B — Live EAGAIN mock      | Fake Unix listener that returns EAGAIN on accept for transport-layer testing          | Needs real EAGAIN trace to calibrate      |
| C — Alert-loop dedupe     | `(taxonomyId, pid, hour)` bucketing for `kimi-debug` logs → classify → alert pipeline | Needs trusted execution path behind it    |
| Supervisor-aware handling | Explicit launchd/systemd/PM2 detection in respawn path                                | Only if respawn abort fires in production |

---

Sync taxonomy and docs to live runtime: `bun run sync && bun run sync:verify`.
