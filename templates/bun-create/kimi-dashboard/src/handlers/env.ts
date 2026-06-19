/**
 * Environment probe — env vars + bunfig.toml parsing.
 *
 * Bun APIs: Bun.env, Bun.TOML.parse()
 */

import { json } from "../lib/response.ts";

export async function apiEnv(): Promise<Response> {
  return json({
    NODE_ENV: Bun.env.NODE_ENV ?? "unset",
    HOME: Bun.env.HOME ?? "unset",
    PATH: (Bun.env.PATH ?? "").split(":").slice(0, 5),
    bunfig: Bun.TOML.parse(
      (await Bun.file("./bunfig.toml")
        .text()
        .catch(() => "")) || "[install]"
    ),
  });
}
