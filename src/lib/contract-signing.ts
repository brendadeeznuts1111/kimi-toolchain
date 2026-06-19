/**
 * Contract normalization, Ed25519 signing, and trust validation.
 */

import { Data, Effect } from "effect";
import { existsSync, mkdirSync } from "fs";
import { dirname, extname, join, relative } from "path";
import yaml from "js-yaml";
import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { safeParse, sha256String } from "./utils.ts";

export type ContractTrustStatus = "valid" | "unsigned" | "unknown-key" | "invalid";

export class ContractReadError extends Data.TaggedError("ContractReadError")<{
  path: string;
  message: string;
}> {}

export class ContractParseError extends Data.TaggedError("ContractParseError")<{
  path: string;
  message: string;
}> {}

export class ContractSigningKeyError extends Data.TaggedError("ContractSigningKeyError")<{
  message: string;
}> {}

export class ContractSignatureError extends Data.TaggedError("ContractSignatureError")<{
  path: string;
  message: string;
}> {}

export type ContractError =
  | ContractReadError
  | ContractParseError
  | ContractSigningKeyError
  | ContractSignatureError;

export interface TrustedKey {
  publicKey: string;
  roles?: string[];
}

export type TrustedKeys = Record<string, TrustedKey>;

export interface ContractSignatureEnvelope {
  schemaVersion: 1;
  algorithm: "ed25519";
  keyId: string;
  signatureHex: string;
  payloadSha256: string;
  signedAt: string;
}

export interface ContractValidationResult {
  path: string;
  signaturePath: string;
  status: ContractTrustStatus;
  trusted: boolean;
  keyId?: string;
  recognizedSigner?: string;
  payloadSha256: string;
  message: string;
}

export interface ContractTrustAudit {
  contracts: ContractValidationResult[];
  signed: number;
  unsigned: number;
  unknownKeys: number;
  invalid: number;
  recognizedSigners: string[];
}

export interface ValidateOptions {
  trustedKeysPath?: string;
  strict?: boolean;
}

export function trustedKeysPath(projectRoot: string): string {
  return join(projectRoot, "trusted-keys.json");
}

export function signaturePathFor(contractPath: string): string {
  return `${contractPath}.sig`;
}

export function normalizeContractValue(value: unknown): string {
  return `${JSON.stringify(sortValue(stripEmbeddedSignature(value)))}\n`;
}

