/**
 * Bun.serve error-callback helpers — structured JSON + optional dev stack traces.
 *
 * @see https://bun.com/docs/runtime/http/error-handling#error-callback
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { buildHttpErrorBody, formatErrorColored } from "./error-format.ts";

/** @see https://bun.com/docs/runtime/http/error-handling#error-callback */
export const BUN_SERVE_ERROR_HANDLING_DOC_URL =
  "https://bun.com/docs/runtime/http/error-handling#error-callback";

export interface ServeRequestContext {
  pathname: string;
  method: string;
  startedAt: number;
  probe?: boolean;
}

export const serveRequestContext = new AsyncLocalStorage<ServeRequestContext>();

/** In-flight contexts — Bun's error callback runs outside ALS; stack survives until error cb pops. */
const serveContextStack: ServeRequestContext[] = [];

export function peekServeRequestContext(): ServeRequestContext | undefined {
  return serveContextStack[serveContextStack.length - 1] ?? serveRequestContext.getStore();
}

export function popServeRequestContext(): ServeRequestContext | undefined {
  return serveContextStack.pop();
}

export interface ServeErrorOptions {
  route?: string;
  method?: string;
  /** Include Error.stack in JSON body (default: non-production). */
  includeStack?: boolean;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || "Error";
  return String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/** Structured 500 Response for Bun.serve `error` callback and fetch guards. */
export function buildServeErrorResponse(error: unknown, options: ServeErrorOptions = {}): Response {
  const ctx = peekServeRequestContext();
  const route = options.route ?? ctx?.pathname ?? "unknown";
  const method = options.method ?? ctx?.method ?? "GET";
  const message = errorMessage(error);
  const stack = errorStack(error);
  const includeStack =
    options.includeStack ??
    (Bun.env.NODE_ENV !== "production" && Bun.env.KIMI_SERVE_ERROR_STACK !== "0");

  const body = buildHttpErrorBody(
    {
      domain: "http",
      code: "serve_handler_error",
      message,
      severity: "error",
    },
    {
      route,
      method,
      ...(includeStack && stack ? { stack } : {}),
    }
  );

  if (Bun.env.NODE_ENV !== "production") {
    Bun.stderr.write(
      `${formatErrorColored({
        domain: "http",
        code: "serve_handler_error",
        message: `${method} ${route}: ${message}`,
        severity: "error",
      })}\n`
    );
  }

  return new Response(JSON.stringify(body, null, 2), {
    status: 500,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Drop-in Bun.serve `error` handler — use with withServeRequestContext() in fetch. */
export function serveErrorCallback(error: Error): Response {
  const response = buildServeErrorResponse(error);
  popServeRequestContext();
  return response;
}

/** Run a fetch handler with per-request context visible to serveErrorCallback. */
export function withServeRequestContext<T>(
  ctx: ServeRequestContext,
  run: () => T | Promise<T>
): T | Promise<T> {
  serveContextStack.push(ctx);
  const wrapped = serveRequestContext.run(ctx, run);
  if (wrapped instanceof Promise) {
    return wrapped.then(
      (value) => {
        serveContextStack.pop();
        return value;
      },
      (err) => {
        throw err;
      }
    );
  }
  serveContextStack.pop();
  return wrapped;
}
