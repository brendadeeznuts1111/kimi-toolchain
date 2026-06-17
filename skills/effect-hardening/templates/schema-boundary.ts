/**
 * Module 5 — Validation at boundaries (reference template).
 * This repo uses safeParse + narrow guards — NOT @effect/schema.
 * Exemplars: src/lib/finish-work-config.ts, src/lib/kimi-config-audit.ts
 */
import { Data, Effect, pipe } from "effect";

/** Minimal JSON guard — production code uses src/lib/utils.ts safeParse<T>(). */
function safeParse<T>(raw: unknown): T | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as T;
}

// ── Domain types (source of truth) ──

export interface HerdrPaneResponse {
  readonly pane_id: string;
  readonly label?: string;
  readonly agent_status?: "idle" | "working" | "blocked" | "unknown";
  readonly custom_status?: string | null;
  readonly agent_session?: {
    readonly agent: string;
    readonly kind: string;
    readonly source: string;
    readonly value: string;
  } | null;
}

export interface RemoteHostConfig {
  readonly host: string;
  readonly port?: number;
  readonly user?: string;
  readonly identity_file?: string;
  readonly timeout?: number;
  readonly batch_mode?: boolean;
  readonly connect_timeout?: number;
}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly schema: string;
  readonly issues: string[];
}> {}

// ── Narrow guards ──

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentStatus(value: unknown): value is HerdrPaneResponse["agent_status"] {
  return value === "idle" || value === "working" || value === "blocked" || value === "unknown";
}

export function parseHerdrPaneResponse(
  raw: unknown
): Effect.Effect<HerdrPaneResponse, ValidationError> {
  return Effect.sync(() => {
    const issues: string[] = [];
    if (!isRecord(raw)) {
      return Effect.fail(
        new ValidationError({
          message: "Herdr pane response malformed",
          schema: "HerdrPaneResponse",
          issues: ["expected object"],
        })
      );
    }
    if (typeof raw.pane_id !== "string" || !raw.pane_id.trim()) {
      issues.push("pane_id must be non-empty string");
    }
    if (raw.agent_status !== undefined && !isAgentStatus(raw.agent_status)) {
      issues.push("agent_status invalid");
    }
    if (issues.length > 0) {
      return Effect.fail(
        new ValidationError({
          message: "Herdr pane response malformed",
          schema: "HerdrPaneResponse",
          issues,
        })
      );
    }
    return Effect.succeed({
      pane_id: raw.pane_id as string,
      label: typeof raw.label === "string" ? raw.label : undefined,
      agent_status: isAgentStatus(raw.agent_status) ? raw.agent_status : undefined,
      custom_status:
        raw.custom_status === null || typeof raw.custom_status === "string"
          ? raw.custom_status
          : undefined,
    });
  }).pipe(Effect.flatten);
}

export function parseRemoteHostConfig(raw: unknown): RemoteHostConfig | null {
  const parsed = safeParse<RemoteHostConfig>(raw);
  if (!parsed || typeof parsed.host !== "string" || !parsed.host.trim()) {
    return null;
  }
  if (parsed.port !== undefined) {
    const port = parsed.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  }
  if (parsed.timeout !== undefined && (!Number.isInteger(parsed.timeout) || parsed.timeout <= 0)) {
    return null;
  }
  return parsed;
}

// ── Decode with error context ──

export const decodePaneResponse = (raw: unknown) =>
  pipe(
    parseHerdrPaneResponse(raw),
    Effect.mapError((error) => error)
  );