export async function readNormalizedContract(
  path: string
): Promise<{ value: unknown; normalized: string; payloadSha256: string }> {
  let text = "";
  try {
    text = await Bun.file(path).text();
  } catch (cause) {
    throw new ContractReadError({
      path,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }

  const value = parseContract(text, path);
  const normalized = normalizeContractValue(value);
  return {
    value,
    normalized,
    payloadSha256: sha256String(normalized),
  };
}

export function signContractEffect(
  contractPath: string,
  keyId: string,
  privateKeyPem: string
): Effect.Effect<ContractSignatureEnvelope, ContractError> {
  return Effect.tryPromise({
    try: async () => signContract(contractPath, keyId, privateKeyPem),
    catch: (cause) => mapContractCause(contractPath, cause),
  });
}

export async function signContract(
  contractPath: string,
  keyId: string,
  privateKeyPem: string
): Promise<ContractSignatureEnvelope> {
  if (!keyId.trim()) {
    throw new ContractSigningKeyError({ message: "--key-id is required" });
  }
  if (!privateKeyPem.trim()) {
    throw new ContractSigningKeyError({
      message: "KIMI_SIGNING_KEY or KIMI_SIGNING_KEY_FILE is required",
    });
  }

  const { normalized, payloadSha256 } = await readNormalizedContract(contractPath);
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(privateKeyPem);
  } catch (cause) {
    throw new ContractSigningKeyError({
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }

  const signature = cryptoSign(null, new TextEncoder().encode(normalized), privateKey);
  const envelope: ContractSignatureEnvelope = {
    schemaVersion: 1,
    algorithm: "ed25519",
    keyId,
    signatureHex: bytesToHex(signature),
    payloadSha256,
    signedAt: new Date().toISOString(),
  };
  const sigPath = signaturePathFor(contractPath);
  mkdirSync(dirname(sigPath), { recursive: true });
  await Bun.write(sigPath, `${JSON.stringify(envelope, null, 2)}\n`);
  return envelope;
}

export function validateContractEffect(
  contractPath: string,
  projectRoot: string,
  options: ValidateOptions = {}
): Effect.Effect<ContractValidationResult, ContractError> {
  return Effect.tryPromise({
    try: async () => validateContract(contractPath, projectRoot, options),
    catch: (cause) => mapContractCause(contractPath, cause),
  });
}

export async function validateContract(
  contractPath: string,
  projectRoot: string,
  options: ValidateOptions = {}
): Promise<ContractValidationResult> {
  const { normalized, payloadSha256 } = await readNormalizedContract(contractPath);
  const signaturePath = signaturePathFor(contractPath);
  if (!existsSync(signaturePath)) {
    const result = {
      path: contractPath,
      signaturePath,
      status: "unsigned" as const,
      trusted: false,
      payloadSha256,
      message: "unsigned contract; run kimi contract sign to establish trust",
    };
    if (options.strict) throw invalidByPolicy(contractPath, result.message);
    return result;
  }

  const signature = await readSignature(signaturePath);
  const trustedKeys = await readTrustedKeys(
    options.trustedKeysPath ?? trustedKeysPath(projectRoot)
  );
  if (signature.payloadSha256 !== payloadSha256) {
    throw new ContractSignatureError({
      path: contractPath,
      message: "signature payload hash does not match normalized contract",
    });
  }

  const recognized = verifyWithTrustedKeys(normalized, signature, trustedKeys);
  if (recognized) {
    return {
      path: contractPath,
      signaturePath,
      status: "valid",
      trusted: true,
      keyId: signature.keyId,
      recognizedSigner: recognized,
      payloadSha256,
      message: `trusted signature by ${recognized}`,
    };
  }

  if (trustedKeys[signature.keyId]) {
    throw new ContractSignatureError({
      path: contractPath,
      message: `invalid signature for trusted key ${signature.keyId}`,
    });
  }

  const result = {
    path: contractPath,
    signaturePath,
    status: "unknown-key" as const,
    trusted: false,
    keyId: signature.keyId,
    payloadSha256,
    message: `signature key ${signature.keyId} is not in trusted-keys.json`,
  };
  if (options.strict) throw invalidByPolicy(contractPath, result.message);
  return result;
}

export async function auditContractTrust(
  projectRoot: string,
  options: ValidateOptions = {}
): Promise<ContractTrustAudit> {
  const contracts = await discoverContractFiles(projectRoot);
  const results: ContractValidationResult[] = [];
  for (const path of contracts) {
    try {
      results.push(await validateContract(path, projectRoot, options));
    } catch (cause) {
      if (cause instanceof ContractSignatureError) {
        results.push({
          path,
          signaturePath: signaturePathFor(path),
          status: "invalid",
          trusted: false,
          payloadSha256: "",
          message: cause.message,
        });
      } else {
        throw cause;
      }
    }
  }

  return summarizeContractTrust(results);
}

export function summarizeContractTrust(contracts: ContractValidationResult[]): ContractTrustAudit {
  const signers = new Set<string>();
  for (const contract of contracts) {
    if (contract.recognizedSigner) signers.add(contract.recognizedSigner);
  }
  return {
    contracts,
    signed: contracts.filter((contract) => contract.status === "valid").length,
    unsigned: contracts.filter((contract) => contract.status === "unsigned").length,
    unknownKeys: contracts.filter((contract) => contract.status === "unknown-key").length,
    invalid: contracts.filter((contract) => contract.status === "invalid").length,
    recognizedSigners: [...signers].sort(),
  };
}

export async function discoverContractFiles(projectRoot: string): Promise<string[]> {
  const patterns = [
    "contracts/**/*.json",
    "contracts/**/*.yaml",
    "contracts/**/*.yml",
    "**/*.contract.json",
    "**/*.contract.yaml",
    "**/*.contract.yml",
  ];
  const found = new Set<string>();
  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern);
    for await (const file of glob.scan({ cwd: projectRoot, absolute: true, onlyFiles: true })) {
      const rel = relative(projectRoot, file);
      if (rel.includes("node_modules/") || rel.includes(".git/")) continue;
      if (file.endsWith(".sig")) continue;
      found.add(file);
    }
  }
  return [...found].sort();
}

export async function readTrustedKeys(path: string): Promise<TrustedKeys> {
  if (!existsSync(path)) return {};
  const text = await Bun.file(path).text();
  const parsed = safeParse<unknown>(text, {});
  if (!parsed || typeof parsed !== "object") return {};
  if ("keys" in parsed && typeof (parsed as { keys?: unknown }).keys === "object") {
    return normalizeTrustedKeys((parsed as { keys: unknown }).keys);
  }
  return normalizeTrustedKeys(parsed);
}

async function readSignature(path: string): Promise<ContractSignatureEnvelope> {
  const text = await Bun.file(path).text();
  const parsed = safeParse<ContractSignatureEnvelope | null>(text, null);
  if (!isSignatureEnvelope(parsed)) {
    throw new ContractSignatureError({ path, message: "invalid signature envelope" });
  }
  return parsed;
}

function parseContract(text: string, path: string): unknown {
  try {
    if ([".yaml", ".yml"].includes(extname(path))) {
      return yaml.load(text);
    }
    return JSON.parse(text);
  } catch (cause) {
    throw new ContractParseError({
      path,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function verifyWithTrustedKeys(
  normalized: string,
  signature: ContractSignatureEnvelope,
  trustedKeys: TrustedKeys
): string | null {
  const candidates = Object.entries(trustedKeys).sort(([a], [b]) => {
    if (a === signature.keyId) return -1;
    if (b === signature.keyId) return 1;
    return a.localeCompare(b);
  });
  for (const [keyId, trusted] of candidates) {
    try {
      const publicKey = createPublicKey(trusted.publicKey);
      const ok = cryptoVerify(
        null,
        new TextEncoder().encode(normalized),
        publicKey,
        hexToBytes(signature.signatureHex)
      );
      if (ok) return keyId;
    } catch {
      // Ignore malformed trusted keys and keep trying the rest.
    }
  }
  return null;
}

function normalizeTrustedKeys(value: unknown): TrustedKeys {
  if (!value || typeof value !== "object") return {};
  const keys: TrustedKeys = {};
  for (const [keyId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const publicKey = (raw as { publicKey?: unknown }).publicKey;
    if (typeof publicKey !== "string" || !publicKey.trim()) continue;
    const roles = (raw as { roles?: unknown }).roles;
    keys[keyId] = {
      publicKey,
      ...(Array.isArray(roles) && roles.every((role) => typeof role === "string") ? { roles } : {}),
    };
  }
  return keys;
}

function stripEmbeddedSignature(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripEmbeddedSignature);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "x-kimi-signature") continue;
    out[key] = stripEmbeddedSignature(item);
  }
  return out;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortValue((value as Record<string, unknown>)[key]);
  }
  return out;
}

function isSignatureEnvelope(value: unknown): value is ContractSignatureEnvelope {
  return (
    !!value &&
    typeof value === "object" &&
    (value as ContractSignatureEnvelope).schemaVersion === 1 &&
    (value as ContractSignatureEnvelope).algorithm === "ed25519" &&
    typeof (value as ContractSignatureEnvelope).keyId === "string" &&
    typeof (value as ContractSignatureEnvelope).signatureHex === "string" &&
    typeof (value as ContractSignatureEnvelope).payloadSha256 === "string" &&
    typeof (value as ContractSignatureEnvelope).signedAt === "string"
  );
}

function invalidByPolicy(path: string, message: string): ContractSignatureError {
  return new ContractSignatureError({ path, message });
}

function mapContractCause(path: string, cause: unknown): ContractError {
  if (
    cause instanceof ContractReadError ||
    cause instanceof ContractParseError ||
    cause instanceof ContractSigningKeyError ||
    cause instanceof ContractSignatureError
  ) {
    return cause;
  }
  return new ContractSignatureError({
    path,
    message: cause instanceof Error ? cause.message : String(cause),
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("invalid hex signature");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
