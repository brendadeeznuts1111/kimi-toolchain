/**
 * Card probe CLI orchestration — shared by kimi-doctor flags.
 */

import {
  cardProbeGateDefinition,
  runCardProbeGate,
  type CardProbeGateResult,
} from "../gates/card-probe.ts";
import { persistGateArtifact } from "../gates/runner.ts";
import { ArtifactStore } from "./artifact-store.ts";
import {
  type CardProbeConfig,
  type CardStatus,
  formatCardProbeTable,
  summarizeCardStatuses,
} from "./card-probe.ts";
import {
  PROBE_SERVER_ROUTES,
  startProbeServer,
  unhealthyCardStatuses,
} from "./card-probe-server.ts";
import { readDoctorProbeConfig } from "./doctor-probe-config.ts";

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
  /** kimi-doctor --perf-gates --serve-probe: expose /api/effect-benchmark */
  effectBenchmark?: boolean;
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
      "Hint: set EXAMPLES_DASHBOARD_URL / HERDR_DASHBOARD_URL or start dashboards on ports 5678 / 18412"
    );
  }
}

/** Run `--probe-cards`, `--serve-probe`, or combined CI health-check mode. */
export async function runCardProbeCli(options: CardProbeCliOptions): Promise<CardProbeCliResult> {
  const strict = options.strict === true;
  const probeConfig = probeConfigFromOptions(options);
  const log = options.log;
  const json = options.json === true;

  const projectRoot = options.projectRoot ?? process.cwd();
  const doctorProbe = await readDoctorProbeConfig(projectRoot);
  const serverOptions = {
    probeConfig,
    projectRoot,
    saveArtifact: options.saveArtifact,
    strict,
    host: doctorProbe.host,
    port: doctorProbe.port,
    refreshIntervalMs: doctorProbe.intervalMs,
    effectBenchmark: options.effectBenchmark === true,
  };

  if (options.mode === "serve-probe-once") {
    const handle = await startProbeServer(serverOptions);
    const statuses = handle.getCached();
    const summary = summarizeCardStatuses(statuses);
    const payload = buildCardProbeJsonPayload("serve-probe", statuses, {
      url: handle.url,
      saveArtifact: options.saveArtifact === true,
      artifactPath: handle.getLastArtifactPath(),
      configStatus: handle.getConfigStatus(),
    });

    if (json) {
      /* caller emits payload */
    } else {
      log?.(`Probe server warmed at ${handle.url}`);
      if (options.saveArtifact && handle.getLastArtifactPath()) {
        log?.(`  Artifact: ${handle.getLastArtifactPath()}`);
      }
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
    const handle = await startProbeServer(serverOptions);
    const statuses = handle.getCached();
    const summary = summarizeCardStatuses(statuses);
    const payload = buildCardProbeJsonPayload("serve-probe", statuses, {
      url: handle.url,
      saveArtifact: options.saveArtifact === true,
      artifactPath: handle.getLastArtifactPath(),
      configStatus: handle.getConfigStatus(),
      routes: PROBE_SERVER_ROUTES.map((route) => ({
        path: route.path,
        methods: [...route.methods],
      })),
    });

    if (!json) {
      log?.(`Card probe server listening at ${handle.url}`);
      const benchmarkRoutes = options.effectBenchmark
        ? " · GET /api/effect-benchmark · POST /api/effect-benchmark/refresh"
        : "";
      log?.(
        `Routes: GET|HEAD /api/health · GET /api/cards · GET|POST /api/refresh · GET /api/artifacts[/{gate}[/latest]]${benchmarkRoutes}`
      );
      if (options.saveArtifact && handle.getLastArtifactPath()) {
        log?.(`  Artifact: ${handle.getLastArtifactPath()}`);
      }
      logProbeSummary(log, summary, false);
    }

    while (true) {
      await Bun.sleep(86_400_000);
    }
    return { exitCode: 0, statuses, url: handle.url, summary, payload: json ? payload : undefined };
  }

  let gateResult = await runCardProbeGate({
    projectRoot,
    probeConfig,
    strict,
    saveArtifact: false,
  });
  if (options.saveArtifact) {
    const store = new ArtifactStore(projectRoot);
    gateResult = (await persistGateArtifact(
      cardProbeGateDefinition,
      gateResult,
      [],
      [],
      store
    )) as CardProbeGateResult;
  }
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
