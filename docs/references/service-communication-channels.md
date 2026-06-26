# Service communication channels

Manifest id: `service-communication-channels` · repo: `docs/references/service-communication-channels.md` · runtime: `~/.kimi-code/docs/references/service-communication-channels.md`

Reference for how `kimi-toolchain` services, agents, and panes communicate and coordinate. `Bun.secrets` is only a credential vault; it is **not** a transport.

## Channels at a glance

| Channel                   | Transport                                  | Durability                         | Key files                                                                                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-process event bus      | Typed pub/sub in memory                    | Process-local                      | [`src/lib/event-bus.ts`](../../src/lib/event-bus.ts), [`src/lib/herdr-dashboard/bus.ts`](../../src/lib/herdr-dashboard/bus.ts)                                                                                                                                                     |
| Herdr IPC                 | Unix socket / `ws+unix://` / JSONL         | Connection-local                   | [`src/lib/herdr-socket-client.ts`](../../src/lib/herdr-socket-client.ts), [`src/lib/herdr-socket-transport.ts`](../../src/lib/herdr-socket-transport.ts), [`src/lib/herdr-pane-service.ts`](../../src/lib/herdr-pane-service.ts)                                                   |
| Orchestrator handoffs     | Herdr IPC + durable JSON report            | Persistent report                  | [`src/lib/herdr-orchestrator-events.ts`](../../src/lib/herdr-orchestrator-events.ts), [`src/lib/herdr-orchestrator.ts`](../../src/lib/herdr-orchestrator.ts), [`src/lib/finish-work-herdr.ts`](../../src/lib/finish-work-herdr.ts)                                                 |
| File-based message queues | Append-only JSONL                          | Persistent                         | [`src/lib/health-channel.ts`](../../src/lib/health-channel.ts), [`src/lib/handoff-log.ts`](../../src/lib/handoff-log.ts), [`src/lib/trace-ledger.ts`](../../src/lib/trace-ledger.ts), [`src/lib/failure-ledger.ts`](../../src/lib/failure-ledger.ts)                               |
| SQLite shared state       | `bun:sqlite` WAL                           | Persistent                         | [`src/lib/dashboard-audit-store.ts`](../../src/lib/dashboard-audit-store.ts), [`src/lib/memory-sessions.ts`](../../src/lib/memory-sessions.ts), [`src/lib/mcp/sse.ts`](../../src/lib/mcp/sse.ts)                                                                                   |
| Dashboard                 | HTTP / SSE / WebSocket (`Bun.serve`)       | In-memory hub + persistent backing | [`src/lib/herdr-dashboard/server/server.ts`](../../src/lib/herdr-dashboard/server/server.ts), [`src/lib/herdr-dashboard/server/hub.ts`](../../src/lib/herdr-dashboard/server/hub.ts), [`src/lib/herdr-dashboard/server/events.ts`](../../src/lib/herdr-dashboard/server/events.ts) |
| Effect service layers     | `Context.Tag` + `Layer` + `Effect.provide` | Process-local                      | [`src/lib/effect/tool-runner-effect.ts`](../../src/lib/effect/tool-runner-effect.ts), [`src/lib/effect/identity-service.ts`](../../src/lib/effect/identity-service.ts), [`src/lib/effect/secrets-service.ts`](../../src/lib/effect/secrets-service.ts)                             |
| MCP bridges               | JSON-RPC over SSE                          | SQLite cache                       | [`src/lib/mcp-config.ts`](../../src/lib/mcp-config.ts), [`src/lib/mcp/sse.ts`](../../src/lib/mcp/sse.ts)                                                                                                                                                                           |

## What `Bun.secrets` does and does not do

`Bun.secrets` stores credentials per service using reverse-domain namespacing, for example:

- `com.herdr.cli/github-token`
- `com.herdr.dashboard/jwt-secret`
- `kimi-toolchain/cloudflare-api-token`

Each service reads its own secret. `Bun.secrets` provides **isolation**, not **communication**. Services do not publish or subscribe through it.

## In-process event bus

[`src/lib/event-bus.ts`](../../src/lib/event-bus.ts) exposes a generic, typed event bus:

