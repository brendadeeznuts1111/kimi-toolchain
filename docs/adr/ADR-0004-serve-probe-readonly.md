# ADR 0004 — serve-probe Artifact API Is Read-Only

## Status

Accepted — 2026-06-19.

## Context

`kimi-doctor --serve-probe` exposes a lightweight HTTP cache for live dashboard card
probes plus read-only inspection of gate artifacts saved under `.kimi/artifacts/`.

The Herdr dashboard (`:18412`) also lists artifacts via `GET /api/artifacts`, reading
the same directory on disk — it does **not** proxy to serve-probe.

A design question arose: should serve-probe accept
`POST /api/artifacts/:gate/refresh` to execute gates remotely and write new artifacts?

## Decision

The serve-probe artifact API is **read-only**. Gate execution stays CLI-bound.

| Method | Path                           | Behavior                              |
| ------ | ------------------------------ | ------------------------------------- |
| `GET`  | `/api/artifacts`               | List gates with saved artifacts       |
| `GET`  | `/api/artifacts/:gate`         | List artifacts (`?limit=N&since=ISO`) |
| `GET`  | `/api/artifacts/:gate/latest`  | Newest unwrapped payload              |
| `POST` | `/api/artifacts/:gate/refresh` | **403** — read-only API               |

Card freshness is separate: `GET|POST /api/refresh` re-probes dashboard cards only.

## Rationale

1. **Security** — Passive observation endpoints have minimal blast radius. Remote gate
   execution turns the server into an active executor, especially risky if the bind
   address ever moves beyond loopback.
2. **Explicit action** — Gate artifacts are saved only when `--save-artifact` is passed
   on the CLI. Remote refresh would violate that opt-in contract.
3. **Consistency** — Card refresh already has `/api/refresh`; gate runs belong at the
   CLI boundary:

   ```bash
   kimi-doctor --gate <name> --save-artifact   # resolves dependsOn closure
   kimi-doctor --run-gates --save-artifact     # all built-in gates
   ```

## Consequences

- Clients poll `GET /api/artifacts/:gate` for saved runs; list entries include `size` and
  `resultSize` from envelope JSON (no `stat()`).
- Operators who need fresh gate output run the CLI explicitly.
- `POST /api/artifacts/:gate/refresh` returns 403 with CLI hint and ADR link.

## Extension Point (Not Implemented)

Future opt-in gate refresh may be added behind:

- CLI flag: `--allow-gate-refresh`
- Env var: `ALLOW_GATE_REFRESH=true`
- Token-based auth for refresh endpoints

Until then, no gate execution endpoint is exposed.

## References

- Authoritative API doc: [serve-probe.md](../references/serve-probe.md)
- Implementation: `src/lib/card-probe-server.ts`, `src/lib/artifact-store.ts`
- Herdr dashboard (disk-backed artifacts tab): `src/lib/herdr-dashboard/data/data.ts`
- Tests: `test/card-probe-server.unit.test.ts`, `test/artifact-store.unit.test.ts`
