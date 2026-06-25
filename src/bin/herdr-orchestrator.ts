#!/usr/bin/env bun
import { writeStdout, writeStdoutLine } from "../lib/cli-contract.ts";
import { pathExists, readText } from "../lib/bun-io.ts";
import { handoffInheritedSpawn } from "../lib/execve-handoff.ts";
import { withNoOrphansEnv } from "../lib/bun-spawn-env.ts";
import { withBunNoOrphans } from "../lib/tool-runner.ts";
import { TOML } from "bun";
import { discoverHerdrProjectConfig } from "../lib/herdr-project-config.ts";
import { syncAgentsTabContext } from "../lib/herdr-project-context.ts";
import {
  evaluateCrossWorkspaceHandoffs,
  getRestoreReadiness,
  listWorkspaceAgents,
  parseIntegrationStatus,
  reactHerdrOrchestrator,
  orchestratorStatus,
  readState,
  discoverRemoteSessions,
  discoverRemoteWorkspaceAgents,
  parseHostSession,
  sshExec,
  buildSshArgs,
  friendlySshError,
  type HostQualifiedSession,
  type AgentSnapshot,
  type OrchestratorState,
  type RestoreStatus,
} from "../lib/herdr-orchestrator.ts";
import { notifyWebhook } from "../lib/herdr-orchestrator-remote.ts";
import { homeDir } from "../lib/paths.ts";
import {
  FINISH_WORK_REPORT_PREFIX,
  PANE_PREFIX,
  PANE_WHEN_FIELDS,
} from "../lib/condition-evaluator.ts";
import {
  resolveOrchestratorConfig,
  normalizeRemoteHostConfig,
  validateRemoteHostConfig,
  readHerdrAppConfig,
  isLegacyGlobalLeastBusyTarget,
  resolveTargetStrategy,
  type RemoteHostConfig,
  type ResolvedRemoteHost,
} from "../lib/herdr-orchestrator-config.ts";
import {
  entryMatchesHandoffQuery,
  getHandoffHistory,
  getHandoffLogPath,
  queryHandoffHistory,
  recordHandoffRuleEvaluation,
  verifyHandoffLog,
  type HandoffHistoryQuery,
  type HandoffLogEntry,
} from "../lib/handoff-log.ts";
import { Effect } from "effect";
import { mergedHerdrConfigLayer } from "../lib/herdr-merged-config.ts";
import { watchOrchestratorEventsEffect } from "../lib/herdr-orchestrator-events.ts";
import { getDashboardAgents } from "../lib/herdr-dashboard/agents.ts";
import { BUN_WEBVIEW_DOCS_URL } from "../lib/webview-console.ts";
import {
  findAllWorkspacesForProject,
  findWorkspaceForProject,
  resolveHerdrProjectPath,
  herdrCliJson,
  herdrCliRun,
} from "../lib/herdr-project-runner.ts";
import {
  escalateFinishWorkToReviewer,
  normalizeFinishWorkReport,
} from "../lib/finish-work-herdr.ts";
import { join } from "path";
import { isDirectRun } from "../lib/bun-utils.ts";
import { buildBanner } from "../lib/build-info.ts";

function parseArgs(argv: string[]) {
  const args = [...argv];
  const consumeValueFlag = (name: string): string => {
    const equalsIdx = args.findIndex((arg) => arg.startsWith(`${name}=`));
    if (equalsIdx >= 0) {
      const value = args[equalsIdx]!.slice(name.length + 1);
      args.splice(equalsIdx, 1);
      return value;
    }
    const idx = args.indexOf(name);
    if (idx < 0) return "";
    const value = args[idx + 1] || "";
    args.splice(idx, 2);
    return value;
  };

  const workspaceIdx = args.indexOf("--workspace");
  const workspace = workspaceIdx >= 0 ? args[workspaceIdx + 1] || "" : "";
  if (workspaceIdx >= 0) args.splice(workspaceIdx, 2);

  const hostIdx = args.indexOf("--host");
  const host = hostIdx >= 0 ? args[hostIdx + 1] || "" : "";
  if (hostIdx >= 0) args.splice(hostIdx, 2);

  const sessionIdx = args.indexOf("--session");
  const agentSession = sessionIdx >= 0 ? args[sessionIdx + 1] || "" : "";
  if (sessionIdx >= 0) args.splice(sessionIdx, 2);

  const portRaw = consumeValueFlag("--port");
  const portValue = Number(portRaw || 18412);

  const nonFlagArgs = args.filter((a) => !a.startsWith("-"));
  const command = nonFlagArgs[0] || "react";
  const second = nonFlagArgs[1] || "";
  const third = nonFlagArgs[2] || "";

  // Detect agent subcommand: "agent start|stop|attach <target>"
  let agentSubcommand = "";
  let agentTarget = "";
  if (command === "agent" && second) {
    agentSubcommand = second;
    agentTarget = third; // may be empty
  }

  return {
    json: args.includes("--json"),
    forceContext: args.includes("--force-context"),
    forceHandoff: args.includes("--force-handoff"),
    all: args.includes("--all"),
    dryRun: args.includes("--dry-run"),
    sessions: args.includes("--sessions"),
    help: args.includes("--help") || args.includes("-h"),
    version: args.includes("--version"),
    verbose: args.includes("--verbose") || args.includes("-v"),
    includeDoctor: args.includes("--include-doctor"),
    versions: args.includes("--versions"),
    domain: (() => {
      const idx = args.indexOf("--domain");
      return idx >= 0 ? args[idx + 1] || "" : "";
    })(),
    takeover: args.includes("--takeover"),
    daemon: args.includes("--daemon"),
    watch: args.includes("--watch"),
    dashboardServe: args.includes("--serve"),
    dashboardWebview: args.includes("--webview"),
    dashboardBackend: (() => {
      const idx = args.indexOf("--backend");
      const value = idx >= 0 ? args[idx + 1] : "";
      if (value === "webkit") return "webkit" as const;
      if (value === "chrome") return "chrome" as const;
      return undefined;
    })(),
    dashboardScreenshot: (() => {
      const idx = args.indexOf("--screenshot");
      return idx >= 0 ? args[idx + 1] || "" : "";
    })(),
    dashboardThumbnail: (() => {
      const idx = args.indexOf("--thumbnail");
      return idx >= 0 ? args[idx + 1] || "" : "";
    })(),
    dashboardPersistProfile: args.includes("--persist-profile") || args.includes("--persist"),
    dashboardProfileDir: (() => {
      const idx = args.indexOf("--profile-dir");
      return idx >= 0 ? args[idx + 1] || "" : "";
    })(),
    dashboardProbe: args.includes("--probe"),
    dashboardHttp3: args.includes("--http3"),
    port: Number.isInteger(portValue) && portValue > 0 ? portValue : 18412,
    workspace: workspace || undefined,
    host: host || undefined,
    agentSession: agentSession || undefined,
    agentSubcommand,
    agentTarget,
    command,
    path: second && command !== "agent" ? second : process.cwd(),
  };
}

async function writeOut(line = ""): Promise<void> {
  await writeStdoutLine(line);
}

async function writeJson(value: unknown): Promise<void> {
  await writeOut(JSON.stringify(value, null, 2));
}

function resolveOrchestratorPluginRoot(): string | null {
  const result = herdrCliJson("", ["plugin", "list", "--json"]);
  if (!result.ok || !result.json) return null;
  const plugins = ((
    result.json as { result?: { plugins?: Array<{ plugin_id?: string; plugin_root?: string }> } }
  )?.result?.plugins || []) as Array<{ plugin_id?: string; plugin_root?: string }>;
  const plugin = plugins.find((p) => p.plugin_id === "herdr-orchestrator");
  return plugin?.plugin_root || null;
}

async function printHelp() {
  const webviewDocs = BUN_WEBVIEW_DOCS_URL;
  await writeOut(`herdr-orchestrator <command> [path] [flags]

Commands:
  react          React to agent state transitions (context sync, handoff, reviewer)
  bootstrap      Install/enable/start the herdr-orchestrator plugin on a remote host
  status         Show orchestrator config and live agent snapshot
  workspaces     List all discovered workspaces and their agents
  sessions       List all Herdr sessions with workspace and agent counts
  check-hosts    Ping all configured remote hosts and report Herdr version + channel
  check-sessions Validate session references in handoff rules
  history        Tail/filter handoff audit log [--limit 20] [--workspace wB] [--agent kimi] [--follow] [--verify] [--json]
  dashboard      Unified view of all agents across all workspaces
                 Use --serve for http://127.0.0.1:18412 API + HTML UI
                 Use --webview for Bun.WebView shell (--serve implied; experimental API)
                 WebView dataStore defaults to ephemeral (Bun docs) — no disk profile unless
                 you pass --persist-profile or --profile-dir
  readiness      Check agent integration versions for native session restore
  agent          Manage agents: start, stop, or attach remotely (herdr-orchestrator agent <subcommand> --help)
  context-sync   Force agentsTab context delivery now
  escalate       Escalate pending finish-work report to reviewer tab
  config show    Show resolved remote SSH config; use --json for machine output
  config herdr   Display ~/.config/herdr/config.toml settings
  config reload  Trigger herdr server reload-config on all configured remote hosts
  watch-events   Subscribe to Herdr events and react (context-sync / handoff)
                 HERDR_SOCKET_TRANSPORT=jsonl|websocket|auto (default jsonl)
                 jsonl: Bun.connect JSONL; websocket: ws+unix; auto: try ws then jsonl

Flags:
  --version           Print build banner and exit
  --json              JSON output
  --force-context     Run context sync even without idle transition
  --force-handoff     Send handoff even without idle transition
  --workspace <id>    Target a specific workspace (react / status / dashboard)
  --all               Run react across all discovered workspaces (overridden by --workspace)
  --sessions          Show agents across all sessions in dashboard
  --verbose, -v       Show detection source + restore columns in dashboard
  --serve             Start dashboard HTTP server (default port 18412, override with --port)
  --http3             Enable HTTP/3 (QUIC) when TLS certs are configured
                      Set HERDR_DASHBOARD_TLS_CERT + HERDR_DASHBOARD_TLS_KEY, or HERDR_DASHBOARD_HTTP3=1
  --webview           Open Bun.WebView dashboard (implies --serve; experimental — ${webviewDocs})
  --backend <b>       WebView backend: webkit (macOS default) or chrome
  --screenshot <path> Headless WebView PNG capture (implies --serve)
  --thumbnail <path>  WebP thumbnail via Bun.Image (with --screenshot)
  --probe             With --screenshot: also click first Attach button
  --persist-profile   Persist cookies/localStorage to ~/.kimi-code/var/herdr-orchestrator-dashboard-webview
  --persist           Alias for --persist-profile
                      (Bun dataStore directory; not your Chrome/Safari user profile)
                      WebKit persistence requires macOS 15.2+; otherwise falls back to ephemeral
  --profile-dir <p>   Persistent dataStore directory (overrides --persist-profile default;
                      also honored via HERDR_DASHBOARD_WEBVIEW_STORE)
  --port <n>          Dashboard server port (default 18412)

Dashboard timing (dx.config.toml [herdr.orchestrator.dashboard]):
  stale_ms            Heartbeat stale overlay threshold (default 15000)
  sse_poll_ms         Server SSE agent-discovery poll interval (default 5000; falls back to poll_hint_ms)
  poll_hint_ms        Browser handoffs/rules poll interval (default 5000)
  (events.enabled)    When true, dashboard --serve bridges Herdr socket → agent refresh

WebView storage (${webviewDocs}#persistent-storage):
  Default (no flags)  dataStore: ephemeral — in-memory; discarded when WebView closes
  --persist-profile   dataStore: { directory: ~/.kimi-code/var/herdr-orchestrator-dashboard-webview }
  --profile-dir <p>   dataStore: { directory: <p> }
  Legacy directory    ~/.kimi-code/var/herdr-dashboard-webview (pre-rename; not auto-migrated)

Bun.WebView constructor (${webviewDocs}#new-bun-webview-options):
  width/height        Viewport in CSS pixels (defaults 1280×800 in dashboard shell)
  url                 Eager navigation — equivalent to navigate() on next line
  backend             webkit (macOS default) or chrome
  dataStore           ephemeral (default) or { directory } — see storage section below
  console             globalThis.console mirror or custom IPC handler

Bun.WebView capabilities (${webviewDocs}):
  • Real OS-level input (isTrusted: true) — indistinguishable from human clicks
  • click / scrollTo auto-wait for actionability (attached, visible, stable, unobscured)
  • scrollTo(selector) scrolls ancestor containers until the element is visible
  • One browser subprocess per Bun process; new WebView() opens tabs in the same instance
  • Chrome CDP events use the method name as event type (e.g. Network.responseReceived)
  • Experimental API — see ${webviewDocs}
`);
}

