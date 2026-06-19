/**
 * Card probe CLI orchestration — shared by kimi-doctor flags.
 */

import { runCardProbeGate, type CardProbeGateResult } from "../gates/card-probe.ts";
import {
  type CardProbeConfig,
  type CardStatus,
  formatCardProbeTable,
  probeAllCards,
  summarizeCardStatuses,
} from "./card-probe.ts";
import {
  PROBE_SERVER_ROUTES,
  startProbeServer,
  unhealthyCardStatuses,
} from "./card-probe-server.ts";

export interface CardProbeSummary {
  total: number;
  pass: number;
  fail: number;
  unknown: number;
}

export interface CardProbeCliOptions {
  /** One-shot probe, long-running server, or start server + probe once then exit. */
  mode: "probe-cards" | "serve-probe" | "serve-probe-once";
  json?: boolean;
  strict?: boolean;
  saveArtifact?: boolean;
  projectRoot?: string;
  probeConfig?: CardProbeConfig;
  log?: (line: string) => void;
}

export interface CardProbeCliResult {
  exitCode: number;
  statuses: CardStatus[];
  url?: string;
  summary: ReturnType<typeof summarizeCardStatuses>;
  /** Structured payload when `json` is true — emit on stdout from the caller. */
  payload?: Record<string, unknown>;
}

export function buildCardProbeJsonPayload(
  mode: string,
  statuses: CardStatus[],
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    tool: "kimi-doctor",
    mode,
    summary: summarizeCardStatuses(statuses),
    statuses,
    fetchedAt: new Date().toISOString(),
    ...extra,
  };
}

function probeConfigFromOptions(options: CardProbeCliOptions): CardProbeConfig {
  return {
    examplesDashboardUrl:
      options.probeConfig?.examplesDashboardUrl ?? Bun.env.EXAMPLES_DASHBOARD_URL,
    herdrDashboardUrl: options.probeConfig?.herdrDashboardUrl ?? Bun.env.HERDR_DASHBOARD_URL,
    timeoutMs: options.probeConfig?.timeoutMs,
  };
}

function exitCodeForStatuses(statuses: CardStatus[], strict: boolean): number {
  const unhealthy = unhealthyCardStatuses(statuses);
  if (strict && unhealthy.length > 0) return 1;
  return 0;
}

function logProbeSummary(
  log: ((line: string) => void) | undefined,
  summary: ReturnType<typeof summarizeCardStatuses>,
  strict: boolean
): void {
  if (!log) return;
  log(
    `Card probes: ${summary.pass} pass · ${summary.fail} fail · ${summary.unknown} unknown (${summary.total} total)`
  );
  if (strict && summary.fail + summary.unknown > 0) {
    log("Strict mode: exiting 1 because at least one card is not pass");
  } else if (summary.unknown > 0) {
    log(
      "Hint: set EXAMPLES_DASHBOARD_URL / HERDR_DASHBOARD_URL or start dashboards on ports 3000 / 18412"
    );
  }
}

/** Run `--probe-cards`, `--serve-probe`, or combined CI health-check mode. */
export async function runCardProbeCli(options: CardProbeCliOptions): Promise<CardProbeCliResult> {
  const strict = options.strict === true;
  const probeConfig = probeConfigFromOptions(options);
  const log = options.log;
  const json = options.json === true;

  if (options.mode === "serve-probe-once") {
    const handle = await startProbeServer({ probeConfig });
    const statuses = handle.getCached();
    const summary = summarizeCardStatuses(statuses);
    const payload = buildCardProbeJsonPayload("serve-probe", statuses, { url: handle.url });

    if (json) {
      /* caller emits payload */
    } else {
      log?.(`Probe server warmed at ${handle.url}`);
      log?.(formatCardProbeTable(statuses));
      logProbeSummary(log, summary, strict);
    }

    handle.stop();
    return {
      exitCode: exitCodeForStatuses(statuses, strict),
      statuses,
      url: handle.url,
      summary,
      payload: json ? payload : undefined,
    };
  }

  if (options.mode === "serve-probe") {
    const handle = await startProbeServer({ probeConfig });
    const statuses = handle.getCached();
    const summary = summarizeCardStatuses(statuses);
    const payload = buildCardProbeJsonPayload("serve-probe", statuses, {
      url: handle.url,
      routes: PROBE_SERVER_ROUTES.map((route) => ({
        path: route.path,
        methods: [...route.methods],
      })),
    });

    if (!json) {
      log?.(`Card probe server listening at ${handle.url}`);
      log?.("Routes: GET|HEAD /api/health · GET /api/cards · GET|POST /api/refresh");
      logProbeSummary(log, summary, false);
    }

    while (true) {
      await Bun.sleep(86_400_000);
    }
    return { exitCode: 0, statuses, url: handle.url, summary, payload: json ? payload : undefined };
  }

  const gateResult = (await runCardProbeGate({
    projectRoot: options.projectRoot ?? process.cwd(),
    probeConfig,
    saveArtifact: options.saveArtifact,
    strict,
  })) as CardProbeGateResult;
  const statuses = gateResult.statuses;
  const summary = gateResult.summary;
  const payload = buildCardProbeJsonPayload("probe-cards", statuses, {
    artifactPath: gateResult.artifactPath,
  });

  if (json) {
    /* caller emits payload */
  } else {
    log?.(formatCardProbeTable(statuses));
    logProbeSummary(log, summary, strict);
    if (options.saveArtifact && gateResult.artifactPath) {
      log?.(`  Artifact: ${gateResult.artifactPath}`);
    }
  }

  return {
    exitCode: exitCodeForStatuses(statuses, strict),
    statuses,
    summary,
    payload: json ? payload : undefined,
  };
}
