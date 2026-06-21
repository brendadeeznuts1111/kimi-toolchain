# Herdr dashboard templates

The static assets for the **Herdr orchestrator dashboard** live in the parent
`templates/` directory and are served by `src/lib/herdr-dashboard-server.ts`.
The dashboard is a plain HTML/CSS/JS app rendered inside a herdr WebView pane.

| File                      | Responsibility                                                                |
| ------------------------- | ----------------------------------------------------------------------------- |
| `../herdr-dashboard.html` | Page shell, nav buttons, panels, and inline bootstrap for environment config. |
| `../herdr-dashboard.css`  | Theme, layout, responsive grid, and panel-specific components.                |
| `../herdr-dashboard.js`   | Panel registry, data fetching, rendering, polling, and IPC.                   |

The templates are deliberately dependency-free — no build step, no bundler, no
framework. Edit the files directly and refresh the browser/WebView.

## Quick orientation

1. The server generates `GET /` from `herdr-dashboard.html`.
2. `/herdr-dashboard.css` and `/herdr-dashboard.js` are served as static assets.
3. `/api/meta` exposes runtime config (`pollHintMs`, `examplesDashboardUrl`, etc.).
4. `/api/*` routes return JSON consumed by the client.

## Client-side panel registry

`herdr-dashboard.js` owns a declarative `PANELS` registry. Each entry maps a tab
`id` (matching `data-tab="..."` and `id="..."`) to lifecycle hooks.

```js
const PANELS = {
  agents: {
    label: "Agents",
    activate() {
      if (lastAgentsPayload) renderAgents(lastAgentsPayload);
    },
  },
  logs: {
    label: "Logs",
    activate() {
      lastDebugLogsJson = "";
      void refreshDebugLogs();
      scheduleDebugLogsPoll();
    },
    deactivate() {
      if (debugLogsTabTimer) {
        clearInterval(debugLogsTabTimer);
        debugLogsTabTimer = null;
      }
    },
  },
  examples: {
    label: "Examples",
    activate() {
      const frame = document.getElementById("examples-frame");
      if (examplesDashboardUrl && frame && !frame.src.includes(examplesDashboardUrl)) {
        loadExamplesDashboard(examplesDashboardUrl);
      }
    },
  },
};
```

`switchTab` calls `deactivate` on the outgoing panel and `activate` on the
incoming panel. Keep timers, SSE fallback intervals, and heavy rendering inside
these hooks so inactive tabs do not poll the server.

### Adding a new client-side tab

1. **Add the nav button** in `herdr-dashboard.html`:

   ```html
   <button data-tab="tasks" type="button">Tasks</button>
   ```

2. **Add the panel section** in `<main>`:

   ```html
   <section id="tasks" class="panel">
     <h2 class="panel-heading">Tasks</h2>
     <div id="tasks-list" class="tasks-list"></div>
   </section>
   ```

3. **Add styles** in `herdr-dashboard.css` if needed. Prefer existing utility
   classes before writing new rules.

4. **Register the panel** in `herdr-dashboard.js`:

   ```js
   registerPanel("tasks", {
     label: "Tasks",
     activate() {
       lastTasksJson = "";
       void refreshTasks();
     },
     deactivate() {
       if (tasksPollTimer) {
         clearInterval(tasksPollTimer);
         tasksPollTimer = null;
       }
     },
   });
   ```

   `registerPanel(id, panel)` is exported at runtime and is safe to call from
   console scripts or future plugin extensions.

5. **Add the fetch + render functions** near the other panel-specific helpers:

   ```js
   async function refreshTasks() {
     const payload = await apiGet("/api/tasks");
     if (!payload) return;
     const json = JSON.stringify(payload);
     if (json === lastTasksJson) return;
     lastTasksJson = json;
     renderTasks(payload);
   }

   function renderTasks(payload) {
     const el = document.getElementById("tasks-list");
     if (!el) return;
     el.innerHTML = ""; // or build DOM fragments
     for (const task of payload.tasks || []) {
       const row = document.createElement("div");
       row.textContent = task.name;
       el.appendChild(row);
     }
   }
   ```

6. Restart the herdr dashboard server (or the herdr orchestrator that hosts it).

## Server-side extension guide

Most dashboard data flows through three layers:

1. **HTTP route** in `src/lib/herdr-dashboard-server.ts`
2. **Data function** in `src/lib/herdr-dashboard-data.ts`
3. **Type / interface** in `src/lib/herdr-dashboard-data.ts` or `src/lib/herdr-dashboard-contract.ts`

### Add a new API endpoint

1. **Define the payload shape** next to the existing payload types:

   ```ts
   // src/lib/herdr-dashboard-data.ts
   export interface DashboardTasksPayload {
     ok: boolean;
     tasks: Array<{ id: string; name: string; status: string }>;
     fetchedAt: string;
   }
   ```

