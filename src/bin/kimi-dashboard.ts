#!/usr/bin/env bun
/**
 * kimi-dashboard — Start the kimi-toolchain feature dashboard.
 *
 * Wraps examples/dashboard/src/index.ts with the correct working directory.
 * Supports --port, --host, Bun.serve env vars (PORT, BUN_PORT), and Bun.WebView shell.
 *
 * Usage:
 *   kimi-dashboard
 *   kimi-dashboard --port=8080
 *   kimi-dashboard --webview --persist
 *   kimi-dashboard --webview --persist --canvas=artifact-lineage
 *   kimi-dashboard --probe              # Bun.WebView DOM metadata + /api/cards diff
 *   kimi-dashboard --probe --json
 *   kimi-dashboard --daemon --port=5678   # detached; survives agent/harness exit
 *   kimi-toolchain dashboard
 *   bun run dashboard
 */

import { join } from "path";
import { isDirectRun, readableStreamToText } from "../lib/bun-utils.ts";
import { makeDir, movePath, pathExists } from "../lib/bun-io.ts";
import {
  CANONICAL_DASHBOARD_PORT,
  resolveDashboardStartupPort,
} from "../lib/dashboard-settings.ts";
import {
  formatExamplesDashboardProbeReport,
  probeExamplesDashboardWebView,
} from "../lib/examples-dashboard-webview-probe.ts";
import { runExamplesDashboardWebView } from "../lib/examples-dashboard-webview.ts";
import { examplesDashboardLogPath, examplesDashboardPidPath, varDir } from "../lib/paths.ts";
import { withBunNoOrphans } from "../lib/tool-runner.ts";

// Resolve the dashboard directory relative to the repo root
const repoRoot = import.meta.dir.includes("kimi-toolchain")
  ? import.meta.dir.split("kimi-toolchain")[0] + "kimi-toolchain"
  : process.cwd();

const dashboardDir = join(repoRoot, "examples", "dashboard");
const dashboardScript = join(dashboardDir, "src", "index.ts");

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

if (isDirectRun(import.meta.path)) {
  const argv = Bun.argv.slice(2);
  const env = { ...Bun.env };

  let webview = false;
  let probe = false;
  let json = false;
  let daemon = false;
  let persistProfile = false;
  let profileDir: string | undefined;
  let canvas: string | undefined;
  let port: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--daemon") {
      daemon = true;
      continue;
    }
    if (arg === "--webview") {
      webview = true;
      continue;
    }
    if (arg === "--probe") {
      probe = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--persist-profile" || arg === "--persist") {
      persistProfile = true;
      continue;
    }
    if (arg.startsWith("--canvas=")) {
      canvas = arg.slice("--canvas=".length);
      continue;
    }
    if (arg === "--canvas") {
      const next = argv[i + 1];
      if (next) {
        canvas = next;
        i++;
      }
      continue;
    }
    if (arg.startsWith("--profile-dir=")) {
      profileDir = arg.slice("--profile-dir=".length);
      persistProfile = true;
      continue;
    }
    if (arg === "--profile-dir") {
      const next = argv[i + 1];
      if (next) {
        profileDir = next;
        persistProfile = true;
        i++;
      }
      continue;
    }
    if (arg.startsWith("--port=")) {
      const value = arg.slice("--port=".length);
      env.PORT = value;
      port = Number(value);
      continue;
    }
    if (arg === "--port" || arg === "-p") {
      const next = argv[argv.indexOf(arg) + 1];
      if (next) {
        env.PORT = next;
        port = Number(next);
      }
      continue;
    }
    if (arg.startsWith("--host=")) {
      env.HOST = arg.slice("--host=".length);
      continue;
    }
    if (arg === "--host") {
      const next = argv[argv.indexOf(arg) + 1];
      if (next) env.HOST = next;
    }
  }

  if (!env.PORT) {
    const { port: resolved } = await resolveDashboardStartupPort(repoRoot, { cliPort: port });
    env.PORT = String(resolved);
  }

  if (probe) {
    const result = await probeExamplesDashboardWebView({
      projectRoot: repoRoot,
      port: port ?? (Number(env.PORT) || CANONICAL_DASHBOARD_PORT),
    });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatExamplesDashboardProbeReport(result));
    }
    process.exit(result.ok ? 0 : 1);
  }

  if (webview) {
    await runExamplesDashboardWebView({
      projectRoot: repoRoot,
      port: port ?? (Number(env.PORT) || CANONICAL_DASHBOARD_PORT),
      canvas,
      persistProfile,
      profileDir,
    });
    process.exit(0);
  }

  if (daemon) {
    const listenPort = env.PORT;
    const runtimeVar = varDir();
    makeDir(runtimeVar, { recursive: true });
    const logPath = examplesDashboardLogPath();
    const pidPath = examplesDashboardPidPath();
    const rotatedLogPath = `${logPath}.1`;
    if (pathExists(logPath)) {
      if (pathExists(rotatedLogPath)) movePath(rotatedLogPath, `${logPath}.2`);
      movePath(logPath, rotatedLogPath);
    }
    // Direct script spawn — `bun run` wrapper does not survive daemon handoff on macOS.
    // Use nohup so the dashboard continues after this launcher exits.
    const daemonCommand = [
      "nohup",
      shellQuote(process.execPath),
      shellQuote(dashboardScript),
      ">",
      shellQuote(logPath),
      "2>&1",
      "&",
      "echo",
      "$!",
    ].join(" ");
    const proc = Bun.spawn(["/bin/sh", "-c", daemonCommand], {
      cwd: dashboardDir,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      readableStreamToText(proc.stdout),
      readableStreamToText(proc.stderr),
      proc.exited,
    ]);
    const daemonPid = Number(stdout.trim());
    if (exitCode !== 0 || !Number.isFinite(daemonPid)) {
      console.error(stderr.trim() || stdout.trim() || "failed to launch dashboard daemon");
      process.exit(exitCode || 1);
    }
    await Bun.write(pidPath, `${daemonPid}\n`);
    console.log(`Dashboard daemon pid=${daemonPid} port=${listenPort}`);
    console.log(`Log: ${logPath}`);
    console.log(`URL: http://127.0.0.1:${listenPort}/`);
    process.exit(0);
  }

  const result = Bun.spawn(withBunNoOrphans(["bun", "run", dashboardScript]), {
    cwd: dashboardDir,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env,
  });

  await result.exited;
  process.exit(result.exitCode);
}
