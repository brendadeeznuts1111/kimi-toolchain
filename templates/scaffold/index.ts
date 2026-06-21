/**
 * Entry point — minimal Bun HTTP server with Effect-typed lifecycle.
 *
 * Demonstrates the kimi-toolchain Effect recipe:
 * - Typed errors via Data.TaggedError (no raw throws)
 * - Effect.gen for structured control flow
 * - Effect.ensuring for graceful server shutdown
 * - Effect.runPromiseExit for structured exit codes
 *
 * @see https://effect.website/docs/effect/gen for Effect.gen
 * @see https://effect.website/docs/error-management/tagged-errors for tagged errors
 * @see https://effect.website/docs/effect/ensuring for Effect.ensuring
 */

import { Data, Effect } from "effect";

// ── Tagged errors ──────────────────────────────────────────────────

class ServerStartError extends Data.TaggedError("ServerStartError")<{
  port: number;
  cause: string;
}> {}

// ── Server lifecycle ───────────────────────────────────────────────

const port = Number(Bun.env.PORT) || 0;

const program = Effect.gen(function* () {
  let server: ReturnType<typeof Bun.serve> | undefined;

  yield* Effect.ensuring(
    Effect.sync(() => {
      server = Bun.serve({
        port,
        fetch(req: Request): Response {
          const url = new URL(req.url);
          if (url.pathname === "/health") return new Response("ok");
          if (url.pathname === "/") return new Response("Hello from Bun!");
          return new Response("Not Found", { status: 404 });
        },
      });
    }),
    Effect.sync(() => {
      server?.stop(true);
    })
  );

  if (!server) {
    return yield* Effect.fail(new ServerStartError({ port, cause: "server not initialized" }));
  }

  yield* Effect.sync(() => Bun.stdout.write(`Server listening on port ${server!.port}\n`));

  yield* Effect.never;
});

// ── Run with structured exit ───────────────────────────────────────

const exit = await Effect.runPromiseExit(program);

if (exit._tag === "Success") {
  process.exit(0);
} else {
  const cause = exit.cause;
  if (cause._tag === "Fail") {
    const err = cause.error;
    Bun.stderr.write(`${err._tag}: ${"cause" in err ? err.cause : err}\n`);
  }
  process.exit(1);
}