2. **Implement the data function**:

   ```ts
   export function fetchDashboardTasks(projectPath: string): DashboardTasksPayload {
     return {
       ok: true,
       tasks: [], // populate from project state
       fetchedAt: new Date().toISOString(),
     };
   }
   ```

3. **Wire the route** in `src/lib/herdr-dashboard-server.ts` inside the
   `Bun.serve` `fetch` handler. Keep routes alphabetically grouped with the
   existing `/api/*` blocks:

   ```ts
   if (path === "/api/tasks") {
     return jsonResponse(fetchDashboardTasks(options.projectPath));
   }
   ```

4. **Consume the endpoint** from the client panel registry as shown above.

5. Run `bun run typecheck` and `bun run format` before committing.

## Existing API routes (reference)

| Route                              | Purpose                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/meta`                    | Runtime config, discovery context, and WebView metadata.                                                                                     |
| `GET /api/agents`                  | Current agent snapshot.                                                                                                                      |
| `GET /api/agents/live`             | SSE live stream of agent updates.                                                                                                            |
| `GET /api/health`                  | Lightweight subsystem health (agents, SSE, herdr socket, gates, **probe**, discovery). Schema: `schemas/herdr-dashboard-health.schema.json`. |
| `GET /api/artifacts`               | Saved gate artifacts (disk) with `latestSize` / `latestResultSize` and serve-probe reachability hint.                                        |
| `GET /api/gates/graph`             | Static gate execution DAG as Mermaid (`?gate=` optional closure filter).                                                                     |
| `GET /api/artifacts/:gate/lineage` | Artifact lineage Mermaid — runtime `metadata.lineage` or declarative `dependsOn` (`?path=` optional).                                        |
| `GET /api/probe/cards`             | Proxy to serve-probe `/api/cards` (live dashboard card snapshot).                                                                            |
| `GET /api/handoffs`                | Handoff history.                                                                                                                             |
| `GET /api/rules`                   | Handoff rules with last-fired metadata.                                                                                                      |
| `GET /api/scan`                    | Upgrade scan findings.                                                                                                                       |
| `GET /api/events`                  | Audit events query.                                                                                                                          |
| `GET /api/canvases`                | Cursor canvas manifest.                                                                                                                      |
| `GET /api/metrics`                 | Runtime metrics.                                                                                                                             |
| `GET /api/debug/logs`              | Curated debug log tail.                                                                                                                      |
| `GET /api/thumbnail`               | Dashboard screenshot thumbnail.                                                                                                              |

## Environment variables

The server reads these variables to configure the dashboard at runtime:

| Variable                       | Default                  | Purpose                                   |
| ------------------------------ | ------------------------ | ----------------------------------------- |
| `HERDR_EXAMPLES_DASHBOARD_URL` | `http://localhost:5678/` | Base URL for the **Examples** tab iframe. |

Other tuning values (`pollHintMs`, `ssePollMs`, `staleMs`, etc.) are passed from
the server caller in `src/lib/herdr-dashboard-server.ts`.

## Lineage tab (Mermaid)

The **Lineage** tab loads Mermaid.js from jsDelivr (`mermaid@11`). When offline,
graphs fall back to raw Mermaid source text in the panel. Gate execution DAG is
static; artifact lineage prefers runtime `metadata.lineage`, then declarative
`dependsOn`.

## Styling conventions

- Use `var(--...)` tokens defined at the top of `herdr-dashboard.css` for colors,
  spacing, and typography.
- Panel sections should use `class="panel"` and an `id` matching the tab name.
- Tables use `class="data-table"`; code/pre blocks use `class="code-block"`.
- Error banners use `class="error"`; loading states use `class="loading"`.
- Status badges use `class="badge badge-{ok,warn,err,info}"`.
- Summary cards use `class="summary-card"`; the client applies `live-ok`, `live-warn`, or `live-error` borders based on `/api/health`.
- The examples iframe uses `class="examples-frame"` with `sandbox="allow-scripts allow-same-origin allow-forms"`.

## Validation checklist

After changing templates or server routes:

1. `bun run typecheck` — TypeScript compiles.
2. `bun run format` — oxfmt passes.
3. `bun build templates/herdr-dashboard.js --target browser --outfile /tmp/herdr-bundle.js` — JS parses cleanly.
4. Start the herdr orchestrator (or `bun run herdr` in the target project) and open the dashboard.
5. Switch to the new tab, verify data loads, and confirm no errors in the WebView console.
6. Switch away and back to confirm `activate` / `deactivate` hooks behave correctly.

## Related files

- `src/lib/herdr-dashboard-server.ts` — Bun HTTP server and route table
- `src/lib/herdr-dashboard-data.ts` — data-fetch functions
- `src/lib/herdr-dashboard-contract.ts` — shared interfaces
- `src/lib/herdr-dashboard-hub.ts` — agent heartbeats and SSE live stream
- `examples/dashboard/src/index.ts` — separate examples dashboard (embedded in the Examples tab)
