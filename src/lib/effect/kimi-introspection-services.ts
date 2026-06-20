/**
 * Effect services for agent-internal introspection.
 *
 * CLI commands remain the human/script boundary. These Context services expose
 * the same capabilities, trace, and contract implementations to Effect programs
 * without shelling out.
 */

import { Context, Data, Effect, Layer } from "effect";
import { isAbsolute, resolve } from "path";
import {
  runCapabilityAggregator,
  type CapabilityReport,
  type CapabilityStatus,
} from "../capabilities.ts";
import {
  signContractEffect,
  validateContractEffect,
  type ContractError,
  type ContractSignatureEnvelope,
  type ContractTrustStatus,
  type ContractValidationResult,
} from "../contract-signing.ts";
import { buildTraceGraph, type TraceGraph, type TraceGraphNode } from "../trace-ledger.ts";
import { resolveProjectRoot } from "../utils.ts";

export interface KimiIntrospectionConfigValue {
  readonly projectRoot: string;
}

export interface KimiIntrospectionOptions {
  readonly projectRoot?: string;
}

export class KimiIntrospectionConfig extends Context.Tag("KimiIntrospectionConfig")<
  KimiIntrospectionConfig,
  KimiIntrospectionConfigValue
>() {}

export interface CapabilityItem {
  readonly name: string;
  readonly status: CapabilityStatus;
  readonly message: string;
  readonly lastContact: string | null;
  readonly latencyMs: number | null;
}

export interface CapabilityProbeResult {
  readonly readiness: number;
  readonly readinessScore: number;
  readonly items: readonly CapabilityItem[];
  readonly report: CapabilityReport;
}

export class KimiCapabilities extends Context.Tag("KimiCapabilities")<
  KimiCapabilities,
  {
    /** Run all health checks in parallel and return readiness + normalized items. */
    readonly probe: () => Effect.Effect<CapabilityProbeResult, never>;
  }
>() {}

export class TraceNotFound extends Data.TaggedError("TraceNotFound")<{
  traceId: string;
}> {}

export class TraceReadError extends Data.TaggedError("TraceReadError")<{
  traceId: string;
  message: string;
}> {}

export interface TraceStep {
  readonly id: string;
  readonly parentTraceId?: string;
  readonly description: string;
  readonly status: TraceGraphNode["status"];
  readonly durationMs: number;
  readonly error?: string;
}

export interface TraceServiceResult {
  readonly rootTraceId: string;
  readonly requestedTraceId: string;
  readonly steps: readonly TraceStep[];
  readonly rootCauseChain: readonly string[];
  readonly graph: TraceGraph;
}

export class KimiTrace extends Context.Tag("KimiTrace")<
  KimiTrace,
  {
    /** Fetch the full causal trace tree for a given trace id. */
    readonly trace: (
      traceId: string
    ) => Effect.Effect<TraceServiceResult, TraceNotFound | TraceReadError>;
  }
>() {}

export class ContractValidationError extends Data.TaggedError("ContractValidationError")<{
  path: string;
  message: string;
}> {}

export class MissingSigningKey extends Data.TaggedError("MissingSigningKey")<{
  message: string;
}> {}

export interface ContractServiceValidationResult {
  readonly status: ContractTrustStatus;
  readonly trusted: boolean;
  readonly recognizedSigner?: string;
  readonly result: ContractValidationResult;
}

export class KimiContract extends Context.Tag("KimiContract")<
  KimiContract,
  {
    /** Validate a contract file by path. Checks normalized shape and signature trust. */
    readonly validate: (
      contractPath: string,
      strict?: boolean
    ) => Effect.Effect<ContractServiceValidationResult, ContractValidationError>;
    /** Sign a contract with the active project key from env or KIMI_SIGNING_KEY_FILE. */
    readonly sign: (
      contractPath: string,
      keyId: string
    ) => Effect.Effect<ContractSignatureEnvelope, MissingSigningKey | ContractError>;
  }
>() {}

export function KimiIntrospectionConfigLive(options: KimiIntrospectionOptions = {}) {
  return Layer.effect(
    KimiIntrospectionConfig,
    options.projectRoot
      ? Effect.succeed({ projectRoot: options.projectRoot })
      : Effect.promise(async () => ({ projectRoot: await resolveProjectRoot() }))
  );
}

export const makeKimiCapabilitiesLive = Layer.effect(
  KimiCapabilities,
  Effect.map(KimiIntrospectionConfig, (config) => ({
    probe: () => probeCapabilities(config.projectRoot),
  }))
);

export const makeKimiTraceLive = Layer.succeed(KimiTrace, {
  trace: (traceId: string) => traceById(traceId),
});

export const makeKimiContractLive = Layer.effect(
  KimiContract,
  Effect.map(KimiIntrospectionConfig, (config) => ({
    validate: (contractPath: string, strict = false) =>
      validateContractService(contractPath, config.projectRoot, strict),
    sign: (contractPath: string, keyId: string) =>
      signContractService(contractPath, keyId, config.projectRoot),
  }))
);

