/**
 * GET /api/identity/flow — orchestrated cookie → JWT → CSRF probe.
 *
 * Read-only on cookies; runs token handlers when session cookies are present.
 */

import {
  forwardSessionRequest,
  resolveIdentityContext,
  resolveSessionIdFromRequest,
} from "../../../../src/lib/serve-session.ts";
import { readRegisteredServeMetrics, SERVE_WS_TOPICS } from "../../../../src/lib/serve-metrics.ts";
import { apiCsrfRotate, apiCsrfVerify } from "./token-csrf.ts";
import { apiJwtSign, apiJwtVerify } from "./token-jwt.ts";
import { jsonErrorResponse, jsonResponse } from "./shared.ts";

export type IdentityFlowStepStatus = "ok" | "warn" | "skip" | "error";

export interface IdentityFlowStep {
  id: string;
  label: string;
  status: IdentityFlowStepStatus;
  detail: Record<string, unknown>;
}

async function readJsonBody(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return { parseError: true, status: res.status };
  }
}

/** Build ordered pipeline steps for the dashboard identity lane. */
export async function buildIdentityFlowSteps(req: Request): Promise<{
  context: ReturnType<typeof resolveIdentityContext>;
  sessionBinding: ReturnType<typeof resolveSessionIdFromRequest>;
  steps: IdentityFlowStep[];
}> {
  const context = resolveIdentityContext(req);
  const sessionBinding = resolveSessionIdFromRequest(req);
  const steps: IdentityFlowStep[] = [];

  steps.push({
    id: "session",
    label: "Cookie session",
    status: context.authenticated ? "ok" : "warn",
    detail: {
      authenticated: context.authenticated,
      userId: context.userId,
      sessionId: context.sessionId,
      theme: context.theme,
      hint: context.authenticated ? undefined : "POST /api/cookie/login with credentials: include",
    },
  });

  const metrics = readRegisteredServeMetrics(SERVE_WS_TOPICS);
  steps.push({
    id: "serve-metrics",
    label: "Bun.serve metrics",
    status: metrics ? "ok" : "warn",
    detail: metrics
      ? {
          pendingRequests: metrics.pendingRequests,
          pendingWebSockets: metrics.pendingWebSockets,
          subscribers: metrics.subscribers,
        }
      : { note: "registerServeMetricsSource() not wired" },
  });

  if (!context.authenticated) {
    steps.push({
      id: "jwt",
      label: "JWT sign + verify",
      status: "skip",
      detail: { reason: "requires cookie session" },
    });
    steps.push({
      id: "csrf",
      label: "CSRF rotate + verify",
      status: "skip",
      detail: { reason: "requires cookie session" },
    });
    return { context, sessionBinding, steps };
  }

  const signRes = await apiJwtSign(
    forwardSessionRequest(req, "/api/token/jwt/sign", {
      method: "POST",
      body: JSON.stringify({ expiresIn: 120_000 }),
    })
  );
  const signed = await readJsonBody(signRes);
  const token = typeof signed.token === "string" ? signed.token : "";

  const verifyRes = await apiJwtVerify(
    forwardSessionRequest(req, "/api/token/jwt/verify", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
  );
  const verified = await readJsonBody(verifyRes);
  const jwtOk = signRes.ok && verified.valid === true;

  steps.push({
    id: "jwt",
    label: "JWT sign + verify",
    status: jwtOk ? "ok" : "error",
    detail: {
      sessionSource: signed.sessionSource,
      sub: (signed.payload as Record<string, unknown> | undefined)?.sub,
      sid: (signed.payload as Record<string, unknown> | undefined)?.sid,
      valid: verified.valid,
      sessionAligned:
        typeof verified.sessionAligned === "boolean" ? verified.sessionAligned : undefined,
    },
  });

  const rotateRes = await apiCsrfRotate(
    forwardSessionRequest(req, "/api/token/csrf/rotate", {
      method: "POST",
      body: JSON.stringify({}),
    })
  );
  const rotated = await readJsonBody(rotateRes);
  const csrfToken = typeof rotated.token === "string" ? rotated.token : "";

  const csrfVerifyRes = await apiCsrfVerify(
    forwardSessionRequest(req, "/api/token/csrf/verify", {
      method: "POST",
      body: JSON.stringify({ token: csrfToken }),
    })
  );
  const csrfVerified = await readJsonBody(csrfVerifyRes);
  const csrfOk = rotateRes.ok && rotated.selfVerified === true && csrfVerified.valid === true;

  steps.push({
    id: "csrf",
    label: "CSRF rotate + verify",
    status: csrfOk ? "ok" : "error",
    detail: {
      sessionSource: rotated.sessionSource,
      sessionId: rotated.sessionId,
      selfVerified: rotated.selfVerified,
      valid: csrfVerified.valid,
    },
  });

  return { context, sessionBinding, steps };
}

export async function apiIdentityFlow(req: Request): Promise<Response> {
  try {
    const { context, sessionBinding, steps } = await buildIdentityFlowSteps(req);
    const ok = steps.every((step) => step.status === "ok" || step.status === "skip");

    return jsonResponse({
      ok,
      authenticated: context.authenticated,
      context,
      sessionBinding,
      steps,
      domains: {
        session: "com.kimi.toolchain.identity.session",
        jwt: "com.kimi.toolchain.identity.jwt",
      },
      note: "Pipeline: cookie login → JWT (sub/sid) → CSRF (session-bound). Re-run after POST /api/cookie/login.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonErrorResponse(
      {
        domain: "http",
        code: "identity_flow_failed",
        message,
        severity: "error",
      },
      500,
      { route: "/api/identity/flow" }
    );
  }
}
