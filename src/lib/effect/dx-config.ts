/**
 * effect/dx-config.ts — Effect service for merged DX config documents.
 *
 * Config domain owns load/merge only. Domain parsers (PropertyTable, Herdr,
 * Cloudflare, …) take the raw document and apply their own typed slices.
 */

import { Cause, Context, Effect, Layer } from "effect";
import {
  ConfigParseError as TomlConfigParseError,
  loadMergedConfigDocument,
  type MergedDxConfigMeta,
} from "../dx-config-parse.ts";
import {
  ConfigMergeConflict,
  ConfigNotFound,
  ConfigParseError,
  type DxConfigError,
} from "./errors.ts";
import type { DxConfigDocument } from "../dx-config-merge.ts";

export interface DxConfigService {
  readonly getMergedConfig: (projectRoot: string) => Effect.Effect<DxConfigDocument, DxConfigError>;
  readonly getMergedMeta: (projectRoot: string) => Effect.Effect<MergedDxConfigMeta, DxConfigError>;
}

export class DxConfig extends Context.Tag("@kimi/DxConfig")<DxConfig, DxConfigService>() {}

export const getMergedConfig = (projectRoot: string) =>
  Effect.flatMap(DxConfig, (svc) => svc.getMergedConfig(projectRoot));

export const getMergedMeta = (projectRoot: string) =>
  Effect.flatMap(DxConfig, (svc) => svc.getMergedMeta(projectRoot));

export interface DxConfigErrorSummary {
  tag: DxConfigError["_tag"];
  message: string;
  path?: string;
}

export function summarizeDxConfigError(error: DxConfigError): DxConfigErrorSummary {
  switch (error._tag) {
    case "ConfigNotFound":
      return {
        tag: error._tag,
        message: `Config not found (${error.kind}): ${error.path}`,
        path: error.path,
      };
    case "ConfigParseError":
      return {
        tag: error._tag,
        message: `Config parse error (${error.path}): ${error.cause}`,
        path: error.path,
      };
    case "ConfigMergeConflict":
      return {
        tag: error._tag,
        message: `Config merge conflict (${error.path})`,
        path: error.path,
      };
  }
}

export function summarizeDxConfigCause(cause: Cause.Cause<DxConfigError>): DxConfigErrorSummary[] {
  if (cause._tag === "Fail") {
    return [summarizeDxConfigError(cause.error)];
  }
  const pretty = Cause.pretty(cause);
  return [{ tag: "ConfigParseError", message: pretty || "Config resolution failed" }];
}

/** Program with `DxConfigLive` already provided. */
export const withDxConfigLive =
  (home?: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R | DxConfig>) =>
    effect.pipe(Effect.provide(DxConfigLive(home)));

export function runGetMergedConfig(
  projectRoot: string,
  home?: string
): Effect.Effect<DxConfigDocument, DxConfigError> {
  return withDxConfigLive(home)(getMergedConfig(projectRoot));
}

export function runGetMergedMeta(
  projectRoot: string,
  home?: string
): Effect.Effect<MergedDxConfigMeta, DxConfigError> {
  return withDxConfigLive(home)(getMergedMeta(projectRoot));
}

function mapLoadError(cause: unknown): DxConfigError {
  if (cause instanceof TomlConfigParseError) {
    return new ConfigParseError({ path: cause.path, cause: cause.cause });
  }
  if (cause instanceof ConfigParseError) {
    return cause;
  }
  if (cause instanceof Error) {
    return new ConfigParseError({ path: "unknown", cause: cause.message });
  }
  return new ConfigParseError({ path: "unknown", cause: String(cause) });
}

function makeService(home?: string): DxConfigService {
  const load = (projectRoot: string) =>
    Effect.tryPromise({
      try: () => loadMergedConfigDocument(projectRoot, home),
      catch: mapLoadError,
    });

  return {
    getMergedConfig: (projectRoot) => load(projectRoot).pipe(Effect.map((meta) => meta.document)),
    getMergedMeta: (projectRoot) => load(projectRoot),
  };
}

/** Live layer — reads ~/.config/dx/global-config.toml + project dx.config.toml. */
export const DxConfigLive = (home?: string): Layer.Layer<DxConfig> =>
  Layer.succeed(DxConfig, makeService(home));

/** Test layer — inject a fixed merged document. */
export const DxConfigTest = (
  document: DxConfigDocument,
  meta?: Partial<Omit<MergedDxConfigMeta, "document">>
): Layer.Layer<DxConfig> =>
  Layer.succeed(DxConfig, {
    getMergedConfig: () => Effect.succeed(document),
    getMergedMeta: () =>
      Effect.succeed({
        globalPath: meta?.globalPath ?? null,
        projectPath: meta?.projectPath ?? null,
        document,
      }),
  });

export { ConfigNotFound, ConfigParseError, ConfigMergeConflict, type DxConfigError };