if (isDirectRun(import.meta.path)) {
  const {
    json,
    forceContext,
    forceHandoff,
    all,
    dryRun,
    sessions: showSessions,
    verbose,
    help,
    version,
    takeover,
    includeDoctor,
    versions,
    domain,
    daemon: showDaemon,
    watch: dashboardWatch,
    dashboardServe,
    dashboardWebview,
    dashboardBackend,
    dashboardScreenshot,
    dashboardThumbnail,
    dashboardPersistProfile,
    dashboardProfileDir,
    dashboardProbe,
    dashboardHttp3,
    port: dashboardPort,
    workspace,
    host: cliHost,
    agentSession,
    agentSubcommand,
    agentTarget,
    command,
    path: rawPath,
  } = parseArgs(Bun.argv.slice(2));

  if (version) {
    await writeStdoutLine(buildBanner);
    process.exit(0);
  }

  if (help) {
    await printHelp();
    process.exit(0);
  }

  try {
    // agent-info uses the second positional as a target name, not a path
    const projectPath =
      command === "agent-info" && rawPath !== process.cwd()
        ? resolveHerdrProjectPath(process.cwd())
        : resolveHerdrProjectPath(rawPath);

    if (command === "status") {
      const status = await orchestratorStatus(projectPath, { workspaceId: workspace });
      if (!status) {
        if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
        else await writeOut("No [herdr] profile");
        process.exit(1);
      }

      // Include doctor agents from server manifests if requested
      let doctorAgents: Array<{ agent: string; paneId: string; status: string }> = [];
      if (includeDoctor) {
        // Server-level query — session routing not needed
        const manifestsResult = herdrCliJson("", ["server", "agent-manifests", "--json"]);
        if (manifestsResult.ok) {
          const manifests =
            (
              manifestsResult.json as {
                manifests?: Array<{ name?: string; source?: string; state?: string }>;
              }
            )?.manifests || [];
          const doctorNames = new Set(
            manifests.filter((m) => m.name && m.source?.startsWith("herdr:")).map((m) => m.name!)
          );
          // Check which are not already in status.agents
          const existingNames = new Set(status.agents.map((a) => a.agent));
          for (const name of doctorNames) {
            if (!existingNames.has(name)) {
              doctorAgents.push({ agent: name, paneId: "manifest", status: "unknown" });
            }
          }
        }
      }

      if (json) {
        const payload: Record<string, unknown> = { ok: true, projectPath };
        for (const [k, v] of Object.entries(status)) payload[k] = v;
        if (includeDoctor) payload.doctorAgents = doctorAgents;
        await writeJson(payload);
      } else {
        await writeOut(`Orchestrator: ${status.config.enabled ? "enabled" : "disabled"}`);
        if (status.workspaceId) await writeOut(`Workspace: ${status.workspaceId}`);
        await writeOut(
          `Handoff: ${status.config.handoffFrom || "-"} → ${status.config.handoffTo || "-"}`
        );
        await writeOut(`Context on idle: ${status.config.contextOnIdle}`);
        await writeOut(
          `Events: ${status.config.events.enabled ? "enabled" : "disabled"} (debounce ${status.config.events.debounceMs}ms)`
        );
        for (const agent of status.agents) {
          await writeOut(`- ${agent.agent} (${agent.paneId}): ${agent.status}`);
        }
        if (includeDoctor && doctorAgents.length > 0) {
          await writeOut("── Doctor agents (from manifests) ──");
          for (const agent of doctorAgents) {
            await writeOut(`- ${agent.agent} (${agent.paneId}): ${agent.status}`);
          }
        }

        // Daemon status
        if (showDaemon) {
          const projCfg = discoverHerdrProjectConfig(projectPath);
          if (projCfg?.enabled) {
            const fullCfg = { ...projCfg, projectPath };
            const doc = (() => {
              if (!projCfg.sourcePath) return null;
              try {
                return TOML.parse(readText(projCfg.sourcePath)) as Record<string, unknown>;
              } catch {
                return null;
              }
            })();
            const orchCfg = resolveOrchestratorConfig(fullCfg, doc);
            await writeOut("");
            await writeOut("── Daemon config ──");
            await writeOut(`Remote hosts: ${Object.keys(orchCfg.remoteHosts).length}`);
            await writeOut(`Domains: ${Object.keys(orchCfg.domains).join(", ") || "none"}`);
            await writeOut(
              `Notifications: ${orchCfg.notifications.webhookUrl ? `webhook → ${orchCfg.notifications.webhookUrl.split("/").slice(0, -1).join("/")}/...` : "none"}`
            );
            await writeOut(`Handoff rules: ${orchCfg.handoffRules.length} global`);
            for (const [dname, d] of Object.entries(orchCfg.domains)) {
              const dRules = d.handoffRules?.length || 0;
              await writeOut(
                `  ${dname}: ${d.hosts.length} hosts, ${dRules} rules, ${d.notifications?.webhookUrl ? "notify ✓" : "notify ✗"}`
              );
            }
            const historyEntries = await getHandoffHistory(5);
            if (historyEntries.length > 0) {
              await writeOut(`Recent handoffs: ${historyEntries.length}`);
              for (const e of historyEntries.slice(0, 3)) {
                await writeOut(
                  `  ${e.ok ? "✓" : "✗"} ${e.action} ${e.fromAgent || "-"} → ${e.toAgent || "-"}`
                );
              }
            }
          }
        }
      }
      process.exit(0);
    }

    if (command === "workspaces") {
      const config = discoverHerdrProjectConfig(projectPath);
      if (!config?.enabled) {
        if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
        process.exit(1);
      }
      const full = { ...config, projectPath };
      const discovered = findAllWorkspacesForProject(full);
      const ids = workspace ? [workspace] : discovered.workspaceIds;
      const session = config.session;

      if (json) {
        const workspaces: Array<{
          workspaceId: string;
          agentCount: number;
          agents: Array<{ agent: string; paneId: string; status: string }>;
        }> = [];
        const cliErrors = [...discovered.errors];
        for (const id of ids) {
          const listed = listWorkspaceAgents(id, session);
          if (!listed.ok) {
            if (listed.error) cliErrors.push(listed.error);
            continue;
          }
          workspaces.push({
            workspaceId: id,
            agentCount: listed.agents.length,
            agents: listed.agents.map((a) => ({
              agent: a.agent,
              paneId: a.paneId,
              status: a.status,
            })),
          });
        }
        const error = cliErrors.length > 0 ? cliErrors.join("; ") : undefined;
        const ok = cliErrors.length === 0 || workspaces.length > 0;
        await writeJson({ ok, projectPath, workspaces, ...(error ? { error } : {}) });
        process.exit(ok ? 0 : 1);
      } else {
        for (const id of ids) {
          const listed = listWorkspaceAgents(id, session);
          const names = listed.agents.map((a) => `${a.agent}:${a.status}`).join(", ");
          await writeOut(`${id}  ${listed.agents.length} agent(s)${names ? ` — ${names}` : ""}`);
        }
        if (!ids.length) await writeOut("No workspaces discovered");
      }
      process.exit(0);
    }

    if (command === "sessions") {
      // Local sessions
      const sessionsRaw = herdrCliJson("", ["session", "list", "--json"]);
      if (!sessionsRaw.ok) {
        await writeOut("Failed to list sessions");
        process.exit(1);
      }
      const sessionList =
        (
          sessionsRaw.json as {
            sessions?: Array<{
              name: string;
              running: boolean;
              default: boolean;
              socket_path: string;
            }>;
          }
        )?.sessions || [];

      interface SessionRow {
        host: string;
        name: string;
        running: boolean;
        isDefault: boolean;
        workspaceCount: number;
        agentCount: number;
      }

      const rows: SessionRow[] = [];
      for (const s of sessionList) {
        const wsRaw = herdrCliJson(s.name, ["workspace", "list"]);
        const workspaces = wsRaw.ok
          ? (wsRaw.json as { result?: { workspaces?: Array<{ workspace_id: string }> } })?.result
              ?.workspaces || []
          : [];
        let agentCount = 0;
        for (const ws of workspaces) {
          const listed = listWorkspaceAgents(ws.workspace_id!, s.name);
          agentCount += listed.agents.length;
        }
        rows.push({
          host: "(local)",
          name: s.name,
          running: s.running,
          isDefault: s.default,
          workspaceCount: workspaces.length,
          agentCount,
        });
      }

      // Remote sessions
      const config = discoverHerdrProjectConfig(projectPath);
      let remoteHosts: Record<string, string | RemoteHostConfig> = {};
      const remoteErrors: Array<{ host: string; message: string }> = [];
      if (config?.enabled) {
        const full = { ...config, projectPath };
        const doc = (() => {
          if (!config.sourcePath) return null;
          try {
            return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
          } catch {
            return null;
          }
        })();
        const orchConfig = resolveOrchestratorConfig(full, doc);
        remoteHosts = orchConfig.remoteHosts;

        if (Object.keys(remoteHosts).length > 0) {
          const discovered = await discoverRemoteSessions(remoteHosts, orchConfig.remoteDefaults);
          remoteErrors.push(...discovered.errors);
          for (const rs of discovered.sessions) {
            rows.push({
              host: rs.host,
              name: rs.sessionName,
              running: rs.status === "running",
              isDefault: false,
              workspaceCount: rs.workspaceCount,
              agentCount: rs.agentCount,
            });
          }
        }
      }

      const hasRemote = Object.keys(remoteHosts).length > 0;

      if (json) {
        await writeJson({
          ok: remoteErrors.length === 0,
          sessions: rows,
          remoteErrors: remoteErrors.length ? remoteErrors : undefined,
        });
        process.exit(0);
      }

      const colorGreen = "\x1b[32m";
      const colorYellow = "\x1b[33;1m";
      const reset = "\x1b[0m";

      // Emit remote connection errors as WARN lines before the table
      for (const err of remoteErrors) {
        await writeOut(`${colorYellow}WARN${reset}   ${err.message}`);
      }

      const hostWidth = hasRemote ? Math.max(4, ...rows.map((r) => r.host.length)) : 0;
      const sessionWidth = Math.max(7, ...rows.map((r) => r.name.length));
      const wsCountWidth = Math.max(10, ...rows.map((r) => String(r.workspaceCount).length));

      if (hasRemote) {
        await writeOut(
          `SESSION${" ".repeat(Math.max(0, sessionWidth - 7))}  HOST${" ".repeat(Math.max(0, hostWidth - 4))}  STATUS    WORKSPACES  AGENTS`
        );
        await writeOut(
          `${"─".repeat(sessionWidth)}  ${"─".repeat(hostWidth)}  ────────  ${"─".repeat(wsCountWidth)}  ──────`
        );
      } else {
        await writeOut("SESSION     STATUS    WORKSPACES  AGENTS");
        await writeOut("──────────  ────────  ──────────  ──────");
      }
      for (const r of rows) {
        const statusStr = r.running ? `${colorGreen}running${reset}` : "stopped";
        if (hasRemote) {
          await writeOut(
            `${r.name.padEnd(sessionWidth)}  ${r.host.padEnd(hostWidth)}  ${statusStr.padEnd(16 + colorGreen.length + reset.length - 7)}  ${String(r.workspaceCount).padEnd(wsCountWidth)}  ${r.agentCount}`
          );
        } else {
          await writeOut(
            `${r.name.padEnd(10)}  ${statusStr.padEnd(16 + colorGreen.length + reset.length - 7)}  ${String(r.workspaceCount).padEnd(10)}  ${r.agentCount}`
          );
        }
      }
      await writeOut("");
      if (!hasRemote) await writeOut("* = default session");
      process.exit(0);
    }

    if (command === "check-hosts") {
      const config = discoverHerdrProjectConfig(projectPath);
      if (!config?.enabled) {
        if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
        else await writeOut("No [herdr] profile");
        process.exit(1);
      }
      const full = { ...config, projectPath };
      const doc = (() => {
        if (!config.sourcePath) return null;
        try {
          return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
        } catch {
          return null;
        }
      })();
      const orchConfig = resolveOrchestratorConfig(full, doc);
      const resolvedHosts = normalizeRemoteHostConfig(
        orchConfig.remoteHosts,
        orchConfig.remoteDefaults
      );

      if (Object.keys(resolvedHosts).length === 0) {
        if (json) await writeJson({ ok: true, hosts: [], message: "no remote hosts configured" });
        else await writeOut("No remote hosts configured.");
        process.exit(0);
      }

      interface HostCheck {
        host: string;
        reachable: boolean;
        herdrVersion?: string;
        herdrChannel?: string;
        error?: string;
        integrations?: Record<string, string>;
      }

      const results: HostCheck[] = [];
      for (const [label, resolved] of Object.entries(resolvedHosts)) {
        const check: HostCheck = { host: label, reachable: false };
        const versionResult = await sshExec(resolved, ["herdr", "version"]);
        if (versionResult.ok) {
          check.reachable = true;
          const lines = versionResult.output.split("\n");
          check.herdrVersion = lines[0]?.trim() || "?";
          // The first line is typically "herdr <version>" — look for "preview" in output
          check.herdrChannel = versionResult.output.toLowerCase().includes("preview")
            ? "preview"
            : "stable";
        } else {
          const msg =
            versionResult.output.includes("command not found") ||
            versionResult.output.includes("not found")
              ? "herdr command not found on host"
              : versionResult.output.slice(0, 120);
          check.error = msg;
        }
        results.push(check);
      }

      // --versions: query integration versions on reachable hosts
      if (versions) {
        for (const r of results) {
          if (!r.reachable) continue;
          const resolved = resolvedHosts[r.host];
          if (!resolved) continue;
          const integResult = await sshExec(resolved, ["herdr", "integration", "status"]);
          if (integResult.ok) {
            const integVersions = parseIntegrationStatus(integResult.output);
            r.integrations = {};
            for (const [name, info] of integVersions) {
              r.integrations[name] = info.status === "current" ? `v${info.version}` : info.status;
            }
          }
        }
      }

      // --fix: diagnose and suggest fixes for unreachable hosts
      if (forceHandoff || forceContext) {
        // reuse force flags; --fix not in parseArgs yet, use dryRun as proxy
        // Check if user explicitly wants fixes — dryRun indicates diagnostic mode
      }

      if (json) {
        await writeJson({ ok: results.some((r) => r.reachable), hosts: results });
        process.exit(0);
      }

      const colorGreen = "\x1b[32m";
      const colorRed = "\x1b[31m";
      const colorYellow = "\x1b[33;1m";
      const dim = "\x1b[2m";
      const reset = "\x1b[0m";

      const hasFailures = results.some((r) => !r.reachable);

      for (const r of results) {
        if (r.reachable) {
          const channelTag =
            r.herdrChannel === "preview"
              ? `${colorYellow}preview${reset}`
              : `${colorGreen}stable${reset}`;
          await writeOut(
            `${colorGreen}✓${reset} ${r.host}  ${r.herdrVersion}  channel=${channelTag}`
          );
          if (versions && r.integrations) {
            const integParts = Object.entries(r.integrations).map(([k, v]) => `${k}=${v}`);
            if (integParts.length > 0)
              await writeOut(`   ${dim}integrations: ${integParts.join(", ")}${reset}`);
          }
        } else {
          await writeOut(`${colorRed}✗${reset} ${r.host}  ${dim}${r.error}${reset}`);
        }
      }

      if (hasFailures && verbose) {
        await writeOut("");
        await writeOut("── Diagnosis ──");
        for (const r of results) {
          if (r.reachable) continue;
          if (r.error?.includes("command not found") || r.error?.includes("not found")) {
            await writeOut(`  ${r.host}: Install herdr on the remote host:`);
            await writeOut(`    curl -fsSL https://herdr.dev/install.sh | sh`);
            await writeOut(`  Or add ~/.local/bin to the remote PATH.`);
          } else if (
            r.error?.includes("Connection refused") ||
            r.error?.includes("Connection timed out")
          ) {
            await writeOut(`  ${r.host}: SSH connection failed. Check:`);
            await writeOut(`    - Host is reachable: ping ${r.host}`);
            await writeOut(
              `    - SSH port is open: nc -zv ${resolvedHosts[r.host]?.host || r.host} ${resolvedHosts[r.host]?.port || 22}`
            );
            await writeOut(
              `    - Identity file exists: ${resolvedHosts[r.host]?.identityFile || "(ssh default)"}`
            );
          } else {
            await writeOut(`  ${r.host}: ${r.error}`);
          }
        }
      }

      process.exit(hasFailures ? 2 : 0);
    }

    if (command === "check-sessions") {
      const config = discoverHerdrProjectConfig(projectPath);
      if (!config?.enabled) {
        if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
        process.exit(1);
      }
      const full = { ...config, projectPath };
      const doc = (() => {
        if (!config.sourcePath) return null;
        try {
          return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
        } catch {
          return null;
        }
      })();
      const orchConfig = resolveOrchestratorConfig(full, doc);
      const defaultSession = config.session ?? "";
      const remoteHosts = orchConfig.remoteHosts;

      if (!orchConfig.handoffRules.length) {
        await writeOut("No handoff rules defined.");
        process.exit(0);
      }

      // Discover all local running sessions
      const sessionsRaw = herdrCliJson("", ["session", "list", "--json"]);
      const sessionList = sessionsRaw.ok
        ? (sessionsRaw.json as { sessions?: Array<{ name: string; running: boolean }> })
            ?.sessions || []
        : [];
      const runningSessions = new Set(sessionList.filter((s) => s.running).map((s) => s.name));

      // Validate remote hosts connectivity (collect reachable hosts + sessions)
      const resolvedRemoteHosts = normalizeRemoteHostConfig(remoteHosts, orchConfig.remoteDefaults);
      const reachableHosts = new Map<string, ResolvedRemoteHost>(); // hostLabel → resolved
      const remoteRunningSessions = new Map<string, Set<string>>(); // hostLabel → Set<sessionName>
      if (Object.keys(resolvedRemoteHosts).length > 0) {
        for (const [hostLabel, resolved] of Object.entries(resolvedRemoteHosts)) {
          const versionCheck = await sshExec(resolved, ["herdr", "version"]);
          if (!versionCheck.ok) continue;
          reachableHosts.set(hostLabel, resolved);

          // Discover remote sessions
          const remoteSessRaw = await sshExec(resolved, ["herdr", "session", "list", "--json"]);
          if (remoteSessRaw.ok) {
            try {
              const parsed = JSON.parse(remoteSessRaw.output) as {
                sessions?: Array<{ name: string; running: boolean }>;
              };
              const remoteSessions = new Set(
                (parsed.sessions || []).filter((s) => s.running).map((s) => s.name)
              );
              remoteRunningSessions.set(hostLabel, remoteSessions);
            } catch {
              /* skip */
            }
          }
        }
      }

      interface CheckIssue {
        rule: number;
        severity: "error" | "warn" | "info";
        message: string;
      }
      const issues: CheckIssue[] = [];
      let ri = 0;

      for (const rule of orchConfig.handoffRules) {
        ri++;
        if (rule.when?.length) {
          const hasPaneWhen = rule.when.some((clause) => clause.path.startsWith(PANE_PREFIX));
          for (const clause of rule.when) {
            const reportPath = clause.path.startsWith(FINISH_WORK_REPORT_PREFIX);
            const panePath = clause.path.startsWith(PANE_PREFIX);
            if (!reportPath && !panePath) {
              issues.push({
                rule: ri,
                severity: "warn",
                message: `when path "${clause.path}" is unsupported — use finishWorkReport.* or pane.* fields`,
              });
            } else if (panePath && !PANE_WHEN_FIELDS.has(clause.path)) {
              issues.push({
                rule: ri,
                severity: "warn",
                message: `when path "${clause.path}" is unknown — supported: ${[...PANE_WHEN_FIELDS].join(", ")}`,
              });
            }
          }
          issues.push({
            rule: ri,
            severity: "info",
            message: hasPaneWhen
              ? `when rule (${rule.when.length} clause(s)) — includes pane.* (source agent status required)`
              : `when rule (${rule.when.length} clause(s)) — report fields only`,
          });
        }

        const fromParsed = parseHostSession(rule.fromSession || defaultSession);
        const toParsed = parseHostSession(rule.toSession || rule.fromSession || defaultSession);

        const validateSession = (
          role: "from" | "to",
          parsed: HostQualifiedSession,
          _label: string
        ): boolean => {
          if (parsed.host) {
            // Remote session
            if (!reachableHosts.has(parsed.host)) {
              issues.push({
                rule: ri,
                severity: "error",
                message: `${role}_session host "${parsed.host}" is unreachable`,
              });
              return false;
            }
            const hostSessions = remoteRunningSessions.get(parsed.host);
            if (!hostSessions?.has(parsed.session)) {
              issues.push({
                rule: ri,
                severity: "error",
                message: `${role}_session "${parsed.host}:${parsed.session}" is not running`,
              });
              return false;
            }
            return true;
          }
          // Local session
          if (!runningSessions.has(parsed.session)) {
            issues.push({
              rule: ri,
              severity: "error",
              message: `${role}_session "${parsed.session}" is not running`,
            });
            return false;
          }
          return true;
        };

        const fromOk = validateSession("from", fromParsed, rule.fromSession || defaultSession);
        const toOk = validateSession(
          "to",
          toParsed,
          rule.toSession || rule.fromSession || defaultSession
        );
        if (!fromOk || !toOk) continue;

        // Agent/label resolution in each session
        for (const [role, parsed, agentOrLabel, wsId] of [
          ["from", fromParsed, rule.fromAgent, rule.fromWorkspace],
          ["to", toParsed, rule.toAgent, rule.toWorkspace],
        ] as const) {
          const sessLabel = parsed.host ? `${parsed.host}:${parsed.session}` : parsed.session;
          let workspaces: Array<{ workspace_id?: string }> = [];
          let agents: Array<{
            agent?: string;
            name?: string;
            pane_id?: string;
            workspace_id?: string;
            agent_session?: { source?: string; kind?: string };
          }> = [];

          if (parsed.host) {
            // Remote validation
            const hostConn = reachableHosts.get(parsed.host);
            if (hostConn) {
              const wsResult = await sshExec(hostConn, [
                "herdr",
                "--session",
                parsed.session,
                "workspace",
                "list",
                "--json",
              ]);
              if (wsResult.ok) {
                try {
                  const wsParsed = JSON.parse(wsResult.output) as {
                    result?: { workspaces?: Array<{ workspace_id: string }> };
                  };
                  workspaces = wsParsed.result?.workspaces || [];
                } catch {
                  /* skip */
                }
              }
              const agentResult = await sshExec(hostConn, [
                "herdr",
                "--session",
                parsed.session,
                "agent",
                "list",
                "--json",
              ]);
              if (agentResult.ok) {
                try {
                  const agentParsed = JSON.parse(agentResult.output) as {
                    result?: {
                      agents?: Array<{
                        agent?: string;
                        name?: string;
                        pane_id?: string;
                        workspace_id?: string;
                        agent_session?: { source?: string; kind?: string };
                      }>;
                    };
                  };
                  agents = agentParsed.result?.agents || [];
                } catch {
                  /* skip */
                }
              }
            }
          } else {
            // Local validation
            const wsRaw = herdrCliJson(parsed.session, ["workspace", "list"]);
            if (wsRaw.ok) {
              workspaces =
                (wsRaw.json as { result?: { workspaces?: Array<{ workspace_id: string }> } })
                  ?.result?.workspaces || [];
            }
            const agentsRaw = herdrCliJson(parsed.session, ["agent", "list"]);
            if (agentsRaw.ok) {
              agents = (agentsRaw.json?.result?.agents || []) as Array<{
                agent?: string;
                name?: string;
                pane_id?: string;
                workspace_id?: string;
                agent_session?: { source?: string; kind?: string };
              }>;
            }
          }

          const wsExists = workspaces.some((w) => w.workspace_id === wsId);
          if (!wsExists) {
            issues.push({
              rule: ri,
              severity: "warn",
              message: `${role} workspace "${wsId}" not found in session "${sessLabel}"`,
            });
          }

          const wsAgents = agents.filter((a) => a.workspace_id === wsId);

          if (role === "to" && isLegacyGlobalLeastBusyTarget(agentOrLabel)) {
            if (wsAgents.length === 0) {
              issues.push({
                rule: ri,
                severity: "warn",
                message: `to least_busy target — no agents in ${sessLabel}/${wsId}`,
              });
            } else {
              issues.push({
                rule: ri,
                severity: "info",
                message: `to least_busy — ${wsAgents.length} agent(s) in ${sessLabel}/${wsId} eligible globally`,
              });
            }
            continue;
          }

          const matches = wsAgents.filter(
            (a) => a.agent === agentOrLabel || a.name === agentOrLabel
          );

          if (role === "to" && resolveTargetStrategy(rule) === "least_busy") {
            if (matches.length === 0) {
              issues.push({
                rule: ri,
                severity: "warn",
                message: `to "${agentOrLabel}" with target_strategy=least_busy — no matches in ${sessLabel}/${wsId}`,
              });
            } else {
              issues.push({
                rule: ri,
                severity: "info",
                message: `to "${agentOrLabel}" least_busy — ${matches.length} candidate pane(s) in ${sessLabel}/${wsId}`,
              });
            }
            continue;
          }

          const resolved = matches[0];

          if (!resolved) {
            issues.push({
              rule: ri,
              severity: "warn",
              message: `${role} agent/label "${agentOrLabel}" not found in ${sessLabel}/${wsId}`,
            });
            continue;
          }

          const hasSession = !!resolved.agent_session?.source;
          if (!hasSession) {
            issues.push({
              rule: ri,
              severity: "info",
              message: `${role} "${agentOrLabel}" (${sessLabel}) has no session binding — restore: none`,
            });
          }

          // Cross-session remote: check restore support
          if (
            role === "to" &&
            (fromParsed.host !== toParsed.host || fromParsed.session !== toParsed.session)
          ) {
            if (toParsed.host) {
              const hostConn = reachableHosts.get(toParsed.host);
              if (hostConn) {
                const integResult = await sshExec(hostConn, [
                  "herdr",
                  "--session",
                  toParsed.session,
                  "integration",
                  "status",
                ]);
                if (integResult.ok) {
                  const integVersions = parseIntegrationStatus(integResult.output);
                  const sourceName = resolved.agent_session?.source?.startsWith("herdr:")
                    ? resolved.agent_session.source.slice(6)
                    : null;
                  if (sourceName) {
                    const integ = integVersions.get(sourceName);
                    if (integ && integ.status === "current") {
                      issues.push({
                        rule: ri,
                        severity: "info",
                        message: `cross-session target "${agentOrLabel}" (${sessLabel}) supports native restore`,
                      });
                    }
                  }
                }
              }
            } else {
              const integRaw = herdrCliRun(toParsed.session, ["integration", "status"]);
              if (integRaw.ok) {
                const integVersions = parseIntegrationStatus(integRaw.output);
                const sourceName = resolved.agent_session?.source?.startsWith("herdr:")
                  ? resolved.agent_session.source.slice(6)
                  : null;
                if (sourceName) {
                  const integ = integVersions.get(sourceName);
                  if (integ && integ.status === "current") {
                    issues.push({
                      rule: ri,
                      severity: "info",
                      message: `cross-session target "${agentOrLabel}" supports native restore`,
                    });
                  }
                }
              }
            }
          }
        }
      }

      if (json) {
        await writeJson({
          ok: issues.filter((i) => i.severity === "error").length === 0,
          rules: orchConfig.handoffRules.length,
          issues,
        });
        process.exit(0);
      }

      const red = "\x1b[31m";
      const yellow = "\x1b[33;1m";
      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      for (const i of issues) {
        const tag =
          i.severity === "error"
            ? `${red}ERROR${reset}`
            : i.severity === "warn"
              ? `${yellow}WARN ${reset}`
              : `${dim}INFO ${reset}`;
        await writeOut(`${tag}  rule ${i.rule}: ${i.message}`);
      }
      if (!issues.length) await writeOut("All handoff rules validated — no issues.");
      else {
        await writeOut("");
        await writeOut(
          `${issues.filter((i) => i.severity === "error").length} error(s), ${issues.filter((i) => i.severity === "warn").length} warning(s)`
        );
      }

      process.exit(issues.some((i) => i.severity === "error") ? 2 : 0);
    }

    if (command === "history") {
      const argv = Bun.argv;
      const flagValue = (flag: string) => {
        const idx = argv.indexOf(flag);
        return idx >= 0 ? argv[idx + 1] || "" : "";
      };
      const limit = parseInt(flagValue("--limit") || "20", 10);
      const query: HandoffHistoryQuery = { limit };
      const workspaceFilter = flagValue("--workspace");
      const agentFilter = flagValue("--agent");
      const triggerFilter = flagValue("--trigger");
      const actionFilter = flagValue("--action");
      const sinceFilter = flagValue("--since");
      if (workspaceFilter) query.workspace = workspaceFilter;
      if (agentFilter) query.agent = agentFilter;
      if (triggerFilter) query.trigger = triggerFilter as HandoffHistoryQuery["trigger"];
      if (actionFilter) query.action = actionFilter as HandoffHistoryQuery["action"];
      if (sinceFilter) query.since = sinceFilter;
      if (argv.includes("--failed")) query.ok = false;
      if (argv.includes("--ok")) query.ok = true;

      const printHistoryEntries = async (entries: HandoffLogEntry[]) => {
        if (json) {
          await writeJson({ ok: true, logPath: getHandoffLogPath(), query, entries });
          return;
        }
        if (entries.length === 0) {
          await writeOut(`No handoff history matches filters. Log: ${getHandoffLogPath()}`);
          return;
        }
        await writeOut(`Handoff audit (${entries.length} entries, ${getHandoffLogPath()}):`);
        await writeOut("");
        const dim = "\x1b[2m";
        const R = "\x1b[0m";
        for (const e of entries) {
          const tag = e.ok ? "✓" : "✗";
          const ts = new Date(e.timestamp).toISOString().replace("T", " ").slice(0, 19);
          const from = e.fromAgent ? `${e.fromHost || "(local)"}/${e.fromAgent}` : "-";
          const to = e.toAgent ? `${e.toHost || "(local)"}/${e.toAgent}` : "-";
          await writeOut(
            `  ${dim}${ts}${R}  ${tag}  ${e.trigger.padEnd(12)}  ${e.action.padEnd(14)}  ${from.padEnd(22)} → ${to.padEnd(22)}  ${dim}${e.detail.slice(0, 60)}${R}`
          );
        }
      };

      if (argv.includes("--verify")) {
        const failures = verifyHandoffLog();
        if (json)
          await writeJson({ ok: failures.length === 0, logPath: getHandoffLogPath(), failures });
        else if (failures.length) {
          await writeOut(`Checksum failures in live log (${failures.length}):`);
          for (const f of failures)
            await writeOut(`  seq ${f.seq}: expected ${f.expected}, got ${f.actual}`);
        } else await writeOut(`Checksum OK (${getHandoffLogPath()})`);
        process.exit(failures.length ? 2 : 0);
      }

      if (argv.includes("--follow")) {
        let offset = 0;
        const logPath = getHandoffLogPath();
        const renderNew = async () => {
          if (!pathExists(logPath)) return;
          const raw = readText(logPath);
          if (raw.length <= offset) return;
          const chunk = raw.slice(offset);
          offset = raw.length;
          for (const line of chunk.split("\n").filter(Boolean)) {
            try {
              const e = JSON.parse(line) as HandoffLogEntry;
              if (!entryMatchesHandoffQuery(e, query)) continue;
              const dim = "\x1b[2m";
              const R = "\x1b[0m";
              const tag = e.ok ? "✓" : "✗";
              const ts = new Date(e.timestamp).toISOString().replace("T", " ").slice(0, 19);
              await writeOut(
                `${dim}${ts}${R}  ${tag}  ${e.trigger}  ${e.action}  ${e.detail.slice(0, 80)}`
              );
            } catch {
              /* skip malformed */
            }
          }
        };
        await writeOut(`Following ${logPath} (Ctrl+C to stop)…`);
        await printHistoryEntries(await queryHandoffHistory(query));
        await renderNew();

        using followCtx = {
          abort: new AbortController(),
          _sigHandler: null as (() => void) | null,
          [Symbol.dispose]() {
            this.abort.abort();
            if (this._sigHandler) process.off("SIGINT", this._sigHandler);
          },
        };

        void (async () => {
          while (!followCtx.abort.signal.aborted) {
            await Bun.sleep(1000);
            if (followCtx.abort.signal.aborted) break;
            if (!pathExists(logPath)) continue;
            await renderNew();
          }
        })();

        followCtx._sigHandler = () => process.exit(0);
        process.on("SIGINT", followCtx._sigHandler);
      } else {
        await printHistoryEntries(await queryHandoffHistory(query));
        process.exit(0);
      }
    }

    if (command === "config") {
      // Second positional after "config" is subcommand. Parse from raw argv.
      const rawPos = Bun.argv.slice(2).filter((a) => !a.startsWith("-"));
      const sub = rawPos[1] && rawPos[0] === "config" ? rawPos[1] : "show";

      const displayHerdrConfig = async () => {
        const app = readHerdrAppConfig();
        if (!app) {
          if (json) await writeJson({ ok: false, error: "~/.config/herdr/config.toml not found" });
          else await writeOut("No Herdr config found at ~/.config/herdr/config.toml");
          process.exit(1);
        }
        if (json) {
          await writeJson({ ok: true, herdrConfig: app });
        } else {
          await writeOut("── Herdr App Config (~/.config/herdr/config.toml) ──");
          await writeOut(`  onboarding: ${app.onboarding ?? "(not set)"}`);
          if (app.update) await writeOut(`  update.channel: ${app.update.channel}`);
          if (app.remote)
            await writeOut(`  remote.manage_ssh_config: ${app.remote.manageSshConfig}`);
          if (app.plugins?.notify) {
            const n = app.plugins.notify;
            await writeOut(`  plugins.notify.enabled: ${n.enabled ?? true}`);
            if (n.webhookUrl) await writeOut(`  plugins.notify.webhook_url: ${n.webhookUrl}`);
            if (n.onHandoff !== undefined)
              await writeOut(`  plugins.notify.on_handoff: ${n.onHandoff}`);
            if (n.onSpawn !== undefined) await writeOut(`  plugins.notify.on_spawn: ${n.onSpawn}`);
            if (n.onError !== undefined) await writeOut(`  plugins.notify.on_error: ${n.onError}`);
          }
        }
        process.exit(0);
      };

      const reloadConfig = async () => {
        const config = discoverHerdrProjectConfig(projectPath);
        if (!config?.enabled) {
          if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
          else await writeOut("No [herdr] profile");
          process.exit(1);
        }
        const full = { ...config, projectPath };
        const doc = (() => {
          if (!config.sourcePath) return null;
          try {
            return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
          } catch {
            return null;
          }
        })();
        const orchConfig = resolveOrchestratorConfig(full, doc);
        const resolvedHosts = normalizeRemoteHostConfig(
          orchConfig.remoteHosts,
          orchConfig.remoteDefaults
        );

        if (Object.keys(resolvedHosts).length === 0) {
          if (json) await writeJson({ ok: false, error: "no remote hosts configured" });
          else await writeOut("No remote hosts configured.");
          process.exit(1);
        }

        const results: Array<{ host: string; ok: boolean; error?: string }> = [];
        for (const [hostLabel, resolved] of Object.entries(resolvedHosts)) {
          if (!json) await writeOut(`Reloading config on ${hostLabel}...`);
          const result = await sshExec(resolved, ["herdr", "server", "reload-config"]);
          results.push({
            host: hostLabel,
            ok: result.ok,
            error: result.ok ? undefined : result.output,
          });
        }

        if (json) {
          await writeJson({ ok: results.every((r) => r.ok), results });
        } else {
          for (const r of results) {
            await writeOut(r.ok ? `  ✓ ${r.host}: config reloaded` : `  ✗ ${r.host}: ${r.error}`);
          }
        }
        process.exit(results.every((r) => r.ok) ? 0 : 2);
      };

      if (sub === "herdr") {
        await displayHerdrConfig();
        process.exit(0);
      }
      if (sub === "reload") {
        await reloadConfig();
        process.exit(0);
      }

      if (sub !== "show") {
        await writeOut(`Unknown config subcommand "${sub}". Use: show, herdr, or reload.`);
        process.exit(2);
      }

      const config = discoverHerdrProjectConfig(projectPath);
      if (!config?.enabled) {
        if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
        else await writeOut("No [herdr] profile");
        process.exit(1);
      }

      const full = { ...config, projectPath };
      const doc = (() => {
        if (!config.sourcePath) return null;
        try {
          return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
        } catch {
          return null;
        }
      })();
      const orchConfig = resolveOrchestratorConfig(full, doc);

      if (Object.keys(orchConfig.remoteHosts).length === 0) {
        if (json)
          await writeJson({ ok: true, remoteHosts: {}, message: "no remote hosts configured" });
        else
          await writeOut(
            "No remote hosts configured. Add [herdr.orchestrator.remote_hosts] to your config."
          );
        process.exit(0);
      }

      const resolved = normalizeRemoteHostConfig(orchConfig.remoteHosts, orchConfig.remoteDefaults);

      if (json) {
        const printable: Record<string, Record<string, unknown>> = {};
        for (const [label, r] of Object.entries(resolved)) {
          printable[label] = { ...r, name: undefined };
        }
        await writeJson({
          ok: true,
          remoteDefaults: orchConfig.remoteDefaults,
          remoteHosts: printable,
        });
        process.exit(0);
      }

      await writeOut(`Remote hosts (${Object.keys(resolved).length}):`);
      await writeOut("");
      for (const [label, r] of Object.entries(resolved)) {
        await writeOut(`  ${label}:`);
        await writeOut(`    host:          ${r.host}`);
        await writeOut(`    port:          ${r.port ?? 22}`);
        await writeOut(`    user:          ${r.user || "(ssh default)"}`);
        await writeOut(
          `    identityFile:  ${r.identityFile ? `${r.identityFile} [${r.identityFileSource}]` : "(ssh default)"}`
        );
        await writeOut(`    timeout:       ${r.timeout}ms`);
        await writeOut(`    batchMode:     ${r.batchMode}`);
        await writeOut(`    connectTimeout:${r.connectTimeout}s`);
        await writeOut(`    strictHostKey: ${r.strictHostKeyChecking}`);
        if (r.userKnownHostsFile) await writeOut(`    knownHostsFile:${r.userKnownHostsFile}`);
        if (r.serverAliveInterval)
          await writeOut(`    keepAlive:     ${r.serverAliveInterval}s × ${r.serverAliveCountMax}`);
        if (r.controlMaster !== "no") {
          await writeOut(`    controlMaster: ${r.controlMaster}`);
          if (r.controlPath) await writeOut(`    controlPath:   ${r.controlPath}`);
          if (r.controlPersist !== undefined)
            await writeOut(`    controlPersist:${r.controlPersist}s`);
        }
        if (r.compression) await writeOut(`    compression:   ${r.compression}`);
        if (r.proxyJump) await writeOut(`    proxyJump:     ${r.proxyJump}`);
        if (r.identitiesOnly) await writeOut(`    identitiesOnly:${r.identitiesOnly}`);
        await writeOut("");
      }

      // Validation warnings
      const warnings = validateRemoteHostConfig(resolved);
      if (warnings.length > 0) {
        await writeOut("── Warnings ──");
        const colorY = "\x1b[33;1m";
        const dim = "\x1b[2m";
        const reset = "\x1b[0m";
        for (const w of warnings) {
          const tag = w.severity === "warn" ? `${colorY}WARN${reset}` : `${dim}INFO${reset}`;
          await writeOut(`  ${tag}  ${w.host}: ${w.message}`);
        }
        await writeOut("");
      }

      process.exit(0);
    }

    if (command === "readiness") {
      const config = discoverHerdrProjectConfig(projectPath);
      if (!config?.enabled) {
        if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
        process.exit(1);
      }
      const full = { ...config, projectPath };
      const _ids = workspace ? [workspace] : findAllWorkspacesForProject(full).workspaceIds;
      const session = config.session ?? "";

      // Build agent session map
      const rawAgents = herdrCliJson(session, ["agent", "list"]);
      const agentSessionMap = new Map<string, string>();
      const agents: Array<{ paneId: string; agent: string }> = [];
      if (rawAgents.ok) {
        for (const r of (rawAgents.json?.result?.agents || []) as Array<{
          agent?: string;
          pane_id?: string;
          agent_session?: { source?: string };
        }>) {
          if (r.pane_id && r.agent) agents.push({ paneId: r.pane_id, agent: r.agent });
          if (r.pane_id && r.agent_session?.source)
            agentSessionMap.set(r.pane_id, r.agent_session.source);
        }
      }

      // Get integration versions
      const integRaw = herdrCliRun(session, ["integration", "status"]);
      const integVersions = integRaw.ok ? parseIntegrationStatus(integRaw.output) : new Map();

      // Evaluate restore readiness
      const getReadiness = getRestoreReadiness(agentSessionMap, integVersions);
      const results = agents.map((a) => getReadiness(a.paneId, a.agent));

      if (json) {
        await writeJson({ ok: true, projectPath, agentCount: results.length, agents: results });
        process.exit(0);
      }

      const counts: Record<string, number> = { native: 0, replay: 0, none: 0 };
      const colorR = (s: RestoreStatus) => {
        switch (s) {
          case "native":
            return "\x1b[32m";
          case "replay":
            return "\x1b[33;1m";
          default:
            return "\x1b[2m";
        }
      };
      const reset = "\x1b[0m";

      await writeOut("AGENT         RESTORE  DETAIL");
      await writeOut("────────────  ───────  ──────────────────────────────────────────────");
      for (const r of results) {
        counts[r.restore]!++;
        await writeOut(
          `${r.agent.padEnd(13)} ${colorR(r.restore)}${r.restore.padEnd(7)}${reset} ${r.detail}`
        );
      }
      await writeOut("");
      await writeOut(
        `Summary: ${colorR("native")}${counts.native} native${reset}, ${colorR("replay")}${counts.replay} replay${reset}, ${counts.none} none`
      );

      process.exit(counts.replay! > 0 ? 2 : 0);
    }

    if (command === "agent-info") {
      // Target is the first positional after the command (ignore path parsing)
      const rawPos = Bun.argv.slice(2).filter((a) => !a.startsWith("-") && a !== command);
      const target = rawPos[0] || "";
      if (!target) {
        await writeOut("usage: herdr-orchestrator agent-info <target> [path]");
        process.exit(1);
      }
      // Use explicit path if provided (3rd arg), else process.cwd()
      const infoPath = rawPos[1] || process.cwd();
      const config = discoverHerdrProjectConfig(infoPath);
      const session = config?.session ?? "";

      // Get raw agent data for session info
      const rawAgents = herdrCliJson(session, ["agent", "list"]);
      const agentData = (() => {
        if (!rawAgents.ok) return null;
        const rows = (rawAgents.json?.result?.agents || []) as Array<{
          agent?: string;
          name?: string;
          pane_id?: string;
          workspace_id?: string;
          agent_status?: string;
          custom_status?: string;
          label?: string;
          agent_session?: { source?: string; kind?: string; value?: string };
        }>;
        return (
          rows.find((r) => r.agent === target || r.name === target || r.pane_id === target) || null
        );
      })();

      if (!agentData) {
        await writeOut(`Agent "${target}" not found`);
        process.exit(1);
      }

      const source = agentData.agent_session?.source || (agentData.agent ? "reported" : "detected");
      const detectionKind = agentData.agent_session
        ? `lifecycle (${agentData.agent_session.source}, ${agentData.agent_session.kind || "?"})`
        : agentData.agent
          ? "reported (pane report-agent)"
          : "detected (screen manifest)";

      if (json) {
        await writeJson({
          ok: true,
          target,
          agent: agentData.agent || null,
          name: agentData.name || null,
          label: agentData.label || null,
          paneId: agentData.pane_id || null,
          workspaceId: agentData.workspace_id || null,
          status: agentData.agent_status || "unknown",
          customStatus: agentData.custom_status || null,
          detection: {
            source,
            kind: detectionKind,
            session: agentData.agent_session || null,
          },
        });
        process.exit(0);
      }

      await writeOut(`Agent: ${agentData.agent || agentData.name || target}`);
      if (agentData.label) await writeOut(`Label: ${agentData.label}`);
      await writeOut(`Pane: ${agentData.pane_id || "?"}`);
      await writeOut(`Workspace: ${agentData.workspace_id || "?"}`);
      await writeOut(`Status: ${agentData.agent_status || "unknown"}`);
      if (agentData.custom_status) await writeOut(`Custom: ${agentData.custom_status}`);
      await writeOut(`Detection: ${detectionKind}`);

      // Try agent explain for native integrations
      if (agentData.agent_session) {
        await writeOut("");
        await writeOut("── herdr agent explain ──");
        const explain = herdrCliRun(session, ["agent", "explain", target]);
        if (explain.ok) {
          await writeOut(explain.output);
        } else {
          await writeOut(`(explain unavailable: ${explain.output.slice(0, 120)})`);
        }
      }

      process.exit(0);
    }

    if (command === "dashboard") {
      const config = discoverHerdrProjectConfig(projectPath);
      if (!config?.enabled) {
        if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
        process.exit(1);
      }

      const full = { ...config, projectPath };
      const doc = (() => {
        if (!config.sourcePath) return null;
        try {
          return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
        } catch {
          return null;
        }
      })();
      const orchConfig = resolveOrchestratorConfig(full, doc);
      const configDashboardWebview = orchConfig.dashboard.webview === true;
      const launchDashboardServer =
        dashboardServe || dashboardWebview || dashboardScreenshot || configDashboardWebview;

      if (launchDashboardServer) {
        const useWebview =
          dashboardWebview || (configDashboardWebview && !dashboardServe && !dashboardScreenshot);
        const persistProfile =
          dashboardPersistProfile ||
          Boolean(dashboardProfileDir) ||
          orchConfig.dashboard.persistProfile === true;
        const profileDir = dashboardProfileDir || orchConfig.dashboard.profileDir || undefined;
        const dashboardShell: "serve" | "webview" | "automation" = useWebview
          ? "webview"
          : dashboardScreenshot
            ? "automation"
            : "serve";
        const serverOpts = {
          projectPath,
          port: dashboardPort,
          sessions: showSessions,
          host: cliHost,
          domain,
          includeDoctor,
          verbose,
          dryRun,
          http3: dashboardHttp3 ? true : undefined,
          pollHintMs: orchConfig.dashboard.pollHintMs,
          ssePollMs: orchConfig.dashboard.ssePollMs,
          staleMs: orchConfig.dashboard.staleMs,
          examplesDashboardUrl: orchConfig.dashboard.examplesUrl,
          autoStartExamples: orchConfig.dashboard.autoStartExamples,
          herdrEvents: orchConfig.events.enabled,
          webview: {
            shell: dashboardShell,
            persistProfile,
            profileDir,
            backend: dashboardBackend,
          },
        };

        if (dashboardScreenshot) {
          const { captureHerdrDashboardScreenshot } =
            await import("../lib/herdr-dashboard/automation/automation.ts");
          const result = await captureHerdrDashboardScreenshot({
            ...serverOpts,
            outputPath: dashboardScreenshot,
            thumbnailPath: dashboardThumbnail || undefined,
            backend: dashboardBackend,
            persistProfile,
            profileDir,
            clickAttach: dashboardProbe,
          });
          if (json) {
            await writeJson(result);
          } else {
            const thumb =
              result.thumbnailPath && result.thumbnailBytes
                ? ` thumb=${result.thumbnailPath} (${result.thumbnailBytes}b)`
                : "";
            await writeOut(
              `[dashboard] screenshot ${result.outputPath} (${result.screenshotBytes} bytes, ready=${result.ready}, agents=${result.agentRows})${thumb}`
            );
          }
          process.exit(result.ok ? 0 : 1);
        }

        const { runHerdrDashboardServe, runHerdrDashboardWebView } =
          await import("../lib/herdr-webview-dashboard.ts");
        if (useWebview) {
          await runHerdrDashboardWebView(serverOpts, {
            backend: dashboardBackend,
            persistProfile,
            profileDir,
          });
        } else {
          await runHerdrDashboardServe(serverOpts);
        }
        process.exit(0);
      }

      const payload = await getDashboardAgents(projectPath, {
        sessions: showSessions,
        host: cliHost,
        domain,
        includeDoctor,
        verbose,
        workspace,
      });
      const rows = payload.agents;
      const hasRemote = rows.some((r) => r.host !== "(local)");

      if (json) {
        await writeJson({
          ok: payload.ok,
          projectPath: payload.projectPath,
          agentCount: payload.agentCount,
          agents: payload.agents,
          ...(payload.error ? { error: payload.error } : {}),
        });
        process.exit(payload.ok ? 0 : 1);
      }

      if (!rows.length) {
        await writeOut(`No agents discovered${domain ? ` in domain "${domain}"` : ""}`);
        process.exit(0);
      }

      // ANSI helpers
      const R = "\x1b[0m"; // reset
      const D = "\x1b[2m"; // dim
      const B = "\x1b[1m"; // bold
      const G = "\x1b[32m"; // green
      const Y = "\x1b[33;1m"; // yellow
      const Rd = "\x1b[31m"; // red

      const statusIcon = (status: string) => {
        switch (status) {
          case "idle":
            return `${G}●${R}`;
          case "working":
            return `${Y}◉${R}`;
          case "blocked":
            return `${Rd}✖${R}`;
          case "done":
            return `${D}○${R}`;
          default:
            return `${D}?${R}`;
        }
      };

      const statusColor = (status: string) => {
        switch (status) {
          case "working":
            return Y;
          case "blocked":
            return Rd;
          case "idle":
            return G;
          case "done":
            return D;
          default:
            return D;
        }
      };

      const pad = (s: string, w: number) => s.padEnd(w);

      // Column widths
      const hostWidth = hasRemote ? Math.max(4, ...rows.map((r) => r.host.length)) : 0;
      const sessionWidth = showSessions ? Math.max(7, ...rows.map((r) => r.session.length)) : 0;
      const wsWidth = Math.max(9, ...rows.map((r) => r.workspaceId.length));
      const agentWidth = Math.max(5, ...rows.map((r) => r.agent.length));
      const paneWidth = Math.max(4, ...rows.map((r) => r.paneId.length));

      // Build grid
      const lines: string[] = [];
      const counts: Record<string, number> = {};

      // Header
      const cols: string[] = [];
      if (hasRemote) cols.push(B + pad("HOST", hostWidth) + R);
      if (showSessions) cols.push(B + pad("SESSION", sessionWidth) + R);
      cols.push(B + pad("WORKSPACE", wsWidth) + R);
      cols.push(B + pad("AGENT", agentWidth) + R);
      cols.push(B + "STATUS" + R);
      cols.push(B + "PANE" + R);
      lines.push(cols.join("  "));

      // Separator
      const seps: string[] = [];
      if (hasRemote) seps.push(D + "─".repeat(hostWidth) + R);
      if (showSessions) seps.push(D + "─".repeat(sessionWidth) + R);
      seps.push(D + "─".repeat(wsWidth) + R);
      seps.push(D + "─".repeat(agentWidth) + R);
      seps.push(D + "───" + R);
      seps.push(D + "─".repeat(paneWidth) + R);
      lines.push(seps.join("  "));

      // Rows
      for (const row of rows) {
        counts[row.status] = (counts[row.status] || 0) + 1;
        const sc = statusColor(row.status);
        const icon = statusIcon(row.status);
        const rowCols: string[] = [];
        if (hasRemote) rowCols.push(`${D}${pad(row.host, hostWidth)}${R}`);
        if (showSessions) rowCols.push(`${D}${pad(row.session, sessionWidth)}${R}`);
        rowCols.push(pad(row.workspaceId, wsWidth));
        rowCols.push(pad(row.agent, agentWidth));
        rowCols.push(`${icon} ${sc}${pad(row.status, 6)}${R}`);
        rowCols.push(row.paneId);
        lines.push(rowCols.join("  "));
      }

      // Render
      await writeOut("");
      for (const line of lines) await writeOut(`  ${line}`);
      await writeOut("");

      // Summary bar
      const total = rows.length;
      const parts: string[] = [];
      const order = ["idle", "working", "blocked", "done"];
      for (const s of order) {
        const n = counts[s] || 0;
        if (n > 0) parts.push(`${statusIcon(s)} ${statusColor(s)}${n} ${s}${R}`);
      }
      const other = total - order.reduce((sum, s) => sum + (counts[s] || 0), 0);
      if (other > 0) parts.push(`${D}${other} other${R}`);
      await writeOut(`  ${B}${total}${R} agent(s) · ${parts.join(`  ${D}│${R}  `)}`);
      await writeOut("");

      if (dashboardWatch) {
        await writeOut(`${D}── watch mode: ctrl+c to stop ──${R}`);
        await writeOut("");

        const refresh = async () => {
          while (true) {
            await Bun.sleep(3000);
            await writeStdout("\x1b[2J\x1b[H");
            const proc = Bun.spawn(
              withBunNoOrphans([
                process.execPath,
                Bun.argv[1]!,
                "dashboard",
                ...(showSessions ? ["--sessions"] : []),
                ...(cliHost ? ["--host", cliHost] : []),
                ...(domain ? ["--domain", domain] : []),
                ...(includeDoctor ? ["--include-doctor"] : []),
              ]),
              { stdio: ["ignore", "inherit", "inherit"], env: withNoOrphansEnv() }
            );
            await proc.exited;
          }
        };

        process.on("SIGINT", () => process.exit(0));
        try {
          await refresh();
        } catch {
          process.exit(1);
        }
      } else {
        process.exit(0);
      }
    }

    if (command === "context-sync") {
      const config = discoverHerdrProjectConfig(projectPath);
      if (!config?.enabled) process.exit(1);
      const full = { ...config, projectPath };
      const match = findWorkspaceForProject(full);
      const sync = syncAgentsTabContext(full, full.agentsTab?.panes, match.workspaceId);
      if (json)
        await writeJson({
          ok: sync.warnings.length === 0,
          delivered: sync.delivered,
          contextFile: sync.contextFile,
          warnings: sync.warnings,
        });
      else {
        for (const row of sync.delivered)
          await writeOut(`delivered ${row.agent} (${row.bytes} bytes)`);
        if (sync.contextFile) await writeOut(`context file: ${sync.contextFile}`);
        if (sync.contextJsonFile) await writeOut(`context json: ${sync.contextJsonFile}`);
        for (const warning of sync.warnings) await writeOut(`warn: ${warning}`);
      }
      process.exit(sync.warnings.length ? 2 : 0);
    }

    if (command === "escalate") {
      const reportPath = join(projectPath, ".kimi", "finish-work-report.json");
      if (!pathExists(reportPath)) {
        if (json) await writeJson({ ok: false, error: "no finish-work report" });
        process.exit(1);
      }
      const report = normalizeFinishWorkReport(
        JSON.parse(readText(reportPath)) as Record<string, unknown>
      );
      const result = await escalateFinishWorkToReviewer(projectPath, report);
      if (json) await writeJson({ ok: Boolean(result.herdr?.escalated), herdr: result.herdr });
      else
        await writeOut(
          result.herdr?.escalated
            ? `escalated ${result.herdr.reviewerPaneId}`
            : result.herdr?.error || "not escalated"
        );
      process.exit(result.herdr?.escalated ? 0 : 2);
    }

    if (command === "watch-events") {
      using signalHandlers = {
        controller: new AbortController(),
        _listeners: [] as Array<[NodeJS.Signals, () => void]>,
        [Symbol.dispose]() {
          for (const [sig, fn] of this._listeners) process.off(sig, fn);
        },
      };
      const onSignal = () => signalHandlers.controller.abort();
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);
      signalHandlers._listeners.push(["SIGINT", onSignal], ["SIGTERM", onSignal]);

      const result = await Effect.runPromise(
        watchOrchestratorEventsEffect(projectPath, {
          json,
          signal: signalHandlers.controller.signal,
        }).pipe(Effect.provide(mergedHerdrConfigLayer()))
      );
      if (json) await writeJson(result);
      process.exit(result.ok ? 0 : 2);
    }

    // ── agent subcommands (start / stop / attach) ─────────────────────

    if (command === "agent") {
      if (!agentSubcommand || !cliHost) {
        await writeOut(
          "usage: herdr-orchestrator agent <start|stop|restart|upgrade|list|get|send|exec|log|explain|rename|wait|manifests|ssh|attach> [target] --host HOST [--session S] [--workspace W] [--takeover]"
        );
        process.exit(2);
      }

      const config = discoverHerdrProjectConfig(projectPath);
      if (!config?.enabled) {
        if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
        else await writeOut("No [herdr] profile");
        process.exit(1);
      }

      const full = { ...config, projectPath };
      const doc = (() => {
        if (!config.sourcePath) return null;
        try {
          return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
        } catch {
          return null;
        }
      })();
      const orchConfig = resolveOrchestratorConfig(full, doc);
      const rawHostConfig = orchConfig.remoteHosts[cliHost];
      if (!rawHostConfig) {
        const knownHosts = Object.keys(orchConfig.remoteHosts).join(", ");
        if (json)
          await writeJson({
            ok: false,
            error: `host "${cliHost}" not configured (known: ${knownHosts || "none"})`,
          });
        else await writeOut(`Unknown host "${cliHost}". Known hosts: ${knownHosts || "none"}`);
        process.exit(1);
      }
      const resolvedHosts = normalizeRemoteHostConfig(
        { [cliHost]: rawHostConfig },
        orchConfig.remoteDefaults
      );
      const resolved = resolvedHosts[cliHost]!;
      const sess = agentSession || config.session || "";

      const herdrArgs = (base: string[]): string[] => {
        if (sess) return ["herdr", "--session", sess, ...base];
        return ["herdr", ...base];
      };

      if (agentSubcommand === "start") {
        if (!agentTarget) {
          await writeOut(
            "usage: herdr-orchestrator agent start <name> --host HOST [--session S] [--workspace W] [--cwd PATH] [--tab ID] [--split DIR] [--env K=V] [--focus] -- [argv...]"
          );
          process.exit(2);
        }
        // Pass through extra flags after the agent name
        const startFlags: string[] = [];
        const raw = Bun.argv.slice(2);
        let foundAgent = false;
        const skipNext = new Set(["--host", "--session", "--workspace"]);
        for (let i = 0; i < raw.length; i++) {
          if (raw[i] === agentTarget && !foundAgent) {
            foundAgent = true;
            continue;
          }
          if (!foundAgent) continue;
          if (skipNext.has(raw[i]!)) {
            i++;
            continue;
          }
          if (raw[i] === "--") continue;
          startFlags.push(raw[i]!);
        }
        const filteredFlags = startFlags;
        const hasWorkspace = filteredFlags.some(
          (f, i, a) => f === "--workspace" || a[i - 1] === "--workspace"
        );
        const startArgs = ["agent", "start", agentTarget, ...filteredFlags];
        if (workspace && !hasWorkspace) startArgs.push("--workspace", workspace);
        const sshCommand = [...herdrArgs(startArgs)];
        if (dryRun) {
          await writeOut(`[dry-run] ssh -> ${resolved.host}: ${sshCommand.join(" ")}`);
          process.exit(0);
        }
        if (json)
          await writeOut(
            JSON.stringify({ ok: true, host: cliHost, command: "start", agent: agentTarget })
          );
        else await writeOut(`Starting agent "${agentTarget}" on ${cliHost}...`);

        const result = await sshExec(resolved, sshCommand);
        if (!result.ok) {
          if (json) await writeJson({ ok: false, error: result.output });
          else await writeOut(`Failed: ${result.output}`);
          process.exit(1);
        }
        if (!json) await writeOut(result.output);
        process.exit(0);
      }

      if (agentSubcommand === "stop") {
        if (!agentTarget) {
          await writeOut("usage: herdr-orchestrator agent stop <target> --host HOST [--session S]");
          process.exit(2);
        }
        // Resolve agent name to pane ID if not already a pane ID
        let paneOrAgent = agentTarget;
        if (!agentTarget.includes(":")) {
          const listResult = await sshExec(resolved, [...herdrArgs(["agent", "list", "--json"])]);
          if (listResult.ok) {
            try {
              const parsed = JSON.parse(listResult.output) as {
                result?: { agents?: Array<{ agent?: string; name?: string; pane_id?: string }> };
              };
              const matched = (parsed.result?.agents || []).find(
                (a) => (a.agent === agentTarget || a.name === agentTarget) && a.pane_id
              );
              if (matched?.pane_id) paneOrAgent = matched.pane_id;
            } catch {
              /* fall through to agent stop */
            }
          }
        }
        // Try pane close first (Herdr recommended), fall back to agent stop
        const closeCmd = paneOrAgent.includes(":")
          ? [...herdrArgs(["pane", "close", paneOrAgent])]
          : [...herdrArgs(["agent", "stop", agentTarget])];
        if (dryRun) {
          await writeOut(`[dry-run] ssh -> ${resolved.host}: ${closeCmd.join(" ")}`);
          process.exit(0);
        }
        if (json)
          await writeOut(
            JSON.stringify({ ok: true, host: cliHost, command: "stop", target: agentTarget })
          );
        else await writeOut(`Stopping agent "${agentTarget}" on ${cliHost}...`);

        const result = await sshExec(resolved, closeCmd);
        if (!result.ok) {
          if (json) await writeJson({ ok: false, error: friendlySshError(result.output, cliHost) });
          else await writeOut(`Failed: ${friendlySshError(result.output, cliHost)}`);
          process.exit(1);
        }
        if (!json) await writeOut(result.output);
        process.exit(0);
      }

      if (agentSubcommand === "upgrade") {
        if (dryRun) {
          await writeOut(`[dry-run] ${cliHost}: herdr update`);
          process.exit(0);
        }
        if (json) await writeOut(JSON.stringify({ ok: true, host: cliHost, command: "upgrade" }));
        else await writeOut(`Upgrading herdr on ${cliHost}...`);

        const result = await sshExec(resolved, ["herdr", "update"]);
        if (!result.ok) {
          if (json) await writeJson({ ok: false, error: friendlySshError(result.output, cliHost) });
          else await writeOut(`Upgrade failed: ${friendlySshError(result.output, cliHost)}`);
          process.exit(1);
        }
        if (json) await writeJson({ ok: true, host: cliHost, output: result.output });
        else await writeOut(result.output);
        process.exit(0);
      }

      if (agentSubcommand === "restart") {
        if (!agentTarget) {
          await writeOut(
            "usage: herdr-orchestrator agent restart <name> --host HOST [--session S] [--workspace W]"
          );
          process.exit(2);
        }
        if (dryRun) {
          await writeOut(`[dry-run] ${cliHost}: stop + start "${agentTarget}"`);
          process.exit(0);
        }
        const wsArgs = workspace ? ["--workspace", workspace] : [];

        if (!json) await writeOut(`Restarting agent "${agentTarget}" on ${cliHost}...`);

        // Stop
        if (!json) await writeOut(`  ⏹  stopping...`);
        const stopResult = await sshExec(resolved, [...herdrArgs(["agent", "stop", agentTarget])]);
        if (!stopResult.ok) {
          if (json)
            await writeJson({
              ok: false,
              step: "stop",
              error: friendlySshError(stopResult.output, cliHost),
            });
          else await writeOut(`  ✗  stop failed: ${friendlySshError(stopResult.output, cliHost)}`);
          process.exit(1);
        }

        // Small delay to let the server process the stop
        if (!json) await writeOut(`  ✓  stopped`);

        // Start
        if (!json) await writeOut(`  ▶  starting...`);
        const startResult = await sshExec(resolved, [
          ...herdrArgs(["agent", "start", agentTarget, ...wsArgs]),
        ]);
        if (!startResult.ok) {
          if (json)
            await writeJson({
              ok: false,
              step: "start",
              error: friendlySshError(startResult.output, cliHost),
            });
          else
            await writeOut(`  ✗  start failed: ${friendlySshError(startResult.output, cliHost)}`);
          process.exit(1);
        }

        if (json)
          await writeJson({ ok: true, host: cliHost, command: "restart", agent: agentTarget });
        else await writeOut(`  ✓  restarted`);
        process.exit(0);
      }

      if (agentSubcommand === "attach") {
        // Resolve agent by name to provide rich feedback
        let foundInfo = "";
        if (agentTarget) {
          const listResult = await sshExec(resolved, [...herdrArgs(["agent", "list", "--json"])]);
          if (listResult.ok) {
            try {
              const parsed = JSON.parse(listResult.output) as {
                result?: { agents?: Array<{ pane_id?: string; agent?: string; name?: string }> };
              };
              const matched = (parsed.result?.agents || []).find(
                (a) => (a.agent === agentTarget || a.name === agentTarget) && a.pane_id
              );
              if (matched) foundInfo = matched.pane_id!;
            } catch {
              /* ignore */
            }
          }
        }

        // Herdr's native remote attach: herdr --remote <host> [--session <name>]
        const remoteFlag =
          resolved.port && resolved.port !== 22
            ? `ssh://${resolved.user ? `${resolved.user}@` : ""}${resolved.host}:${resolved.port}`
            : resolved.host;

        const sessFlag = sess ? ` --session ${sess}` : "";
        const takeoverFlag = takeover
          ? " (herdr terminal attach <id> --takeover for direct attach)"
          : "";
        const herdrCmd = `herdr --remote ${remoteFlag}${sessFlag}`;

        if (json) {
          await writeJson({
            ok: true,
            host: cliHost,
            agent: agentTarget || null,
            paneId: foundInfo || null,
            command: herdrCmd,
            attachType: takeover ? "direct-terminal" : "full-ui",
          });
        } else {
          if (agentTarget) {
            await writeOut(
              `Agent "${agentTarget}" on ${cliHost}${foundInfo ? ` (pane ${foundInfo})` : ""}`
            );
          } else {
            await writeOut(`Remote host ${cliHost}`);
          }
          await writeOut(`Attach with:\n  $ ${herdrCmd}${takeoverFlag}`);
        }
        process.exit(0);
      }

      if (agentSubcommand === "list") {
        const listResult = await sshExec(resolved, [
          ...herdrArgs(["agent", "list", ...(json ? ["--json"] : [])]),
        ]);
        if (!listResult.ok) {
          if (json) await writeJson({ ok: false, error: listResult.output });
          else await writeOut(`Failed to list agents on ${cliHost}: ${listResult.output}`);
          process.exit(1);
        }

        if (json) {
          try {
            const parsed = JSON.parse(listResult.output);
            await writeJson({ ok: true, host: cliHost, agents: parsed.result?.agents || [] });
          } catch {
            await writeJson({ ok: false, error: "invalid JSON from remote" });
          }
        } else {
          try {
            const parsed = JSON.parse(listResult.output) as {
              result?: {
                agents?: Array<{
                  agent?: string;
                  name?: string;
                  agent_status?: string;
                  workspace_id?: string;
                  pane_id?: string;
                  custom_status?: string;
                  foreground_cwd?: string;
                  agent_session?: { source?: string; kind?: string; id?: string; path?: string };
                }>;
              };
            };
            const agents = parsed.result?.agents || [];
            if (!agents.length) {
              await writeOut(`No agents on ${cliHost}${sess ? ` (session ${sess})` : ""}`);
            } else {
              await writeOut(`Agents on ${cliHost}${sess ? ` (session ${sess})` : ""}:`);
              for (const a of agents) {
                const label = a.name && a.name !== a.agent ? ` (label: ${a.name})` : "";
                const base = `  ${a.agent}${label}  status=${a.agent_status || "?"}  workspace=${a.workspace_id || "?"}  pane=${a.pane_id || "?"}`;
                await writeOut(base);
                if (verbose) {
                  if (a.custom_status) await writeOut(`    custom: ${a.custom_status}`);
                  if (a.foreground_cwd) await writeOut(`    cwd:    ${a.foreground_cwd}`);
                  if (a.agent_session) {
                    const sessInfo = a.agent_session;
                    const parts: string[] = [];
                    if (sessInfo.source) parts.push(`source=${sessInfo.source}`);
                    if (sessInfo.id) parts.push(`id=${sessInfo.id}`);
                    if (sessInfo.path) parts.push(`path=${sessInfo.path}`);
                    if (sessInfo.kind) parts.push(`kind=${sessInfo.kind}`);
                    if (parts.length > 0) await writeOut(`    session: ${parts.join(" ")}`);
                  }
                }
              }
            }
          } catch {
            await writeOut(listResult.output);
          }
        }
        process.exit(0);
      }

      if (agentSubcommand === "ssh") {
        const sshArgs = buildSshArgs(resolved);
        const cmd = `ssh ${sshArgs
          .map((a) => (a.includes(" ") || a.startsWith("-") ? `"${a}"` : a))
          .join(" ")}${agentTarget ? ` -- ${agentTarget}` : ""}`;
        if (json) {
          await writeJson({ ok: true, host: cliHost, command: cmd });
        } else {
          await writeOut(`# Connect to ${cliHost} with resolved SSH options:`);
          await writeOut(`$ ${cmd}`);
        }
        process.exit(0);
      }

      if (agentSubcommand === "manifests") {
        // Query herdr server agent-manifests (server-level, not per-session)
        const manifestsResult = await sshExec(resolved, [
          "herdr",
          "server",
          "agent-manifests",
          ...(json ? ["--json"] : []),
        ]);
        if (!manifestsResult.ok) {
          if (json)
            await writeJson({
              ok: false,
              error: friendlySshError(manifestsResult.output, cliHost),
            });
          else await writeOut(`Failed: ${friendlySshError(manifestsResult.output, cliHost)}`);
          process.exit(1);
        }

        if (json) {
          try {
            await writeJson({ ok: true, host: cliHost, ...JSON.parse(manifestsResult.output) });
          } catch {
            await writeJson({ ok: true, host: cliHost, output: manifestsResult.output });
          }
        } else {
          try {
            const parsed = JSON.parse(manifestsResult.output) as {
              manifests?: Array<{ name?: string; source?: string; state?: string }>;
            };
            const manifests = parsed.manifests || [];
            await writeOut(`Agent manifests on ${cliHost}:`);
            for (const m of manifests) {
              await writeOut(
                `  ${m.name || "?"}  source=${m.source || "?"}  state=${m.state || "?"}`
              );
            }
            if (!manifests.length) await writeOut("  (none)");
          } catch {
            await writeOut(manifestsResult.output);
          }
        }
        process.exit(0);
      }

      if (agentSubcommand === "get") {
        const getResult = await sshExec(resolved, [
          ...herdrArgs(["agent", "get", agentTarget, ...(json ? ["--json"] : [])]),
        ]);
        if (!getResult.ok) {
          if (json)
            await writeJson({ ok: false, error: friendlySshError(getResult.output, cliHost) });
          else await writeOut(`Failed: ${friendlySshError(getResult.output, cliHost)}`);
          process.exit(1);
        }
        if (json) {
          try {
            await writeJson({ ok: true, host: cliHost, agent: JSON.parse(getResult.output) });
          } catch {
            await writeJson({ ok: true, host: cliHost, output: getResult.output });
          }
        } else {
          await writeOut(getResult.output);
        }
        process.exit(0);
      }

      if (agentSubcommand === "explain") {
        const explainResult = await sshExec(resolved, [
          ...herdrArgs([
            "agent",
            "explain",
            agentTarget,
            ...(json ? ["--json"] : verbose ? ["--verbose"] : []),
          ]),
        ]);
        if (!explainResult.ok) {
          if (json)
            await writeJson({ ok: false, error: friendlySshError(explainResult.output, cliHost) });
          else await writeOut(`Failed: ${friendlySshError(explainResult.output, cliHost)}`);
          process.exit(1);
        }
        if (json) {
          try {
            await writeJson({ ok: true, host: cliHost, explain: JSON.parse(explainResult.output) });
          } catch {
            await writeJson({ ok: true, host: cliHost, output: explainResult.output });
          }
        } else {
          await writeOut(`── agent explain ${agentTarget}@${cliHost} ──`);
          await writeOut(explainResult.output);
        }
        process.exit(0);
      }

      if (agentSubcommand === "rename") {
        const rawPos = Bun.argv.slice(2).filter((a) => !a.startsWith("-"));
        const oldName = rawPos[2] || agentTarget;
        const newName = rawPos[3] || "";
        if (!oldName || !newName || oldName === newName) {
          await writeOut(
            "usage: herdr-orchestrator agent rename <old-name> <new-name> --host HOST [--session S]"
          );
          process.exit(2);
        }
        const renameResult = await sshExec(resolved, [
          ...herdrArgs(["agent", "rename", oldName, newName]),
        ]);
        if (!renameResult.ok) {
          if (json)
            await writeJson({ ok: false, error: friendlySshError(renameResult.output, cliHost) });
          else await writeOut(`Failed: ${friendlySshError(renameResult.output, cliHost)}`);
          process.exit(1);
        }
        if (json) await writeJson({ ok: true, host: cliHost, oldName, newName });
        else await writeOut(`Renamed "${oldName}" → "${newName}" on ${cliHost}`);
        process.exit(0);
      }

      if (agentSubcommand === "wait") {
        const statusFlag = Bun.argv.includes("--status")
          ? Bun.argv[Bun.argv.indexOf("--status") + 1]
          : "idle";
        const timeoutIdx = Bun.argv.indexOf("--timeout");
        const timeoutFlag = timeoutIdx >= 0 ? parseInt(Bun.argv[timeoutIdx + 1] || "0", 10) : 30000;

        if (!agentTarget) {
          await writeOut(
            "usage: herdr-orchestrator agent wait <name> --host HOST --status idle|working|blocked|done|unknown [--timeout MS]"
          );
          process.exit(2);
        }

        const waitArgs = [
          ...herdrArgs([
            "agent",
            "wait",
            agentTarget,
            "--status",
            statusFlag!,
            "--timeout",
            String(timeoutFlag),
          ]),
        ];
        if (dryRun) {
          await writeOut(`[dry-run] ${cliHost}: ${waitArgs.join(" ")}`);
          process.exit(0);
        }

        if (!json)
          await writeOut(
            `Waiting for agent "${agentTarget}" to become ${statusFlag} on ${cliHost}...`
          );
        const waitResult = await sshExec(resolved, waitArgs);
        if (!waitResult.ok) {
          if (json)
            await writeJson({ ok: false, error: friendlySshError(waitResult.output, cliHost) });
          else await writeOut(`Wait failed: ${friendlySshError(waitResult.output, cliHost)}`);
          process.exit(1);
        }
        if (json)
          await writeJson({ ok: true, host: cliHost, agent: agentTarget, status: statusFlag });
        else await writeOut(`✓ ${agentTarget}@${cliHost} is now ${statusFlag}`);
        process.exit(0);
      }

      if (agentSubcommand === "log") {
        // Resolve agent name to pane ID first
        const listResult = await sshExec(resolved, [...herdrArgs(["agent", "list", "--json"])]);
        let paneId: string | undefined;
        if (listResult.ok) {
          try {
            const parsed = JSON.parse(listResult.output) as {
              result?: { agents?: Array<{ pane_id?: string; agent?: string; name?: string }> };
            };
            const matched = (parsed.result?.agents || []).find(
              (a) =>
                (a.agent === agentTarget || a.name === agentTarget || a.pane_id === agentTarget) &&
                a.pane_id
            );
            if (matched?.pane_id) paneId = matched.pane_id;
          } catch {
            /* ignore */
          }
        }
        if (!paneId) {
          if (json)
            await writeJson({
              ok: false,
              error: `agent/pane "${agentTarget}" not found on ${cliHost}`,
            });
          else await writeOut(`Agent/pane "${agentTarget}" not found on ${cliHost}`);
          process.exit(1);
        }

        const logResult = await sshExec(resolved, [
          ...herdrArgs([
            "agent",
            "read",
            paneId,
            "--source",
            "recent",
            "--lines",
            "50",
            "--format",
            "text",
          ]),
        ]);
        if (!logResult.ok) {
          if (json) await writeJson({ ok: false, error: logResult.output });
          else await writeOut(`Failed to read agent log: ${logResult.output}`);
          process.exit(1);
        }

        if (json) {
          await writeJson({
            ok: true,
            host: cliHost,
            agent: agentTarget,
            paneId,
            output: logResult.output,
          });
        } else {
          await writeOut(
            `── ${agentTarget}@${cliHost}${sess ? ` session:${sess}` : ""} (pane ${paneId}) ──`
          );
          await writeOut(logResult.output);
        }
        process.exit(0);
      }

      if (agentSubcommand === "send") {
        // Get the text from argv after `--`
        const fullArgs = Bun.argv.slice(2);
        const dashIdx = fullArgs.indexOf("--");
        const text = dashIdx >= 0 ? fullArgs.slice(dashIdx + 1).join(" ") : "";
        if (!text) {
          await writeOut(
            "usage: herdr-orchestrator agent send <target> --host HOST [--session S] -- <text>"
          );
          process.exit(2);
        }

        if (dryRun) {
          const dryCmd = [...herdrArgs(["agent", "send", agentTarget, text])].join(" ");
          await writeOut(`[dry-run] ${cliHost}: ${dryCmd}`);
          process.exit(0);
        }

        if (!json)
          await writeOut(
            `Sending to ${agentTarget}@${cliHost}: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`
          );
        const sendResult = await sshExec(resolved, [
          ...herdrArgs(["agent", "send", agentTarget, text]),
        ]);
        if (!sendResult.ok) {
          if (json)
            await writeJson({ ok: false, error: friendlySshError(sendResult.output, cliHost) });
          else await writeOut(`Send failed: ${friendlySshError(sendResult.output, cliHost)}`);
          process.exit(1);
        }
        if (json) await writeJson({ ok: true, host: cliHost, agent: agentTarget, text });
        process.exit(0);
      }

      if (agentSubcommand === "exec") {
        // Get the command text from argv after `--`
        const fullArgs = Bun.argv.slice(2);
        const dashIdx = fullArgs.indexOf("--");
        const execCmd = dashIdx >= 0 ? fullArgs.slice(dashIdx + 1).join(" ") : agentTarget;
        if (!execCmd) {
          await writeOut(
            "usage: herdr-orchestrator agent exec <target> --host HOST [--session S] -- <command>"
          );
          process.exit(2);
        }

        // Resolve agent name to pane ID
        const listResult = await sshExec(resolved, [...herdrArgs(["agent", "list", "--json"])]);
        let paneId: string | undefined;
        if (listResult.ok) {
          try {
            const parsed = JSON.parse(listResult.output) as {
              result?: { agents?: Array<{ pane_id?: string; agent?: string; name?: string }> };
            };
            const matched = (parsed.result?.agents || []).find(
              (a) =>
                (a.agent === agentTarget || a.name === agentTarget || a.pane_id === agentTarget) &&
                a.pane_id
            );
            if (matched?.pane_id) paneId = matched.pane_id;
          } catch {
            /* ignore */
          }
        }
        if (!paneId) {
          if (json)
            await writeJson({
              ok: false,
              error: `agent/pane "${agentTarget}" not found on ${cliHost}`,
            });
          else await writeOut(`Agent/pane "${agentTarget}" not found on ${cliHost}`);
          process.exit(1);
        }

        if (dryRun) {
          const dryCmd = [...herdrArgs(["pane", "run", paneId, execCmd])].join(" ");
          await writeOut(`[dry-run] ${cliHost}: ${dryCmd}`);
          process.exit(0);
        }

        if (json)
          await writeJson({
            ok: true,
            host: cliHost,
            agent: agentTarget,
            paneId,
            command: execCmd,
          });
        else await writeOut(`Sending to ${agentTarget}@${cliHost} (pane ${paneId}): ${execCmd}`);

        const execResult = await sshExec(resolved, [
          ...herdrArgs(["pane", "run", paneId, execCmd]),
        ]);
        if (!execResult.ok) {
          if (json) await writeJson({ ok: false, error: execResult.output });
          else await writeOut(`Exec failed: ${execResult.output}`);
          process.exit(1);
        }
        if (!json) await writeOut(execResult.output);
        process.exit(0);
      }

      await writeOut(
        `Unknown agent subcommand "${agentSubcommand}". Use: start, stop, restart, upgrade, list, get, explain, rename, wait, manifests, send, attach, ssh, log, or exec.`
      );
      process.exit(2);
    }

    // ── workspace list subcommand ────────────────────────────────────────

    if (command === "workspace" || command === "workspaces") {
      // "workspace list --host <host>" or fall through to existing workspaces command
      const rawPos = Bun.argv.slice(2).filter((a) => !a.startsWith("-"));
      const wsSub =
        rawPos[1] && rawPos[0] === "workspace"
          ? rawPos[1]
          : rawPos[0] === "workspaces"
            ? "default"
            : "default";

      const isPaneRead = wsSub === "pane-read" && cliHost && rawPos[2];
      const isPaneRun = wsSub === "pane-run" && cliHost && rawPos[2];
      const isPaneSend = wsSub === "pane-send" && cliHost && rawPos[2];
      const isPaneGet = wsSub === "pane-get" && cliHost && rawPos[2];
      const isPaneSendKeys = wsSub === "pane-send-keys" && cliHost && rawPos[2];
      const isPaneReportMeta = wsSub === "pane-report-metadata" && cliHost && rawPos[2];
      const isPaneReportAgent = wsSub === "pane-report-agent" && cliHost && rawPos[2];
      const isTermAttach = wsSub === "terminal-attach" && cliHost && rawPos[2];
      const isTermTitle =
        (wsSub === "terminal-title" ||
          wsSub === "terminal-title-set" ||
          wsSub === "terminal-title-clear") &&
        cliHost;
      const isWaitOutput = wsSub === "wait-output" && cliHost && rawPos[2];
      const isWaitAgentStatus = wsSub === "wait-agent-status" && cliHost && rawPos[2];
      const isPluginSub =
        (wsSub === "plugins" ||
          wsSub === "plugin-install" ||
          wsSub === "plugin-uninstall" ||
          wsSub === "plugin-enable" ||
          wsSub === "plugin-disable" ||
          wsSub === "plugin-link" ||
          wsSub === "plugin-unlink" ||
          wsSub === "plugin-config-dir" ||
          wsSub === "plugin-actions" ||
          wsSub === "plugin-action-invoke" ||
          wsSub === "plugin-logs" ||
          wsSub === "plugin-pane-open" ||
          wsSub === "plugin-pane-focus" ||
          wsSub === "plugin-pane-close" ||
          wsSub === "plugin-manifest") &&
        cliHost;

      if (
        (wsSub === "list" || wsSub === "worktrees" || wsSub === "tabs" || wsSub === "panes") &&
        cliHost
      ) {
        const config = discoverHerdrProjectConfig(projectPath);
        if (!config?.enabled) {
          if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
          else await writeOut("No [herdr] profile");
          process.exit(1);
        }
        const full = { ...config, projectPath };
        const doc = (() => {
          if (!config.sourcePath) return null;
          try {
            return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
          } catch {
            return null;
          }
        })();
        const orchConfig = resolveOrchestratorConfig(full, doc);
        const rawHostConfig = orchConfig.remoteHosts[cliHost];
        if (!rawHostConfig) {
          if (json) await writeJson({ ok: false, error: `host "${cliHost}" not configured` });
          else await writeOut(`Unknown host "${cliHost}".`);
          process.exit(1);
        }
        const resolvedHosts = normalizeRemoteHostConfig(
          { [cliHost]: rawHostConfig },
          orchConfig.remoteDefaults
        );
        const resolved = resolvedHosts[cliHost]!;
        const sess = agentSession || config.session || "";

        const isWorktrees = wsSub === "worktrees";
        const isTabs = wsSub === "tabs";
        const isPanes = wsSub === "panes";
        const herdrCmd = isWorktrees ? "worktree" : isTabs ? "tab" : isPanes ? "pane" : "workspace";
        const herdrSub = "list";
        const herdrWsArgs = sess
          ? ["herdr", "--session", sess, herdrCmd, herdrSub]
          : ["herdr", herdrCmd, herdrSub];
        const extraArgs: string[] = [];
        if ((isWorktrees || isTabs || isPanes) && workspace)
          extraArgs.push("--workspace", workspace);
        if (json) extraArgs.push("--json");
        const wsResult = await sshExec(resolved, [...herdrWsArgs, ...extraArgs]);
        if (!wsResult.ok) {
          if (json) await writeJson({ ok: false, error: wsResult.output });
          else await writeOut(`Failed to list workspaces: ${wsResult.output}`);
          process.exit(1);
        }

        if (json) {
          try {
            const parsed = JSON.parse(wsResult.output);
            const resultKey = isWorktrees
              ? "worktrees"
              : isTabs
                ? "tabs"
                : isPanes
                  ? "panes"
                  : "workspaces";
            await writeJson({
              ok: true,
              host: cliHost,
              [resultKey]: isTabs
                ? parsed.result?.tabs || []
                : isPanes
                  ? parsed.result?.panes || []
                  : parsed.result?.workspaces || [],
            });
          } catch {
            await writeJson({ ok: false, error: "invalid JSON" });
          }
        } else {
          try {
            const parsed = JSON.parse(wsResult.output) as {
              result?: {
                workspaces?: Array<{
                  workspace_id?: string;
                  workspace_label?: string;
                  status?: string;
                }>;
                tabs?: Array<{ tab_id?: string; label?: string; active?: boolean }>;
                panes?: Array<{
                  pane_id?: string;
                  agent?: string;
                  agent_status?: string;
                  title?: string;
                }>;
              };
            };
            const items = isTabs
              ? parsed.result?.tabs || []
              : isPanes
                ? parsed.result?.panes || []
                : parsed.result?.workspaces || [];
            const heading = isWorktrees
              ? "Worktrees"
              : isTabs
                ? "Tabs"
                : isPanes
                  ? "Panes"
                  : "Workspaces";
            await writeOut(`${heading} on ${cliHost}${sess ? ` (session ${sess})` : ""}:`);
            if (isTabs) {
              for (const t of items as Array<{
                tab_id?: string;
                label?: string;
                active?: boolean;
              }>) {
                const activeMark = t.active ? " *" : "  ";
                await writeOut(`  ${t.tab_id || "?"}  "${t.label || ""}"${activeMark}`);
              }
            } else if (isPanes) {
              for (const p of items as Array<{
                pane_id?: string;
                agent?: string;
                agent_status?: string;
                title?: string;
              }>) {
                const agent = p.agent || p.title || "";
                await writeOut(`  ${p.pane_id || "?"}  ${agent}  ${p.agent_status || ""}`);
              }
            } else {
              for (const ws of items as Array<{
                workspace_id?: string;
                workspace_label?: string;
                status?: string;
              }>) {
                const name = ws.workspace_label || ws.workspace_id || "?";
                await writeOut(`  ${name}  status=${ws.status || "?"}`);
              }
            }
            if (!items.length) await writeOut("  (none)");
          } catch {
            await writeOut(wsResult.output);
          }
        }
        process.exit(0);
      }

      // pane-read: read output from a specific pane
      if (isPaneRead) {
        const paneId = rawPos[2];
        const sourceFlag = Bun.argv.includes("--source")
          ? Bun.argv[Bun.argv.indexOf("--source") + 1]
          : "recent";
        const linesFlag = (() => {
          const idx = Bun.argv.indexOf("--lines");
          return idx >= 0 ? parseInt(Bun.argv[idx + 1] || "0", 10) : 50;
        })();
        const ansiFlag = Bun.argv.includes("--ansi");

        const config = discoverHerdrProjectConfig(projectPath);
        if (!config?.enabled) {
          if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
          else await writeOut("No [herdr] profile");
          process.exit(1);
        }
        const full = { ...config, projectPath };
        const doc = (() => {
          if (!config.sourcePath) return null;
          try {
            return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
          } catch {
            return null;
          }
        })();
        const orchConfig = resolveOrchestratorConfig(full, doc);
        const rawHostConfig = orchConfig.remoteHosts[cliHost];
        if (!rawHostConfig) {
          if (json) await writeJson({ ok: false, error: `host "${cliHost}" not configured` });
          else await writeOut(`Unknown host "${cliHost}".`);
          process.exit(1);
        }
        const resolvedHosts = normalizeRemoteHostConfig(
          { [cliHost]: rawHostConfig },
          orchConfig.remoteDefaults
        );
        const resolved = resolvedHosts[cliHost]!;
        const sess = agentSession || config.session || "";

        const readArgs = sess
          ? [
              "herdr",
              "--session",
              sess,
              "pane",
              "read",
              paneId,
              "--source",
              sourceFlag,
              "--lines",
              String(linesFlag),
            ]
          : ["herdr", "pane", "read", paneId, "--source", sourceFlag, "--lines", String(linesFlag)];
        if (ansiFlag) readArgs.push("--ansi");

        const readResult = await sshExec(resolved, readArgs as string[]);
        if (!readResult.ok) {
          if (json)
            await writeJson({ ok: false, error: friendlySshError(readResult.output, cliHost) });
          else await writeOut(`Failed: ${friendlySshError(readResult.output, cliHost)}`);
          process.exit(1);
        }

        if (json) {
          await writeJson({
            ok: true,
            host: cliHost,
            paneId,
            source: sourceFlag,
            lines: linesFlag,
            output: readResult.output,
          });
        } else {
          await writeOut(
            `── pane ${paneId}@${cliHost} (source=${sourceFlag}, lines=${linesFlag}) ──`
          );
          await writeOut(readResult.output);
        }
        process.exit(0);
      }

      // pane-get: detailed pane info
      if (isPaneGet) {
        const paneId = rawPos[2];
        const config = discoverHerdrProjectConfig(projectPath);
        if (!config?.enabled) {
          if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
          else await writeOut("No [herdr] profile");
          process.exit(1);
        }
        const full = { ...config, projectPath };
        const doc = (() => {
          if (!config.sourcePath) return null;
          try {
            return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
          } catch {
            return null;
          }
        })();
        const orchConfig = resolveOrchestratorConfig(full, doc);
        const rawHostConfig = orchConfig.remoteHosts[cliHost];
        if (!rawHostConfig) {
          if (json) await writeJson({ ok: false, error: `host "${cliHost}" not configured` });
          else await writeOut(`Unknown host "${cliHost}".`);
          process.exit(1);
        }
        const resolvedHosts = normalizeRemoteHostConfig(
          { [cliHost]: rawHostConfig },
          orchConfig.remoteDefaults
        );
        const resolved = resolvedHosts[cliHost]!;
        const sess = agentSession || config.session || "";

        const getArgs = sess
          ? ["herdr", "--session", sess, "pane", "get", paneId, ...(json ? ["--json"] : [])]
          : ["herdr", "pane", "get", paneId, ...(json ? ["--json"] : [])];

        const getResult = await sshExec(resolved, getArgs as string[]);
        if (!getResult.ok) {
          if (json)
            await writeJson({ ok: false, error: friendlySshError(getResult.output, cliHost) });
          else await writeOut(`Failed: ${friendlySshError(getResult.output, cliHost)}`);
          process.exit(1);
        }

        if (json) {
          try {
            await writeJson({ ok: true, host: cliHost, pane: JSON.parse(getResult.output) });
          } catch {
            await writeJson({ ok: true, host: cliHost, output: getResult.output });
          }
        } else {
          await writeOut(`── pane ${paneId}@${cliHost} ──`);
          await writeOut(getResult.output);
        }
        process.exit(0);
      }

      // pane-report-metadata / pane-report-agent: report state to a pane
      if (isPaneReportMeta || isPaneReportAgent) {
        const paneId = rawPos[2];
        // Pass through all remaining flags after the pane ID
        const flagArgs: string[] = [];
        const raw = Bun.argv.slice(2);
        let foundPane = false;
        for (let i = 0; i < raw.length; i++) {
          if (!foundPane && raw[i] === paneId) {
            foundPane = true;
            continue;
          }
          if (foundPane) flagArgs.push(raw[i]!);
        }

        const config = discoverHerdrProjectConfig(projectPath);
        if (!config?.enabled) {
          if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
          else await writeOut("No [herdr] profile");
          process.exit(1);
        }
        const full = { ...config, projectPath };
        const doc = (() => {
          if (!config.sourcePath) return null;
          try {
            return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
          } catch {
            return null;
          }
        })();
        const orchConfig = resolveOrchestratorConfig(full, doc);
        const rawHostConfig = orchConfig.remoteHosts[cliHost];
        if (!rawHostConfig) {
          if (json) await writeJson({ ok: false, error: `host "${cliHost}" not configured` });
          else await writeOut(`Unknown host "${cliHost}".`);
          process.exit(1);
        }
        const resolvedHosts = normalizeRemoteHostConfig(
          { [cliHost]: rawHostConfig },
          orchConfig.remoteDefaults
        );
        const resolved = resolvedHosts[cliHost]!;
        const sess = agentSession || config.session || "";

        const sub = isPaneReportMeta ? "report-metadata" : "report-agent";
        const reportArgs = sess
          ? ["herdr", "--session", sess, "pane", sub, paneId, ...flagArgs]
          : ["herdr", "pane", sub, paneId, ...flagArgs];

        if (dryRun) {
          await writeOut(`[dry-run] ${cliHost}: ${reportArgs.join(" ")}`);
          process.exit(0);
        }

        const result = await sshExec(resolved, reportArgs as string[]);
        if (!result.ok) {
          if (json) await writeJson({ ok: false, error: friendlySshError(result.output, cliHost) });
          else await writeOut(`Failed: ${friendlySshError(result.output, cliHost)}`);
          process.exit(1);
        }

        if (json) await writeJson({ ok: true, host: cliHost, paneId, action: sub });
        else await writeOut(`✓ reported ${sub} to ${paneId}@${cliHost}`);
        process.exit(0);
      }

      // terminal-attach: interactive — print the command
      if (isTermAttach) {
        const termId = rawPos[2];
        const config = discoverHerdrProjectConfig(projectPath);
        if (!config?.enabled) {
          if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
          else await writeOut("No [herdr] profile");
          process.exit(1);
        }
        const full = { ...config, projectPath };
        const doc = (() => {
          if (!config.sourcePath) return null;
          try {
            return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
          } catch {
            return null;
          }
        })();
        const orchConfig = resolveOrchestratorConfig(full, doc);
        const rawHostConfig = orchConfig.remoteHosts[cliHost];
        if (!rawHostConfig) {
          if (json) await writeJson({ ok: false, error: `host "${cliHost}" not configured` });
          else await writeOut(`Unknown host "${cliHost}".`);
          process.exit(1);
        }
        const resolvedHosts = normalizeRemoteHostConfig(
          { [cliHost]: rawHostConfig },
          orchConfig.remoteDefaults
        );
        const resolved = resolvedHosts[cliHost]!;

        const remoteFlag =
          resolved.port && resolved.port !== 22
            ? `ssh://${resolved.user ? `${resolved.user}@` : ""}${resolved.host}:${resolved.port}`
            : resolved.host;
        const takeFlag = takeover ? " --takeover" : "";
        const cmd = `herdr --remote ${remoteFlag}${takeFlag}`;

        if (json) await writeJson({ ok: true, host: cliHost, terminalId: termId, command: cmd });
        else
          await writeOut(
            `Direct attach to ${termId}@${cliHost}:\n  $ ${cmd}\n  # Then run: herdr terminal attach ${termId}${takeFlag}`
          );
        process.exit(0);
      }

      // terminal-title set/clear: set or clear the terminal window title
      if (isTermTitle) {
        const config = discoverHerdrProjectConfig(projectPath);
        if (!config?.enabled) {
          if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
          else await writeOut("No [herdr] profile");
          process.exit(1);
        }
        const full = { ...config, projectPath };
        const doc = (() => {
          if (!config.sourcePath) return null;
          try {
            return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
          } catch {
            return null;
          }
        })();
        const orchConfig = resolveOrchestratorConfig(full, doc);
        const rawHostConfig = orchConfig.remoteHosts[cliHost];
        if (!rawHostConfig) {
          if (json) await writeJson({ ok: false, error: `host "${cliHost}" not configured` });
          else await writeOut(`Unknown host "${cliHost}".`);
          process.exit(1);
        }
        const resolvedHosts = normalizeRemoteHostConfig(
          { [cliHost]: rawHostConfig },
          orchConfig.remoteDefaults
        );
        const resolved = resolvedHosts[cliHost]!;
        const sess = agentSession || config.session || "";

        const isClear = wsSub === "terminal-title-clear";
        const titleText = isClear ? "" : rawPos[3] || "";
        const titleArgs = isClear
          ? ["terminal", "title", "clear"]
          : ["terminal", "title", "set", titleText];
        const cmdArgs = sess ? ["herdr", "--session", sess, ...titleArgs] : ["herdr", ...titleArgs];

        if (dryRun) {
          await writeOut(`[dry-run] ${cliHost}: ${cmdArgs.join(" ")}`);
          process.exit(0);
        }

        const result = await sshExec(resolved, cmdArgs);
        if (!result.ok) {
          if (json) await writeJson({ ok: false, error: friendlySshError(result.output, cliHost) });
          else await writeOut(`Failed: ${friendlySshError(result.output, cliHost)}`);
          process.exit(1);
        }

        if (json) await writeJson({ ok: true, host: cliHost, title: isClear ? null : titleText });
        else await writeOut(`✓ ${isClear ? "cleared" : `set to "${titleText}"`} on ${cliHost}`);
        process.exit(0);
      }

      // wait-output / wait-agent-status: wait for pane output or agent state
      if (isWaitOutput || isWaitAgentStatus) {
        const paneId = rawPos[2];
        // Pass through all flags after the pane ID
        const flagArgs: string[] = [];
        const raw = Bun.argv.slice(2);
        let foundPane = false;
        for (let i = 0; i < raw.length; i++) {
          if (!foundPane && raw[i] === paneId) {
            foundPane = true;
            continue;
          }
          if (foundPane) flagArgs.push(raw[i]!);
        }

        const config = discoverHerdrProjectConfig(projectPath);
        if (!config?.enabled) {
          if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
          else await writeOut("No [herdr] profile");
          process.exit(1);
        }
        const full = { ...config, projectPath };
        const doc = (() => {
          if (!config.sourcePath) return null;
          try {
            return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
          } catch {
            return null;
          }
        })();
        const orchConfig = resolveOrchestratorConfig(full, doc);
        const rawHostConfig = orchConfig.remoteHosts[cliHost];
        if (!rawHostConfig) {
          if (json) await writeJson({ ok: false, error: `host "${cliHost}" not configured` });
          else await writeOut(`Unknown host "${cliHost}".`);
          process.exit(1);
        }
        const resolvedHosts = normalizeRemoteHostConfig(
          { [cliHost]: rawHostConfig },
          orchConfig.remoteDefaults
        );
        const resolved = resolvedHosts[cliHost]!;
        const sess = agentSession || config.session || "";

        const sub = isWaitAgentStatus ? "wait" : "wait";
        const subSub = isWaitAgentStatus ? "agent-status" : "output";
        const waitArgs = sess
          ? ["herdr", "--session", sess, sub, subSub, paneId, ...flagArgs]
          : ["herdr", sub, subSub, paneId, ...flagArgs];

        if (dryRun) {
          await writeOut(`[dry-run] ${cliHost}: ${waitArgs.join(" ")}`);
          process.exit(0);
        }

        if (!json) await writeOut(`Waiting on ${paneId}@${cliHost}...`);
        const result = await sshExec(resolved, waitArgs as string[]);
        if (!result.ok) {
          if (json) await writeJson({ ok: false, error: friendlySshError(result.output, cliHost) });
          else await writeOut(`Wait failed: ${friendlySshError(result.output, cliHost)}`);
          process.exit(1);
        }

        if (json) await writeJson({ ok: true, host: cliHost, paneId });
        else await writeOut(`✓ matched on ${paneId}@${cliHost}`);
        process.exit(0);
      }

      // plugin subcommands: list, install, uninstall, enable, disable
      if (isPluginSub) {
        const config = discoverHerdrProjectConfig(projectPath);
        if (!config?.enabled) {
          if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
          else await writeOut("No [herdr] profile");
          process.exit(1);
        }
        const full = { ...config, projectPath };
        const doc = (() => {
          if (!config.sourcePath) return null;
          try {
            return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
          } catch {
            return null;
          }
        })();
        const orchConfig = resolveOrchestratorConfig(full, doc);
        const rawHostConfig = orchConfig.remoteHosts[cliHost];
        if (!rawHostConfig) {
          if (json) await writeJson({ ok: false, error: `host "${cliHost}" not configured` });
          else await writeOut(`Unknown host "${cliHost}".`);
          process.exit(1);
        }
        const resolvedHosts = normalizeRemoteHostConfig(
          { [cliHost]: rawHostConfig },
          orchConfig.remoteDefaults
        );
        const resolved = resolvedHosts[cliHost]!;

        let pluginCmd: string[];
        if (wsSub === "plugins") {
          pluginCmd = ["plugin", "list", ...(json ? ["--json"] : [])];
        } else if (wsSub === "plugin-install") {
          const target = rawPos[2] || "";
          if (!target) {
            await writeOut(
              "usage: herdr-orchestrator workspace plugin-install <owner/repo> --host HOST [--ref REF]"
            );
            process.exit(2);
          }
          // --yes is required for non-interactive SSH installs (Herdr shows trust preview interactively)
          pluginCmd = ["plugin", "install", target, "--yes"];
        } else if (wsSub === "plugin-uninstall") {
          const target = rawPos[2] || "";
          if (!target) {
            await writeOut("usage: herdr-orchestrator workspace plugin-uninstall <id> --host HOST");
            process.exit(2);
          }
          pluginCmd = ["plugin", "uninstall", target];
        } else if (wsSub === "plugin-link") {
          const target = rawPos[2] || "";
          if (!target) {
            await writeOut(
              "usage: herdr-orchestrator workspace plugin-link <path> --host HOST [--disabled]"
            );
            process.exit(2);
          }
          const disabled = Bun.argv.includes("--disabled");
          pluginCmd = disabled
            ? ["plugin", "link", target, "--disabled"]
            : ["plugin", "link", target];
        } else if (wsSub === "plugin-unlink") {
          const target = rawPos[2] || "";
          if (!target) {
            await writeOut("usage: herdr-orchestrator workspace plugin-unlink <id> --host HOST");
            process.exit(2);
          }
          pluginCmd = ["plugin", "unlink", target];
        } else if (wsSub === "plugin-enable") {
          const target = rawPos[2] || "";
          if (!target) {
            await writeOut("usage: herdr-orchestrator workspace plugin-enable <id> --host HOST");
            process.exit(2);
          }
          pluginCmd = ["plugin", "enable", target];
        } else if (wsSub === "plugin-config-dir") {
          const target = rawPos[2] || "";
          if (!target) {
            await writeOut(
              "usage: herdr-orchestrator workspace plugin-config-dir <id> --host HOST"
            );
            process.exit(2);
          }
          pluginCmd = ["plugin", "config-dir", target];
        } else if (wsSub === "plugin-actions") {
          const pluginId = rawPos[2] || "";
          pluginCmd = pluginId
            ? ["plugin", "action", "list", "--plugin", pluginId]
            : ["plugin", "action", "list"];
          if (json) pluginCmd.push("--json");
        } else if (wsSub === "plugin-action-invoke") {
          const actionId = rawPos[2] || "";
          if (!actionId) {
            await writeOut(
              "usage: herdr-orchestrator workspace plugin-action-invoke <action_id> --host HOST [--plugin ID]"
            );
            process.exit(2);
          }
          const pluginId = Bun.argv.includes("--plugin")
            ? Bun.argv[Bun.argv.indexOf("--plugin") + 1]
            : "";
          pluginCmd = pluginId
            ? ["plugin", "action", "invoke", actionId, "--plugin", pluginId]
            : ["plugin", "action", "invoke", actionId];
        } else if (wsSub === "plugin-logs") {
          const pluginId = Bun.argv.includes("--plugin")
            ? Bun.argv[Bun.argv.indexOf("--plugin") + 1]
            : "";
          const limitIdx = Bun.argv.indexOf("--limit");
          const limit = limitIdx >= 0 ? Bun.argv[limitIdx + 1] : "";
          pluginCmd = ["plugin", "log", "list"];
          if (pluginId) pluginCmd.push("--plugin", pluginId);
          if (limit) pluginCmd.push("--limit", limit);
          if (json) pluginCmd.push("--json");
        } else if (wsSub === "plugin-pane-open") {
          // Pass through flags after "plugin-pane-open"
          const paneFlags: string[] = [];
          const raw = Bun.argv.slice(2);
          let found = false;
          for (let i = 0; i < raw.length; i++) {
            if (!found && raw[i] === "plugin-pane-open") {
              found = true;
              continue;
            }
            if (found && raw[i]! !== "--host" && raw[i]! !== "--session") paneFlags.push(raw[i]!);
            if (found && (raw[i] === "--host" || raw[i] === "--session")) i++; // skip value
          }
          pluginCmd = ["plugin", "pane", "open", ...paneFlags];
        } else if (wsSub === "plugin-pane-focus") {
          const target = rawPos[2] || "";
          if (!target) {
            await writeOut(
              "usage: herdr-orchestrator workspace plugin-pane-focus <pane_id> --host HOST"
            );
            process.exit(2);
          }
          pluginCmd = ["plugin", "pane", "focus", target];
        } else if (wsSub === "plugin-pane-close") {
          const target = rawPos[2] || "";
          if (!target) {
            await writeOut(
              "usage: herdr-orchestrator workspace plugin-pane-close <pane_id> --host HOST"
            );
            process.exit(2);
          }
          pluginCmd = ["plugin", "pane", "close", target];
        } else {
          const target = rawPos[2] || "";
          if (!target) {
            await writeOut("usage: herdr-orchestrator workspace plugin-disable <id> --host HOST");
            process.exit(2);
          }
          pluginCmd = ["plugin", "disable", target];
        }

        if (dryRun) {
          await writeOut(`[dry-run] ${cliHost}: herdr ${pluginCmd.join(" ")}`);
          process.exit(0);
        }

        const result = await sshExec(resolved, ["herdr", ...pluginCmd]);
        if (!result.ok) {
          if (json) await writeJson({ ok: false, error: friendlySshError(result.output, cliHost) });
          else await writeOut(`Failed: ${friendlySshError(result.output, cliHost)}`);
          process.exit(1);
        }

        if (json) {
          if (wsSub === "plugins" || wsSub === "plugin-actions" || wsSub === "plugin-logs") {
            try {
              await writeJson({ ok: true, host: cliHost, ...JSON.parse(result.output) });
            } catch {
              await writeJson({ ok: true, host: cliHost, output: result.output });
            }
          } else {
            await writeJson({ ok: true, host: cliHost, action: wsSub });
          }
        } else {
          await writeOut(result.output || `✓ plugin ${wsSub.split("-")[1]} on ${cliHost}`);
        }
        process.exit(0);
      }

      // pane-run / pane-send / pane-send-keys: send input to a specific pane
      if (isPaneRun || isPaneSend || isPaneSendKeys) {
        const paneId = rawPos[2];
        const fullArgs = Bun.argv.slice(2);
        const dashIdx = fullArgs.indexOf("--");
        const content = dashIdx >= 0 ? fullArgs.slice(dashIdx + 1).join(" ") : "";
        if (!content) {
          await writeOut(
            `usage: herdr-orchestrator workspace ${wsSub} <pane_id> --host HOST [--session S] -- <content>`
          );
          process.exit(2);
        }

        const config = discoverHerdrProjectConfig(projectPath);
        if (!config?.enabled) {
          if (json) await writeJson({ ok: false, error: "no [herdr] profile" });
          else await writeOut("No [herdr] profile");
          process.exit(1);
        }
        const full = { ...config, projectPath };
        const doc = (() => {
          if (!config.sourcePath) return null;
          try {
            return TOML.parse(readText(config.sourcePath)) as Record<string, unknown>;
          } catch {
            return null;
          }
        })();
        const orchConfig = resolveOrchestratorConfig(full, doc);
        const rawHostConfig = orchConfig.remoteHosts[cliHost];
        if (!rawHostConfig) {
          if (json) await writeJson({ ok: false, error: `host "${cliHost}" not configured` });
          else await writeOut(`Unknown host "${cliHost}".`);
          process.exit(1);
        }
        const resolvedHosts = normalizeRemoteHostConfig(
          { [cliHost]: rawHostConfig },
          orchConfig.remoteDefaults
        );
        const resolved = resolvedHosts[cliHost]!;
        const sess = agentSession || config.session || "";

        const cmd = "pane";
        const sub = isPaneRun ? "run" : isPaneSendKeys ? "send-keys" : "send-text";
        // send-keys splits content into individual key args
        const contentArgs = isPaneSendKeys ? content.split(" ").filter(Boolean) : [content];
        const sendArgs = sess
          ? ["herdr", "--session", sess, cmd, sub, paneId, ...contentArgs]
          : ["herdr", cmd, sub, paneId, ...contentArgs];

        if (dryRun) {
          await writeOut(`[dry-run] ${cliHost}: ${sendArgs.join(" ")}`);
          process.exit(0);
        }

        const result = await sshExec(resolved, sendArgs as string[]);
        if (!result.ok) {
          if (json) await writeJson({ ok: false, error: friendlySshError(result.output, cliHost) });
          else await writeOut(`Failed: ${friendlySshError(result.output, cliHost)}`);
          process.exit(1);
        }

        if (json)
          await writeJson({
            ok: true,
            host: cliHost,
            paneId,
            action: wsSub,
            output: result.output,
          });
        else await writeOut(result.output || `✓ sent to ${paneId}@${cliHost}`);
        process.exit(0);
      }

      // Fall through to existing "workspaces" command below
    }

    if (command === "react" || command === "watch") {
      const resolveTargetIds = (): string[] => {
        if (workspace) return [workspace];
        if (all) {
          const config = discoverHerdrProjectConfig(projectPath);
          if (!config?.enabled) return [];
          return findAllWorkspacesForProject({ ...config, projectPath }).workspaceIds;
        }
        return [];
      };

      const reactOne = async (id?: string) => {
        return reactHerdrOrchestrator(projectPath, {
          forceContext,
          forceHandoff,
          workspaceId: id || workspace,
        });
      };

      if (command === "watch") {
        const interval = Number(Bun.env.HERDR_ORCHESTRATOR_INTERVAL || "15");
        while (true) {
          const ids = resolveTargetIds();
          if (ids.length) {
            for (const id of ids) {
              const result = await reactOne(id);
              if (json) {
                const { workspaceId: _wsId, ...rest } = result;
                await writeJson({ workspaceId: id, ...rest });
              } else {
                for (const action of result.actions)
                  await writeOut(`${id}: ${action.type}: ${action.detail}`);
                for (const warning of result.warnings) await writeOut(`${id}: warn: ${warning}`);
              }
            }
          } else {
            const result = await reactOne();
            if (json) await writeJson(result);
            else {
              for (const action of result.actions)
                await writeOut(`${action.type}: ${action.detail}`);
              for (const warning of result.warnings) await writeOut(`warn: ${warning}`);
            }
          }
          await Bun.sleep(Math.max(5, interval) * 1000);
        }
      }

      // One-shot react (single or --all)
      const ids = resolveTargetIds();
      if (ids.length) {
        const results: Array<{
          workspaceId: string;
          ok: boolean;
          actions: Array<{ type: string; detail: string }>;
          warnings: string[];
        }> = [];
        let allOk = true;

        // Build state map for cross-workspace handoff rules
        const stateMap = new Map<string, OrchestratorState | null>();
        const allAgents: AgentSnapshot[] = [];
        for (const id of ids) {
          const result = await reactOne(id);
          results.push({
            workspaceId: id,
            ok: result.ok,
            actions: result.actions,
            warnings: result.warnings,
          });
          if (!result.ok) allOk = false;
          if (!json) {
            await writeOut(`── ${id} ──`);
            for (const action of result.actions) await writeOut(`${action.type}: ${action.detail}`);
            for (const warning of result.warnings) await writeOut(`warn: ${warning}`);
          }
          // Collect agents + state for cross-workspace evaluation
          const xwSession = discoverHerdrProjectConfig(projectPath)?.session ?? "";
          allAgents.push(...listWorkspaceAgents(id, xwSession).agents);
          stateMap.set(id, readState(projectPath, id));
        }

        // Cross-workspace (and cross-session) handoff rules
        const xwConfig = discoverHerdrProjectConfig(projectPath);
        if (xwConfig?.enabled) {
          const fullConfig = { ...xwConfig, projectPath };
          const doc = (() => {
            if (!xwConfig.sourcePath) return null;
            try {
              return TOML.parse(readText(xwConfig.sourcePath)) as Record<string, unknown>;
            } catch {
              return null;
            }
          })();
          const orchConfig = resolveOrchestratorConfig(fullConfig, doc);
          const defaultSession = xwConfig.session ?? "";

          if (orchConfig.handoffRules.length > 0) {
            // Collect agents from ALL sessions referenced in rules
            const sessionSet = new Set<string>();
            for (const rule of orchConfig.handoffRules) {
              sessionSet.add(rule.fromSession || defaultSession);
              sessionSet.add(rule.toSession || rule.fromSession || defaultSession);
            }

            const sessionAgents = new Map<string, AgentSnapshot[]>();
            const sessionLabels = new Map<string, Map<string, Map<string, string>>>();
            for (const sess of sessionSet) {
              const parsed = parseHostSession(sess);
              const agents: AgentSnapshot[] = [];

              if (parsed.host) {
                // Remote session — use SSH discovery
                const resolvedHosts = normalizeRemoteHostConfig(
                  orchConfig.remoteHosts,
                  orchConfig.remoteDefaults
                );
                const resolved = resolvedHosts[parsed.host];
                if (resolved) {
                  const remoteAgents = await discoverRemoteWorkspaceAgents(
                    parsed.host,
                    resolved,
                    parsed.session
                  );
                  for (const ra of remoteAgents) {
                    agents.push({
                      paneId: ra.paneId,
                      agent: ra.agent,
                      status: ra.status,
                      workspaceId: ra.workspaceId,
                      tabId: ra.tabId,
                      customStatus: ra.customStatus,
                    });
                  }
                }
              } else {
                // Local session
                const wsRaw = herdrCliJson(parsed.session, ["workspace", "list"]);
                const workspaces = wsRaw.ok
                  ? (wsRaw.json as { result?: { workspaces?: Array<{ workspace_id: string }> } })
                      ?.result?.workspaces || []
                  : [];
                for (const ws of workspaces) {
                  agents.push(...listWorkspaceAgents(ws.workspace_id!, parsed.session).agents);
                }
              }
              sessionAgents.set(sess, agents);

              const labelMap = new Map<string, Map<string, string>>();
              if (parsed.host) {
                // Remote labels — use SSH (reuse normalized hosts from agent collection above)
                const resolvedForLabels = normalizeRemoteHostConfig(
                  orchConfig.remoteHosts,
                  orchConfig.remoteDefaults
                )[parsed.host];
                if (resolvedForLabels) {
                  const labelResult = await sshExec(resolvedForLabels, [
                    "herdr",
                    "--session",
                    parsed.session,
                    "agent",
                    "list",
                    "--json",
                  ]);
                  if (labelResult.ok) {
                    try {
                      const labelParsed = JSON.parse(labelResult.output) as {
                        result?: {
                          agents?: Array<{ agent?: string; name?: string; workspace_id?: string }>;
                        };
                      };
                      for (const r of labelParsed.result?.agents || []) {
                        if (r.workspace_id && r.name && r.agent && r.name !== r.agent) {
                          let ws = labelMap.get(r.workspace_id);
                          if (!ws) {
                            ws = new Map();
                            labelMap.set(r.workspace_id, ws);
                          }
                          ws.set(r.name, r.agent);
                        }
                      }
                    } catch {
                      /* skip */
                    }
                  }
                }
              } else {
                const labelRaw = herdrCliJson(parsed.session, ["agent", "list"]);
                if (labelRaw.ok) {
                  for (const r of (labelRaw.json?.result?.agents || []) as Array<{
                    agent?: string;
                    name?: string;
                    workspace_id?: string;
                  }>) {
                    if (r.workspace_id && r.name && r.agent && r.name !== r.agent) {
                      let ws = labelMap.get(r.workspace_id);
                      if (!ws) {
                        ws = new Map();
                        labelMap.set(r.workspace_id, ws);
                      }
                      ws.set(r.name, r.agent);
                    }
                  }
                }
              }
              sessionLabels.set(sess, labelMap);
            }

            // Evaluate rules — each rule may span sessions
            let ri = 0;
            for (const rule of orchConfig.handoffRules) {
              ri++;
              const fromSess = rule.fromSession || defaultSession;
              const toSess = rule.toSession || rule.fromSession || defaultSession;
              const allSessAgents = [
                ...(sessionAgents.get(fromSess) || []),
                ...(sessionAgents.get(toSess) || []),
              ];
              const fromLabels = sessionLabels.get(fromSess);
              const toLabels = sessionLabels.get(toSess);
              // Merge label maps
              const mergedLabels = new Map<string, Map<string, string>>();
              for (const [k, v] of fromLabels || new Map()) mergedLabels.set(k, v);
              for (const [k, v] of toLabels || new Map()) mergedLabels.set(k, v);

              const sessStateMap = new Map<string, OrchestratorState | null>();

              const xwResults = await evaluateCrossWorkspaceHandoffs(
                { ...orchConfig, handoffRules: [rule] },
                allSessAgents,
                sessStateMap,
                toSess,
                mergedLabels.size > 0 ? mergedLabels : undefined,
                dryRun,
                { projectRoot: projectPath, home: homeDir() }
              );

              const prefix =
                fromSess !== toSess
                  ? `[${fromSess}→${toSess}] `
                  : fromSess !== defaultSession
                    ? `[${fromSess}] `
                    : "";
              for (const xw of xwResults) {
                await recordHandoffRuleEvaluation({
                  rule,
                  ruleIndex: ri,
                  detail: xw.detail,
                  ok: xw.ok,
                  trigger: dryRun ? "manual" : "react",
                  fromSession: fromSess,
                  toSession: toSess,
                  dryRun,
                  durationMs: xw.durationMs,
                  context: {
                    targetStrategy: rule.targetStrategy ?? "fixed",
                    when: rule.when?.map((row) => `${row.path}=${JSON.stringify(row.expected)}`),
                    evalDurationMs: xw.durationMs,
                  },
                });

                // Fire-and-forget webhook if configured
                const nc = orchConfig.notifications;
                if (nc?.webhookUrl) {
                  const isSpawn =
                    xw.detail.includes("spawned") || xw.detail.includes("spawn-fallback");
                  const isError = !xw.ok;
                  if (
                    (xw.ok && !isSpawn && nc.onHandoff) ||
                    (isSpawn && nc.onSpawn) ||
                    (isError && nc.onError)
                  ) {
                    const eventType = xw.detail.includes("spawned")
                      ? "spawn"
                      : xw.detail.includes("spawn-fallback")
                        ? "spawn-fallback"
                        : dryRun
                          ? "dry-run"
                          : "handoff";
                    notifyWebhook(nc.webhookUrl, {
                      type: eventType,
                      timestamp: new Date().toISOString(),
                      fromAgent: rule.fromAgent,
                      fromWorkspace: rule.fromWorkspace,
                      fromHost: fromSess,
                      toAgent: rule.toAgent,
                      toWorkspace: rule.toWorkspace,
                      toHost: toSess,
                      condition: rule.condition,
                      detail: xw.detail,
                      ok: xw.ok,
                    });
                  }
                }
                if (xw.ok) {
                  if (json)
                    results.push({
                      workspaceId: "cross-workspace",
                      ok: true,
                      actions: [{ type: "cross_handoff", detail: `${prefix}${xw.detail}` }],
                      warnings: [],
                    });
                  else await writeOut(`cross-handoff: ${prefix}${xw.detail}`);
                } else {
                  if (!json) await writeOut(`cross-handoff skipped: ${prefix}${xw.detail}`);
                }
              }

              // Validate restore readiness for target in to-session
              const toAgents = sessionAgents.get(toSess) || [];
              const toAgentSessionMap = new Map<string, string>();
              const toSessParsed = parseHostSession(toSess);
              const toResolved = toSessParsed.host
                ? normalizeRemoteHostConfig(orchConfig.remoteHosts, orchConfig.remoteDefaults)[
                    toSessParsed.host
                  ]
                : null;
              if (toSessParsed.host && toResolved) {
                const agentResult = await sshExec(toResolved, [
                  "herdr",
                  "--session",
                  toSessParsed.session,
                  "agent",
                  "list",
                  "--json",
                ]);
                if (agentResult.ok) {
                  try {
                    const parsed = JSON.parse(agentResult.output) as {
                      result?: {
                        agents?: Array<{ pane_id?: string; agent_session?: { source?: string } }>;
                      };
                    };
                    for (const r of parsed.result?.agents || []) {
                      if (r.pane_id && r.agent_session?.source)
                        toAgentSessionMap.set(r.pane_id, r.agent_session.source);
                    }
                  } catch {
                    /* skip */
                  }
                }
              } else {
                const rawForSess = herdrCliJson(toSessParsed.session, ["agent", "list"]);
                if (rawForSess.ok) {
                  for (const r of (rawForSess.json?.result?.agents || []) as Array<{
                    pane_id?: string;
                    agent_session?: { source?: string };
                  }>) {
                    if (r.pane_id && r.agent_session?.source)
                      toAgentSessionMap.set(r.pane_id, r.agent_session.source);
                  }
                }
              }

              let integVersions: Map<string, { version: number; status: string }>;
              if (toSessParsed.host && toResolved) {
                const integResult = await sshExec(toResolved, [
                  "herdr",
                  "--session",
                  toSessParsed.session,
                  "integration",
                  "status",
                ]);
                integVersions = integResult.ok
                  ? parseIntegrationStatus(integResult.output)
                  : new Map();
              } else if (toSessParsed.host) {
                integVersions = new Map();
              } else {
                const integRaw = herdrCliRun(toSessParsed.session, ["integration", "status"]);
                integVersions = integRaw.ok ? parseIntegrationStatus(integRaw.output) : new Map();
              }

              const getReadiness = getRestoreReadiness(toAgentSessionMap, integVersions);
              const resolvedToAgent = toAgents.find(
                (a) => a.workspaceId === rule.toWorkspace && a.agent === rule.toAgent
              );
              if (resolvedToAgent) {
                const info = getReadiness(resolvedToAgent.paneId, resolvedToAgent.agent);
                if (info.restore === "none") {
                  const msg = `handoff target ${rule.toAgent} (${rule.toWorkspace}) is not restorable`;
                  if (!json) await writeOut(`warn: ${prefix}${msg}`);
                  else
                    results.push({
                      workspaceId: "validation",
                      ok: true,
                      actions: [],
                      warnings: [`${prefix}${msg}`],
                    });
                }
              }
            }
          }
        }

        if (json) await writeJson({ ok: allOk, projectPath, results });
        process.exit(allOk ? 0 : 2);
      }

      const result = await reactOne();
      if (json) await writeJson(result);
      else {
        for (const action of result.actions) await writeOut(`${action.type}: ${action.detail}`);
        for (const warning of result.warnings) await writeOut(`warn: ${warning}`);
      }
      process.exit(result.ok ? 0 : 2);
    }

    if (command === "bootstrap") {
      if (!cliHost) {
        if (json) await writeJson({ ok: false, error: "missing --host <ssh-label>" });
        else
          await writeOut(
            "Usage: herdr-orchestrator bootstrap --host <ssh-label> [--verify] [--domain <name>] [--interval <sec>] [--ref <git-ref>] [--repo <owner/repo/path>] [--no-start]"
          );
        process.exit(1);
      }

      const pluginRoot = resolveOrchestratorPluginRoot();
      if (!pluginRoot) {
        if (json) await writeJson({ ok: false, error: "herdr-orchestrator plugin not installed" });
        else {
          await writeOut("herdr-orchestrator plugin not installed.");
          await writeOut("Install it with:");
          await writeOut(
            "  herdr plugin install brendadeeznuts1111/herdr-plugins/herdr-orchestrator"
          );
        }
        process.exit(1);
      }

      const runSh = join(pluginRoot, "run.sh");
      const passthrough = Bun.argv.slice(3); // everything after "herdr-orchestrator bootstrap"
      const code = await handoffInheritedSpawn([
        "bash",
        runSh,
        "src/actions/bootstrap.ts",
        ...passthrough,
      ]);
      process.exit(code);
    }

    await printHelp();
    process.exit(2);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) await writeJson({ ok: false, error: message });
    else await writeOut(message);
    process.exit(1);
  }
}
