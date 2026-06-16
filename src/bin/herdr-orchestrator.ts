#!/usr/bin/env bun
import { discoverHerdrProjectConfig } from "../lib/herdr-project-config.ts";
import { syncAgentsTabContext } from "../lib/herdr-project-context.ts";
import { reactHerdrOrchestrator, orchestratorStatus } from "../lib/herdr-orchestrator.ts";
import { Effect } from "effect";
import { watchOrchestratorEventsEffect } from "../lib/herdr-orchestrator-events.ts";
import { findWorkspaceForProject, resolveHerdrProjectPath } from "../lib/herdr-project-runner.ts";
import { escalateFinishWorkToReviewer, type FinishWorkReport } from "../lib/finish-work-herdr.ts";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv: string[]) {
  const args = [...argv];
  return {
    json: args.includes("--json"),
    forceContext: args.includes("--force-context"),
    forceHandoff: args.includes("--force-handoff"),
    help: args.includes("--help") || args.includes("-h"),
    command: args.find((arg) => !arg.startsWith("-")) || "react",
    path: args.filter((arg) => !arg.startsWith("-"))[1] || process.cwd(),
  };
}

function writeOut(line = "") {
  process.stdout.write(`${line}\n`);
}

function writeJson(value: unknown) {
  writeOut(JSON.stringify(value, null, 2));
}

function printHelp() {
  writeOut(`herdr-orchestrator <command> [path] [flags]

Commands:
  react          React to agent state transitions (context sync, handoff, reviewer)
  status         Show orchestrator config and live agent snapshot
  context-sync   Force agentsTab context delivery now
  escalate       Escalate pending finish-work report to reviewer tab
  watch-events   Subscribe to Herdr events and react (context-sync / handoff)

Flags:
  --json            JSON output
  --force-context   Run context sync even without idle transition
  --force-handoff   Send handoff even without idle transition
`);
}

const {
  json,
  forceContext,
  forceHandoff,
  help,
  command,
  path: rawPath,
} = parseArgs(process.argv.slice(2));

if (help) {
  printHelp();
  process.exit(0);
}

try {
  const projectPath = resolveHerdrProjectPath(rawPath);

  if (command === "status") {
    const status = orchestratorStatus(projectPath);
    if (!status) {
      if (json) writeJson({ ok: false, error: "no [herdr] profile" });
      else writeOut("No [herdr] profile");
      process.exit(1);
    }
    if (json) writeJson({ ok: true, projectPath, ...status });
    else {
      writeOut(`Orchestrator: ${status.config.enabled ? "enabled" : "disabled"}`);
      writeOut(`Handoff: ${status.config.handoffFrom || "-"} → ${status.config.handoffTo || "-"}`);
      writeOut(`Context on idle: ${status.config.contextOnIdle}`);
      writeOut(
        `Events: ${status.config.events.enabled ? "enabled" : "disabled"} (debounce ${status.config.events.debounceMs}ms)`
      );
      for (const agent of status.agents) {
        writeOut(`- ${agent.agent} (${agent.paneId}): ${agent.status}`);
      }
    }
    process.exit(0);
  }

  if (command === "context-sync") {
    const config = discoverHerdrProjectConfig(projectPath);
    if (!config?.enabled) process.exit(1);
    const full = { ...config, projectPath };
    const match = findWorkspaceForProject(full);
    const sync = syncAgentsTabContext(full, full.agentsTab?.panes, match.workspaceId);
    if (json)
      writeJson({
        ok: sync.warnings.length === 0,
        delivered: sync.delivered,
        contextFile: sync.contextFile,
        warnings: sync.warnings,
      });
    else {
      for (const row of sync.delivered) writeOut(`delivered ${row.agent} (${row.bytes} bytes)`);
      if (sync.contextFile) writeOut(`context file: ${sync.contextFile}`);
      for (const warning of sync.warnings) writeOut(`warn: ${warning}`);
    }
    process.exit(sync.warnings.length ? 2 : 0);
  }

  if (command === "escalate") {
    const reportPath = join(projectPath, ".kimi", "finish-work-report.json");
    if (!existsSync(reportPath)) {
      if (json) writeJson({ ok: false, error: "no finish-work report" });
      process.exit(1);
    }
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as FinishWorkReport;
    const result = await escalateFinishWorkToReviewer(projectPath, report);
    if (json) writeJson({ ok: Boolean(result.herdr?.escalated), herdr: result.herdr });
    else
      writeOut(
        result.herdr?.escalated
          ? `escalated ${result.herdr.reviewerPaneId}`
          : result.herdr?.error || "not escalated"
      );
    process.exit(result.herdr?.escalated ? 0 : 2);
  }

  if (command === "watch-events") {
    const controller = new AbortController();
    const onSignal = () => controller.abort();
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    try {
      const result = await Effect.runPromise(
        watchOrchestratorEventsEffect(projectPath, {
          json,
          signal: controller.signal,
        })
      );
      if (json) writeJson(result);
      process.exit(result.ok ? 0 : 2);
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
  }

  if (command === "react" || command === "watch") {
    if (command === "watch") {
      const interval = Number(process.env.HERDR_ORCHESTRATOR_INTERVAL || "15");
      while (true) {
        const result = await reactHerdrOrchestrator(projectPath, { forceContext, forceHandoff });
        if (json) writeJson(result);
        else {
          for (const action of result.actions) writeOut(`${action.type}: ${action.detail}`);
          for (const warning of result.warnings) writeOut(`warn: ${warning}`);
        }
        await Bun.sleep(Math.max(5, interval) * 1000);
      }
    }

    const result = await reactHerdrOrchestrator(projectPath, { forceContext, forceHandoff });
    if (json) writeJson(result);
    else {
      for (const action of result.actions) writeOut(`${action.type}: ${action.detail}`);
      for (const warning of result.warnings) writeOut(`warn: ${warning}`);
    }
    process.exit(result.ok ? 0 : 2);
  }

  printHelp();
  process.exit(2);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (json) writeJson({ ok: false, error: message });
  else writeOut(message);
  process.exit(1);
}
