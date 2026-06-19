/**
 * effect/cli-contract-effect.ts — Effect wrappers for the shared CLI contract.
 *
 * Bridges the synchronous `src/lib/cli-contract.ts` API into Effect so that
 * CLI argument parsing and machine-writer output can be composed in typed
 * Effect pipelines without throwing raw exceptions.
 */

import { Effect } from "effect";
import {
  createMachineWriter,
  parseCliFlags,
  CliContractError,
  type CliFlags,
  type MachineWriter,
  type ParseCliFlagsOptions,
} from "../cli-contract.ts";
import { type LogLevel } from "../logger.ts";
import { EffectCliContractError } from "./errors.ts";

/** Effect-based machine writer: every output operation is a typed Effect. */
export interface MachineWriterEffect {
  /** Emit a single JSON object on stdout. */
  readonly writeJson: (data: unknown) => Effect.Effect<void, never>;
  /** Emit multiple JSON objects as JSONL on stdout. */
  readonly writeJsonl: (entries: unknown[]) => Effect.Effect<void, never>;
  /** Emit a human-readable line on stderr (suppressed in json/quiet/agent modes). */
  readonly writeHuman: (level: LogLevel, message: string) => Effect.Effect<void, never>;
  /** Convenience wrappers. */
  readonly info: (message: string) => Effect.Effect<void, never>;
  readonly warn: (message: string) => Effect.Effect<void, never>;
  readonly error: (message: string) => Effect.Effect<void, never>;
  readonly debug: (message: string) => Effect.Effect<void, never>;
  /** Backing logger for telemetry and backward compatibility. */
  readonly logger: MachineWriter["logger"];
  /** Parsed flags. */
  readonly flags: Readonly<CliFlags>;
}

function toMachineWriterEffect(writer: MachineWriter): MachineWriterEffect {
  return {
    writeJson: (data) => Effect.sync(() => writer.writeJson(data)),
    writeJsonl: (entries) => Effect.sync(() => writer.writeJsonl(entries)),
    writeHuman: (level, message) => Effect.sync(() => writer.writeHuman(level, message)),
    info: (message) => Effect.sync(() => writer.info(message)),
    warn: (message) => Effect.sync(() => writer.warn(message)),
    error: (message) => Effect.sync(() => writer.error(message)),
    debug: (message) => Effect.sync(() => writer.debug(message)),
    logger: writer.logger,
    flags: writer.flags,
  };
}

function extractUnknownFlag(message: string): string | undefined {
  const match = message.match(/Unknown flag\s+(\S+)/);
  return match?.[1];
}

/**
 * Parse common CLI flags from argv, returning a typed Effect failure instead of
 * throwing on strict-mode unknown flags.
 */
export function parseCliFlagsEffect(
  argv: string[],
  toolName: string,
  options: ParseCliFlagsOptions = {}
): Effect.Effect<CliFlags, EffectCliContractError> {
  return Effect.try({
    try: () => parseCliFlags(argv, toolName, options),
    catch: (cause) => {
      if (cause instanceof CliContractError) {
        return new EffectCliContractError({
          message: cause.message,
          toolName: cause.toolName,
          taxonomyId: cause.taxonomyId,
          unknownFlag: cause.unknownFlag,
          suggestions: cause.suggestions,
        });
      }
      return new EffectCliContractError({
        message: cause instanceof Error ? cause.message : String(cause),
        toolName,
        taxonomyId: "cli_invalid_flag",
        unknownFlag: extractUnknownFlag(cause instanceof Error ? cause.message : String(cause)),
      });
    },
  });
}

/**
 * Create a machine writer whose output operations are exposed as typed Effects.
 *
 * The underlying synchronous writer is constructed lazily; all side effects are
 * deferred until the returned Effects are run.
 */
export function createMachineWriterEffect(
  flags: CliFlags,
  toolName?: string
): Effect.Effect<MachineWriterEffect, never> {
  return Effect.sync(() => toMachineWriterEffect(createMachineWriter(flags, toolName)));
}

/** Convenience: parse argv and create an Effect-based writer in one pipeline. */
export function createCliEffect(
  argv: string[],
  toolName: string,
  options: ParseCliFlagsOptions = {}
): Effect.Effect<MachineWriterEffect, EffectCliContractError> {
  return parseCliFlagsEffect(argv, toolName, options).pipe(
    Effect.flatMap((flags) => createMachineWriterEffect(flags, toolName))
  );
}