export function KimiIntrospectionLiveFor(options: KimiIntrospectionOptions = {}) {
  return Layer.mergeAll(makeKimiCapabilitiesLive, makeKimiTraceLive, makeKimiContractLive).pipe(
    Layer.provide(KimiIntrospectionConfigLive(options))
  );
}

export const KimiIntrospectionLive = KimiIntrospectionLiveFor();

function probeCapabilities(projectRoot: string): Effect.Effect<CapabilityProbeResult, never> {
  return runCapabilityAggregator(projectRoot).pipe(
    Effect.map(toCapabilityProbeResult),
    Effect.catchAll((cause) => Effect.succeed(fallbackCapabilityProbe(cause)))
  );
}

function toCapabilityProbeResult(report: CapabilityReport): CapabilityProbeResult {
  return {
    readiness: report.readiness,
    readinessScore: report.readinessScore,
    items: report.checks.map((check) => ({
      name: check.id,
      status: check.status,
      message: check.summary,
      lastContact: check.lastSuccessfulContact ?? null,
      latencyMs: check.latencyMs ?? null,
    })),
    report,
  };
}

function fallbackCapabilityProbe(cause: unknown): CapabilityProbeResult {
  const message = cause instanceof Error ? cause.message : Bun.inspect(cause);
  const generatedAt = new Date().toISOString();
  const report: CapabilityReport = {
    schemaVersion: 1,
    generatedAt,
    readiness: 0,
    readinessScore: 0,
    healthy: 0,
    degraded: 0,
    unavailable: 1,
    checks: [
      {
        id: "capability-aggregator",
        type: "mcp",
        status: "unavailable",
        summary: message,
        latencyMs: 0,
      },
    ],
  };
  return toCapabilityProbeResult(report);
}

function traceById(
  traceId: string
): Effect.Effect<TraceServiceResult, TraceNotFound | TraceReadError> {
  return Effect.tryPromise({
    try: () => buildTraceGraph(traceId),
    catch: (cause) =>
      new TraceReadError({
        traceId,
        message: cause instanceof Error ? cause.message : Bun.inspect(cause),
      }),
  }).pipe(
    Effect.flatMap((graph) =>
      graph.found
        ? Effect.succeed(toTraceServiceResult(graph))
        : Effect.fail(new TraceNotFound({ traceId }))
    )
  );
}

function toTraceServiceResult(graph: TraceGraph): TraceServiceResult {
  return {
    rootTraceId: graph.rootTraceId,
    requestedTraceId: graph.requestedTraceId,
    steps: graph.nodes.map(toTraceStep),
    rootCauseChain: graph.rootCauseChain,
    graph,
  };
}

function toTraceStep(node: TraceGraphNode): TraceStep {
  const firstEvent = node.events[0];
  const firstFailure = node.failures[0];
  const command = firstEvent?.command?.join(" ");
  const description =
    command ||
    firstEvent?.tool ||
    firstFailure?.taxonomyId ||
    firstFailure?.categoryId ||
    firstFailure?.toolName ||
    "unknown";
  const error =
    firstEvent?.error ||
    firstFailure?.output ||
    firstFailure?.taxonomyId ||
    firstFailure?.categoryId;
  return {
    id: node.traceId,
    parentTraceId: node.parentTraceId,
    description,
    status: node.status,
    durationMs: node.durationMs ?? 0,
    ...(error ? { error } : {}),
  };
}

function validateContractService(
  contractPath: string,
  projectRoot: string,
  strict: boolean
): Effect.Effect<ContractServiceValidationResult, ContractValidationError> {
  const absolutePath = resolveContractPath(contractPath, projectRoot);
  return validateContractEffect(absolutePath, projectRoot, { strict }).pipe(
    Effect.map((result) => ({
      status: result.status,
      trusted: result.trusted,
      recognizedSigner: result.recognizedSigner,
      result,
    })),
    Effect.mapError(
      (cause) =>
        new ContractValidationError({
          path: absolutePath,
          message: cause.message,
        })
    )
  );
}

function signContractService(
  contractPath: string,
  keyId: string,
  projectRoot: string
): Effect.Effect<ContractSignatureEnvelope, MissingSigningKey | ContractError> {
  const absolutePath = resolveContractPath(contractPath, projectRoot);
  return signingKey().pipe(
    Effect.flatMap((privateKey) => signContractEffect(absolutePath, keyId, privateKey))
  );
}

function resolveContractPath(contractPath: string, projectRoot: string): string {
  return isAbsolute(contractPath) ? contractPath : resolve(projectRoot, contractPath);
}

function signingKey(): Effect.Effect<string, MissingSigningKey> {
  const fromEnv = Bun.env.KIMI_SIGNING_KEY;
  if (fromEnv?.trim()) return Effect.succeed(fromEnv);

  const keyFile = Bun.env.KIMI_SIGNING_KEY_FILE;
  if (!keyFile?.trim()) {
    return Effect.fail(
      new MissingSigningKey({
        message: "KIMI_SIGNING_KEY or KIMI_SIGNING_KEY_FILE is required",
      })
    );
  }

  return Effect.tryPromise({
    try: () => Bun.file(keyFile).text(),
    catch: (cause) =>
      new MissingSigningKey({
        message: cause instanceof Error ? cause.message : Bun.inspect(cause),
      }),
  });
}
