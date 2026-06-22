/** Identity lane — pipeline, metrics, cookies, WebSocket, JWT + CSRF. */
import { fetchJson, card } from "/dashboard-core.js";

const creds = { credentials: "include" };

async function fetchJsonCreds(url) {
  const res = await fetch(url, creds);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function badge(status) {
  const map = { ok: "badge-ok", warn: "badge-warn", error: "badge-err", skip: "badge-info" };
  return map[status] ?? "badge-info";
}

function stepRows(steps) {
  return steps
    .map(
      (s) =>
        `<tr><td><code>${s.id}</code></td><td>${s.label}</td><td><span class="badge ${badge(s.status)}">${s.status}</span></td></tr>`
    )
    .join("");
}

async function ensureCookieSession(theme = "dark") {
  const profile = await fetch("/api/cookie/profile", creds);
  const body = await profile.json();
  if (body.authenticated) return body;
  const login = await fetch(`/api/cookie/login?theme=${theme}`, { method: "POST", ...creds });
  return login.json();
}

// Identity pipeline — single orchestrated probe
async function renderIdentityFlow() {
  try {
    await ensureCookieSession();
    const flow = await fetchJsonCreds("/api/identity/flow");
    let h = `<p style="font-size:11px;color:var(--muted)">cookie → JWT (sub/sid) → CSRF (session-bound)</p>`;
    h += `<div class="row"><span>authenticated</span><span class="badge ${flow.authenticated ? "badge-ok" : "badge-warn"}">${flow.authenticated}</span></div>`;
    if (flow.context?.userId) {
      h += `<div class="row"><span>userId</span><code style="font-size:10px">${flow.context.userId.slice(0, 12)}…</code></div>`;
    }
    h += `<table class="tbl" style="margin-top:8px"><tr><th>Step</th><th>Label</th><th>Status</th></tr>${stepRows(flow.steps ?? [])}</table>`;
    h += `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">`;
    h += `<button type="button" data-identity-login style="font-size:11px;padding:4px 8px;cursor:pointer">Login</button>`;
    h += `<button type="button" data-identity-logout style="font-size:11px;padding:4px 8px;cursor:pointer">Logout</button>`;
    h += `<button type="button" data-identity-refresh style="font-size:11px;padding:4px 8px;cursor:pointer">Refresh</button>`;
    h += `</div>`;
    h += `<p class="status ${flow.ok ? "ok" : "warn"}" style="margin-top:6px;font-size:11px">${flow.note ?? ""}</p>`;
    card("card-identity-flow", h);

    const root = document.getElementById("card-identity-flow");
    root?.querySelector("[data-identity-login]")?.addEventListener("click", async () => {
      await fetch("/api/cookie/login?theme=dark", { method: "POST", ...creds });
      await renderIdentityFlow();
    });
    root?.querySelector("[data-identity-logout]")?.addEventListener("click", async () => {
      await fetch("/api/cookie/logout", { method: "POST", ...creds });
      await renderIdentityFlow();
    });
    root
      ?.querySelector("[data-identity-refresh]")
      ?.addEventListener("click", () => renderIdentityFlow());
  } catch (e) {
    card("card-identity-flow", `<p class="status err">${e.message}</p>`);
  }
}

renderIdentityFlow();

// Bun.serve metrics
(async () => {
  try {
    const d = await fetchJson("/api/serve-metrics");
    const m = d.metrics ?? d;
    let h = `<div class="row"><span>pendingRequests</span><span class="badge badge-info">${m.pendingRequests}</span></div>`;
    h += `<div class="row"><span>pendingWebSockets</span><span class="badge badge-info">${m.pendingWebSockets}</span></div>`;
    if (m.subscribers) {
      h += `<table class="tbl"><tr><th>Topic</th><th>Subscribers</th></tr>`;
      for (const [topic, count] of Object.entries(m.subscribers)) {
        h += `<tr><td><code>${topic}</code></td><td>${count}</td></tr>`;
      }
      h += `</table>`;
    }
    h += `<p class="status ok" style="margin-top:6px;font-size:11px">${d.note ?? ""}</p>`;
    card("card-serve-metrics", h);
  } catch (e) {
    card("card-serve-metrics", `<p class="status err">${e.message}</p>`);
  }
})();

// CookieMap session
(async () => {
  try {
    const info = await fetchJson("/api/cookies");
    const profileBody = await ensureCookieSession();

    let h = `<p style="font-size:11px;color:var(--muted)"><code>index.ts routes</code> — auto Set-Cookie</p>`;
    h += `<div class="row"><span>Authenticated</span><span class="badge ${(profileBody.authenticated ?? profileBody.ok) ? "badge-ok" : "badge-warn"}">${Boolean(profileBody.userId)}</span></div>`;
    h += `<div class="row"><span>userId</span><code style="font-size:10px">${profileBody.userId ?? "—"}</code></div>`;
    h += `<div class="row"><span>theme</span><span class="badge badge-info">${profileBody.theme ?? "dark"}</span></div>`;
    h += `<details style="margin-top:8px"><summary style="cursor:pointer;font-size:11px;color:var(--blue)">Cookie names</summary><pre style="font-size:10px">${JSON.stringify(info.names, null, 2)}</pre></details>`;
    card("card-cookies", h);
  } catch (e) {
    card("card-cookies", `<p class="status err">${e.message}</p>`);
  }
})();

// WebSocket topics
(async () => {
  try {
    const d = await fetchJson("/api/ws");
    let h = `<div class="row"><span>pendingWebSockets</span><span class="badge badge-info">${d.pendingWebSockets}</span></div>`;
    h += `<table class="tbl"><tr><th>Topic</th><th>Subscribers</th></tr>`;
    for (const [topic, count] of Object.entries(d.subscribers ?? {})) {
      h += `<tr><td><code>${topic}</code></td><td>${count}</td></tr>`;
    }
    h += `</table>`;
    h += `<p style="font-size:11px;color:var(--muted);margin-top:6px">${d.upgrade}</p>`;

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/ws?topic=dashboard`);
    ws.addEventListener("open", async () => {
      await new Promise((r) => setTimeout(r, 80));
      const snap = await fetchJson("/api/ws");
      const bump = snap.subscribers?.dashboard ?? 0;
      h += `<p class="status ok" style="margin-top:4px;font-size:11px">Live WS — dashboard subscribers: ${bump}</p>`;
      card("card-serve-ws", h);
      ws.close();
    });
    ws.addEventListener("error", () => {
      card(
        "card-serve-ws",
        h + `<p class="status warn" style="font-size:11px">WebSocket probe skipped</p>`
      );
    });
    card(
      "card-serve-ws",
      h + `<p class="status ok" style="font-size:11px">Connecting probe WebSocket…</p>`
    );
  } catch (e) {
    card("card-serve-ws", `<p class="status err">${e.message}</p>`);
  }
})();

// JWT
(async () => {
  try {
    await ensureCookieSession();
    const signRes = await fetch("/api/token/jwt/sign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...creds,
      body: JSON.stringify({ expiresIn: 120_000 }),
    });
    const signed = await signRes.json();
    const verifyRes = await fetch("/api/token/jwt/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...creds,
      body: JSON.stringify({ token: signed.token }),
    });
    const verified = await verifyRes.json();

    let h = `<div class="row"><span>sessionSource</span><span class="badge badge-info">${signed.sessionSource ?? "—"}</span></div>`;
    h += `<div class="row"><span>sub</span><code style="font-size:10px">${signed.payload?.sub ?? "—"}</code></div>`;
    h += `<div class="row"><span>sid aligned</span><span class="badge ${verified.sessionAligned !== false ? "badge-ok" : "badge-err"}">${verified.sessionAligned ?? "—"}</span></div>`;
    h += `<div class="row"><span>valid</span><span class="badge ${verified.valid ? "badge-ok" : "badge-err"}">${verified.valid}</span></div>`;
    card("card-token-jwt", h);
  } catch (e) {
    card("card-token-jwt", `<p class="status err">${e.message}</p>`);
  }
})();

// CSRF
(async () => {
  try {
    await ensureCookieSession();
    const rotateRes = await fetch("/api/token/csrf/rotate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...creds,
      body: JSON.stringify({}),
    });
    const rotated = await rotateRes.json();
    const verifyRes = await fetch("/api/token/csrf/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...creds,
      body: JSON.stringify({ token: rotated.token }),
    });
    const verified = await verifyRes.json();

    let h = `<div class="row"><span>sessionSource</span><span class="badge badge-info">${rotated.sessionSource ?? "—"}</span></div>`;
    h += `<div class="row"><span>selfVerified</span><span class="badge ${rotated.selfVerified ? "badge-ok" : "badge-err"}">${rotated.selfVerified}</span></div>`;
    h += `<div class="row"><span>verify</span><span class="badge ${verified.valid ? "badge-ok" : "badge-err"}">${verified.valid}</span></div>`;
    card("card-token-csrf", h);
  } catch (e) {
    card("card-token-csrf", `<p class="status err">${e.message}</p>`);
  }
})();