```ts
const bus = createEventBus<{ "agent:updated": AgentSnapshot }>();
bus.on("agent:updated", (snapshot) => { ... });
bus.emit("agent:updated", snapshot);
```

The dashboard bus in [`src/lib/herdr-dashboard/bus.ts`](../../src/lib/herdr-dashboard/bus.ts) defines domain events such as `heartbeats:batch`, `agent:updated`, `gate:failed`, and `herdr:event`. This decouples producers like the gate watcher from consumers like the SSE hub.

## Herdr IPC

Herdr is the terminal multiplexer/orchestrator. The toolchain connects to it as both client and event subscriber:

1. **Transport resolution** — [`src/lib/herdr-socket-transport.ts`](../../src/lib/herdr-socket-transport.ts) picks `jsonl`, `websocket`, or `websocket-fallback` (`ws+unix://` falling back to plain JSONL).
2. **Protocol** — [`src/lib/herdr-socket-protocol.ts`](../../src/lib/herdr-socket-protocol.ts) frames JSONL envelopes (`{ event, data }`) and buffers lines.
3. **Subscription** — [`src/lib/herdr-socket-client.ts`](../../src/lib/herdr-socket-client.ts) opens a long-lived `events.subscribe` channel with reconnect/backoff.
4. **Pane/workspace mutation** — [`src/lib/herdr-pane-service.ts`](../../src/lib/herdr-pane-service.ts) and [`src/lib/herdr-workspace-service.ts`](../../src/lib/herdr-workspace-service.ts) wrap Effect-based `herdr` CLI calls to split panes, send text, read output, and wait for state changes.

## Orchestrator handoffs and watch loop

The orchestrator turns Herdr events into agent handoffs:

- [`src/lib/herdr-orchestrator-events.ts`](../../src/lib/herdr-orchestrator-events.ts) — `watchOrchestratorEventsEffect()` listens for `pane.agent_status_changed`, `workspace.updated`, etc., and routes them through `routeOrchestratorEvent()`.
- [`src/lib/herdr-orchestrator.ts`](../../src/lib/herdr-orchestrator.ts) — `reactHerdrOrchestrator()` evaluates cross-pane handoffs, picks the least busy agent, and can spawn remote agents over SSH.
- [`src/lib/herdr-project-context.ts`](../../src/lib/herdr-project-context.ts) — runs configured context commands and delivers the result to a target pane via `herdr agent send`.
- [`src/lib/handoff-log.ts`](../../src/lib/handoff-log.ts) — append-only JSONL audit log with checksums at `~/.herdr/orchestrator/handoff-log.jsonl`.

### Finish-work as a handoff signal

[`src/lib/finish-work-herdr.ts`](../../src/lib/finish-work-herdr.ts) writes `.kimi/finish-work-report.json`. The orchestrator reads this durable report, and [`src/lib/finish-work-context.ts`](../../src/lib/finish-work-context.ts) enriches it into the next agent's context. Probes such as `finish-work:handoff-ready` are evaluated by `evaluateFinishWorkProbeCondition()`.

## File-based durable channels

Several subsystems use append-only JSONL files as queues or audit logs:

| File path                                 | Purpose            | Producer / consumer                                                    |
| ----------------------------------------- | ------------------ | ---------------------------------------------------------------------- |
| `~/.kimi-code/var/health-events.jsonl`    | Health telemetry   | [`src/lib/health-channel.ts`](../../src/lib/health-channel.ts)         |
| `~/.herdr/orchestrator/handoff-log.jsonl` | Handoff audit      | [`src/lib/handoff-log.ts`](../../src/lib/handoff-log.ts)               |
| `~/.kimi-code/var/trace-events.jsonl`     | Trace ledger       | [`src/lib/trace-ledger.ts`](../../src/lib/trace-ledger.ts)             |
| `~/.kimi-code/var/failure-ledger.jsonl`   | Failure ledger     | [`src/lib/failure-ledger.ts`](../../src/lib/failure-ledger.ts)         |
| `.kimi/finish-work-report.json`           | Handoff contract   | [`src/lib/finish-work-herdr.ts`](../../src/lib/finish-work-herdr.ts)   |
| `.kimi/herdr-orchestrator-state.json`     | Orchestrator state | [`src/lib/herdr-orchestrator.ts`](../../src/lib/herdr-orchestrator.ts) |

