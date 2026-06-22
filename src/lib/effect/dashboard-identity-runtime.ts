/**
 * Dashboard Identity runtime boundary — Effect.runPromise is allowed here.
 */

import { Effect, Either } from "effect";
import { Identity } from "./identity-service.ts";
import { dashboardIdentityLayer } from "../serve-identity.ts";

export function runDashboardIdentity<A, E>(
  effect: Effect.Effect<A, E, Identity>,
  projectRoot: string
): Promise<Either.Either<A, E>> {
  return Effect.runPromise(
    effect.pipe(Effect.either, Effect.provide(dashboardIdentityLayer(projectRoot)))
  );
}
