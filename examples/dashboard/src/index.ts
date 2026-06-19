/**
 * examples/dashboard — Demo app showcasing kimi-toolchain features.
 *
 * Handlers live in src/handlers/ (SSOT). This file boots Bun.serve only.
 *
 * Start: bun run src/index.ts
 * Open:  http://localhost:5678  (Dashboard Contract v1.0; override with PORT)
 */

import {
  parseDashboardCliPort,
  resolveDashboardProjectRoot,
  resolveDashboardStartupPort,
} from "../../../src/lib/dashboard-settings.ts";
import { handleArtifactsRequest } from "./handlers/artifacts.ts";
import { dispatchDashboardRoute } from "./handlers/dispatch.ts";
import { startHttp2DemoServer } from "./handlers/http-2.ts";

const projectRoot = resolveDashboardProjectRoot(import.meta.dir);
const { port: listenPort } = await resolveDashboardStartupPort(projectRoot, {
  cliPort: parseDashboardCliPort(Bun.argv),
});

const server = Bun.serve({
  port: listenPort,
  async fetch(req) {
    const artifactResponse = await handleArtifactsRequest(req);
    if (artifactResponse) return artifactResponse;

    const routed = await dispatchDashboardRoute(req);
    if (routed) return routed;

    return new Response("Not Found", { status: 404 });
  },
});

startHttp2DemoServer();

Bun.stdout.write(`Dashboard running at http://localhost:${server.port}\n`);