These channels are polled or streamed; they survive process restarts.

## SQLite shared state

For queryable, durable shared state the codebase uses `bun:sqlite` in WAL mode:

- Dashboard audit store — `~/.kimi-code/var/dashboard-events.db`.
- Sessions / knowledge graph — `~/.kimi-code/var/sessions.db`.
- MCP response cache — `~/.cache/kimi-toolchain/mcp-cache.db`.

See [`src/lib/dashboard-audit-store.ts`](../../src/lib/dashboard-audit-store.ts), [`src/lib/memory-sessions.ts`](../../src/lib/memory-sessions.ts), and [`src/lib/mcp/sse.ts`](../../src/lib/mcp/sse.ts).

## Dashboard HTTP / SSE / WebSocket

The dashboard server in [`src/lib/herdr-dashboard/server/server.ts`](../../src/lib/herdr-dashboard/server/server.ts) uses `Bun.serve`:

- REST endpoints under `/api/*`.
- `/api/agents/live` SSE stream from [`src/lib/herdr-dashboard/server/hub.ts`](../../src/lib/herdr-dashboard/server/hub.ts).
- `/api/ws` WebSocket upgrade for topic subscriptions.
- [`src/lib/herdr-dashboard/server/events.ts`](../../src/lib/herdr-dashboard/server/events.ts) bridges Herdr socket events into the dashboard bus.

The hub keeps an in-memory agent snapshot and broadcasts SSE chunks to all subscribers.

## Effect service layers

Inside a single process, services compose through Effect:

```ts
Effect.provide(program, Layer.merge(IdentityLive, SecretsLive));
```

Key boundaries:

- [`src/lib/effect/tool-runner-effect.ts`](../../src/lib/effect/tool-runner-effect.ts) — subprocess invocation with typed errors.
- [`src/lib/effect/identity-service.ts`](../../src/lib/effect/identity-service.ts) — JWT, sessions, CSRF.
- [`src/lib/effect/secrets-service.ts`](../../src/lib/effect/secrets-service.ts) — secret retrieval Layer.
- [`src/lib/effect/dx-config.ts`](../../src/lib/effect/dx-config.ts) — configuration layer.

## MCP / HTTP-SSE bridges

External tool servers are reached through MCP over SSE:

- [`src/lib/mcp-config.ts`](../../src/lib/mcp-config.ts) — registry, `callMcpTool()`, client loading.
- [`src/lib/mcp/sse.ts`](../../src/lib/mcp/sse.ts) — persistent SSE client with SQLite cache and retries.
- [`src/bin/unified-shell-bridge.ts`](../../src/bin/unified-shell-bridge.ts) — local stdio MCP bridge for shell execution.

## Choosing a channel

| Use case                      | Preferred channel                           |
| ----------------------------- | ------------------------------------------- |
| Same-process decoupling       | Typed event bus                             |
| Pane/agent command and status | Herdr IPC (Unix socket / JSONL / ws+unix)   |
| Cross-pane context handoff    | Herdr IPC + `.kimi/finish-work-report.json` |
| Audit / telemetry             | Append-only JSONL file channel              |
| Queryable shared state        | `bun:sqlite` WAL store                      |
| Human-facing live dashboard   | HTTP / SSE / WebSocket dashboard            |
| Typed service composition     | Effect `Context.Tag` + `Layer`              |
| External tool server          | MCP over SSE                                |

## Related

| Topic                            | Path                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------- |
| Herdr plugin architecture        | [herdr-plugin-architecture.md](./herdr-plugin-architecture.md)               |
| Finish-work close-loop           | [../finish-work-close-loop.md](../finish-work-close-loop.md)                 |
| Herdr socket saturation protocol | [herdr-socket-saturation-protocol.md](./herdr-socket-saturation-protocol.md) |
| Dashboard thumbnails             | [dashboard-thumbnails.md](./dashboard-thumbnails.md)                         |
| Namespace collisions             | [namespace.md](./namespace.md)                                               |
