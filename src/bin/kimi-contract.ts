#!/usr/bin/env bun
/**
 * kimi-contract — sign and validate declarative toolchain contracts.
 */

import { Effect } from "effect";
import { resolve } from "path";
import { createLogger } from "../lib/logger.ts";
import {
  auditContractTrust,
  signContract,
  summarizeContractTrust,
  validateContract,
  type ContractValidationResult,
} from "../lib/contract-signing.ts";
import { recordDecision } from "../lib/decision-ledger.ts";
import { resolveProjectRoot } from "../lib/utils.ts";
import { runCliExit } from "../lib/effect/cli-runtime.ts";
import { CliError } from "../lib/effect/errors.ts";
import { writeStdoutLine } from "../lib/cli-contract.ts";

const logger = createLogger(Bun.argv, "kimi-contract");

async function emitJson(value: unknown): Promise<void> {
  await writeStdoutLine(`${JSON.stringify(value, null, 2)}`);
}

function printHelp(): void {
  logger.line("Usage: kimi-contract <sign|validate> [contract-file] [options]");
  logger.line("");
  logger.line("Commands:");
  logger.line("  sign <contract-file> --key-id <id>  Sign using KIMI_SIGNING_KEY");
  logger.line("  validate [contract-file]            Validate signature trust");
  logger.line("");
  logger.line("Options:");
  logger.line("  --json                              Machine-readable output");
  logger.line("  --strict                            Reject unsigned or unknown-key contracts");
}

function argValue(flag: string): string | null {
  const index = Bun.argv.indexOf(flag);
  if (index < 0) return null;
  return Bun.argv[index + 1] ?? null;
}

async function signingKey(): Promise<string> {
  if (Bun.env.KIMI_SIGNING_KEY) return Bun.env.KIMI_SIGNING_KEY;
  if (Bun.env.KIMI_SIGNING_KEY_FILE) return Bun.file(Bun.env.KIMI_SIGNING_KEY_FILE).text();
  throw new CliError({
    message: "KIMI_SIGNING_KEY or KIMI_SIGNING_KEY_FILE is required",
    exitCode: 1,
  });
}

async function main(): Promise<number> {
  const json = Bun.argv.includes("--json");
  const strict = Bun.argv.includes("--strict");
  const args = Bun.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const command = args[0];
  const projectRoot = await resolveProjectRoot();

  if (!command || command === "help") {
    printHelp();
    return command ? 0 : 1;
  }

  if (command === "sign") {
    const contractPath = args[1] ? resolve(args[1]) : "";
    if (!contractPath) {
      throw new CliError({ message: "Usage: kimi-contract sign <contract-file> --key-id <id>" });
    }
    const keyId = argValue("--key-id");
    if (!keyId) throw new CliError({ message: "--key-id is required" });
    const signature = await signContract(contractPath, keyId, await signingKey());
    await recordDecision({
      key: `contract:${contractPath}`,
      action: "contract-sign",
      trigger: `operator signed ${contractPath}`,
      reasoning:
        "Normalized contract content was signed with an Ed25519 key to establish a trust anchor.",
      alternatives: ["leave contract unsigned", "reject unsigned contracts with --strict"],
      outcome: `signature written to ${contractPath}.sig with key ${keyId}`,
      metadata: {
        contractPath,
        keyId,
        algorithm: signature.algorithm,
        payloadSha256: signature.payloadSha256,
      },
    });
    const output = { contractPath, signaturePath: `${contractPath}.sig`, signature };
    if (json) await emitJson(output);
    else logger.info(`signed ${contractPath} with key ${keyId}`);
    return 0;
  }

  if (command === "validate") {
    const contractPath = args[1] && args[1] !== "--all" ? resolve(args[1]) : null;
    if (contractPath) {
      const result = await validateContract(contractPath, projectRoot, { strict });
      if (json) await emitJson(result);
      else printValidation(result);
      return result.status === "invalid" ? 1 : 0;
    }

    const audit = await auditContractTrust(projectRoot, { strict });
    if (json) await emitJson(audit);
    else {
      for (const result of audit.contracts) printValidation(result);
      logger.info(
        `${audit.signed} signed, ${audit.unsigned} unsigned, ${audit.unknownKeys} unknown-key, ${audit.invalid} invalid`
      );
    }
    return audit.invalid > 0 ? 1 : 0;
  }

  if (command === "summary") {
    const audit = summarizeContractTrust([]);
    if (json) await emitJson(audit);
    else logger.info("no contracts loaded");
    return 0;
  }

  throw new CliError({ message: `Unknown contract command: ${command}` });
}

function printValidation(result: ContractValidationResult): void {
  const prefix =
    result.status === "valid" ? "trusted" : result.status === "invalid" ? "invalid" : "untrusted";
  const key = result.keyId ? ` (${result.keyId})` : "";
  logger.info(`${prefix}: ${result.path}${key} — ${result.message}`);
}

const exitCode = await runCliExit(
  Effect.tryPromise({
    try: () => main(),
    catch: (e) =>
      e instanceof CliError
        ? e
        : new CliError({ message: e instanceof Error ? e.message : String(e) }),
  }),
  { toolName: "kimi-contract", logger }
);
process.exit(exitCode);
