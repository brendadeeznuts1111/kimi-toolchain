#!/usr/bin/env bun
/**
 * herdr-pane — CLI for herdr pane operations
 *
 * Effect-based wrapper around the herdr pane API. All subcommands talk to
 * the running herdr instance over the local Unix socket.
 *
 * Usage:
 *   herdr-pane list [--workspace ID] [--json]
 *   herdr-pane get <pane_id> [--json]
 *   herdr-pane current [--json]
 *   herdr-pane split <pane_id> --direction right|down [--ratio FLOAT] [--cwd PATH] [--focus|--no-focus] [--json]
 *   herdr-pane run <pane_id> <command>
 *   herdr-pane read <pane_id> [--source visible|recent|recent-unwrapped] [--lines N] [--ansi]
 *   herdr-pane send-text <pane_id> <text>
 *   herdr-pane send-keys <pane_id> <keys>
 *   herdr-pane close <pane_id>
 *   herdr-pane swap --direction left|right|up|down [--pane ID]
 *   herdr-pane swap --source-pane ID --target-pane ID
 *   herdr-pane move <pane_id> --tab ID [--split right|down] [--ratio FLOAT] [--focus|--no-focus]
 *   herdr-pane move <pane_id> --new-tab [--workspace ID] [--label TEXT] [--focus|--no-focus]
 *   herdr-pane move <pane_id> --new-workspace [--label TEXT] [--tab-label TEXT] [--focus|--no-focus]
 *   herdr-pane zoom <pane_id> [--toggle|--on|--off]
 *   herdr-pane resize --direction left|right|up|down [--amount FLOAT] [--pane ID]
 *   herdr-pane focus [<pane_id>|--direction left|right|up|down]
 *   herdr-pane neighbor --direction left|right|up|down [--pane ID] [--json]
 *   herdr-pane edges [--pane ID] [--json]
 *   herdr-pane layout [--pane ID] [--json]
 *   herdr-pane process-info [--pane ID] [--json]
 *   herdr-pane rename <pane_id> <label>|--clear
 *   herdr-pane wait-output <pane_id> --match TEXT [--regex] [--timeout MS] [--json]
 *   herdr-pane wait-agent <pane_id> --status idle|working|blocked|done|unknown [--timeout MS] [--json]
 *   herdr-pane split-and-run <pane_id> --direction right|down --command CMD [--ready TEXT] [--timeout MS] [--json]
 */

import { writeStdoutLine } from "../lib/cli-contract.ts";
import { Effect } from "effect";
import {
  listPanes,
  getPane,
  currentPane,
  splitPane,
  closePane,
  paneRun,
  sendText,
  sendKeys,
  readPane,
  waitOutput,
  waitAgentStatus,
  focusPane,
  neighborPane,
  paneEdges,
  paneLayout,
  paneProcessInfo,
  resizePane,
  zoomPane,
  renamePane,
  swapPane,
  movePane,
  splitAndRun,
  splitRunAndWait,
  type Direction,
  type PaneReadSource,
  type ZoomAction,
} from "../lib/herdr-pane-service.ts";

// ── Helpers ─────────────────────────────────────────────────────────────

async function writeOut(line = ""): Promise<void> {
  await writeStdoutLine(line);
}

async function writeJson(value: unknown): Promise<void> {
  await writeOut(JSON.stringify(value, null, 2));
}

function die(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function parseStrFlag(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
  return undefined;
}

function parseNumFlag(argv: string[], flag: string): number | undefined {
  const val = parseStrFlag(argv, flag);
  if (val == null) return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

function parseDirection(argv: string[], flag = "--direction"): Direction | undefined {
  const dir = parseStrFlag(argv, flag);
  if (dir === "left" || dir === "right" || dir === "up" || dir === "down") return dir;
  return undefined;
}

async function showUsage(subcommand?: string): Promise<void> {
  if (!subcommand) {
    await writeOut(`herdr-pane <command> [args...] [--json]

Commands:
  list           List all panes [--workspace ID]
  get            Get pane details by id
  current        Get the currently focused pane
  split          Split a pane [--direction right|down] [--ratio FLOAT] [--cwd PATH] [--focus|--no-focus]
  run            Run a command in a pane (text + Enter, atomic)
  read           Read pane output [--source visible|recent|recent-unwrapped] [--lines N] [--ansi]
  send-text      Send text to a pane without Enter
  send-keys      Send keys to a pane
  close          Close a pane
  swap           Swap pane positions
  move           Move a pane to another tab/workspace
  zoom           Zoom a pane (toggle fullscreen)
  resize         Resize a pane
  focus          Focus a pane or navigate by direction
  neighbor       Get neighbor pane by direction
  edges          Get edge neighbors of a pane
  layout         Get pane layout tree
  process-info   Get process info for a pane
  rename         Rename or clear a pane label
  wait-output    Block until text appears in a pane
  wait-agent     Block until an agent reaches a status
  split-and-run  Split a pane, run a command, and optionally wait for ready

Run herdr-pane <command> --help for command-specific usage.`);
    return;
  }

  const help: Record<string, string> = {
    list: "herdr-pane list [--workspace ID] [--json]",
    get: "herdr-pane get <pane_id> [--json]",
    current: "herdr-pane current [--json]",
    split:
      "herdr-pane split <pane_id> --direction right|down [--ratio FLOAT] [--cwd PATH] [--focus|--no-focus] [--json]",
    run: "herdr-pane run <pane_id> <command>",
    read: "herdr-pane read <pane_id> [--source visible|recent|recent-unwrapped] [--lines N] [--ansi]",
    "send-text": "herdr-pane send-text <pane_id> <text>",
    "send-keys": "herdr-pane send-keys <pane_id> <keys>",
    close: "herdr-pane close <pane_id>",
    swap: "herdr-pane swap --direction left|right|up|down [--pane ID]\nherdr-pane swap --source-pane ID --target-pane ID",
    move: "herdr-pane move <pane_id> --tab ID [--split right|down] [--ratio FLOAT] [--focus|--no-focus]\nherdr-pane move <pane_id> --new-tab [--workspace ID] [--label TEXT] [--focus|--no-focus]\nherdr-pane move <pane_id> --new-workspace [--label TEXT] [--tab-label TEXT] [--focus|--no-focus]",
    zoom: "herdr-pane zoom <pane_id> [--toggle|--on|--off]",
    resize: "herdr-pane resize --direction left|right|up|down [--amount FLOAT] [--pane ID]",
    focus: "herdr-pane focus [<pane_id>|--direction left|right|up|down]",
    neighbor: "herdr-pane neighbor --direction left|right|up|down [--pane ID] [--json]",
    edges: "herdr-pane edges [--pane ID] [--json]",
    layout: "herdr-pane layout [--pane ID] [--json]",
    "process-info": "herdr-pane process-info [--pane ID] [--json]",
    rename: "herdr-pane rename <pane_id> <label>|--clear",
    "wait-output":
      "herdr-pane wait-output <pane_id> --match TEXT [--regex] [--timeout MS] [--json]",
    "wait-agent":
      "herdr-pane wait-agent <pane_id> --status idle|working|blocked|done|unknown [--timeout MS] [--json]",
    "split-and-run":
      "herdr-pane split-and-run <pane_id> --direction right|down --command CMD [--ready TEXT] [--timeout MS] [--json]",
  };

  if (help[subcommand]) {
    await writeOut(`${help[subcommand]}\n`);
  } else {
    await writeOut(`Unknown command: ${subcommand}`);
    await showUsage();
  }
}

// ── Main dispatcher ─────────────────────────────────────────────────────

async function main() {
  const argv = Bun.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    await showUsage(argv[0]);
    process.exit(0);
  }

  const subcommand = argv[0];
  const args = argv.slice(1);
  const json = parseFlag(args, "--json");

  if (subcommand === "--help" || subcommand === "-h") {
    await showUsage();
    process.exit(0);
  }

  if (parseFlag(args, "--help") || parseFlag(args, "-h")) {
    await showUsage(subcommand);
    process.exit(0);
  }

  try {
    switch (subcommand) {
      case "list": {
        const workspace = parseStrFlag(args, "--workspace");
        const panes = await Effect.runPromise(listPanes(workspace));
        if (json) await writeJson({ panes });
        else {
          for (const p of panes) {
            const marker = p.focused ? " *" : "  ";
            const agent = p.agent ? ` [${p.agent}]` : "";
            await writeOut(`${marker}${p.paneId} ${p.title}${agent} (${p.cwd})`);
          }
        }
        break;
      }

      case "get": {
        const paneId = args[0];
        if (!paneId) die("Missing pane_id");
        const pane = await Effect.runPromise(getPane(paneId));
        if (json) await writeJson(pane);
        else await writeOut(JSON.stringify(pane, null, 2));
        break;
      }

      case "current": {
        const pane = await Effect.runPromise(currentPane());
        if (json) await writeJson(pane);
        else await writeOut(pane.paneId);
        break;
      }

      case "split": {
        const paneId = args[0];
        if (!paneId) die("Missing pane_id");
        const rawDir = parseStrFlag(args, "--direction");
        if (rawDir !== "right" && rawDir !== "down")
          die("Missing or invalid --direction (right|down)");
        const direction = rawDir;
        const ratio = parseNumFlag(args, "--ratio");
        const cwd = parseStrFlag(args, "--cwd");
        const focus = parseFlag(args, "--focus")
          ? true
          : parseFlag(args, "--no-focus")
            ? false
            : undefined;
        const result = await Effect.runPromise(splitPane(paneId, { direction, ratio, cwd, focus }));
        if (json) await writeJson(result);
        else await writeOut(result.paneId);
        break;
      }

      case "run": {
        const paneId = args[0];
        if (!paneId) die("Missing pane_id");
        const command = args.slice(1).join(" ");
        if (!command) die("Missing command");
        await Effect.runPromise(paneRun(paneId, command));
        break;
      }

      case "read": {
        const paneId = args[0];
        if (!paneId) die("Missing pane_id");
        const source = (parseStrFlag(args, "--source") as PaneReadSource) ?? "recent";
        const lines = parseNumFlag(args, "--lines");
        const ansi = parseFlag(args, "--ansi");
        const text = await Effect.runPromise(readPane(paneId, { source, lines, ansi }));
        await writeOut(text);
        break;
      }

      case "send-text": {
        const paneId = args[0];
        if (!paneId) die("Missing pane_id");
        const text = args.slice(1).join(" ");
        if (!text) die("Missing text");
        await Effect.runPromise(sendText(paneId, text));
        break;
      }

      case "send-keys": {
        const paneId = args[0];
        if (!paneId) die("Missing pane_id");
        const keys = args.slice(1).join(" ");
        if (!keys) die("Missing keys");
        await Effect.runPromise(sendKeys(paneId, keys));
        break;
      }

      case "close": {
        const paneId = args[0];
        if (!paneId) die("Missing pane_id");
        await Effect.runPromise(closePane(paneId));
        break;
      }

      case "swap": {
        const direction = parseDirection(args);
        const sourcePane = parseStrFlag(args, "--source-pane");
        const targetPane = parseStrFlag(args, "--target-pane");
        const paneId = parseStrFlag(args, "--pane");

        if (sourcePane && targetPane) {
          await Effect.runPromise(swapPane({ sourcePaneId: sourcePane, targetPaneId: targetPane }));
        } else if (direction) {
          if (paneId) {
            // swap --direction X --pane ID
            await Effect.runPromise(swapPane(paneId));
          } else {
            // swap --direction X (current)
            await Effect.runPromise(swapPane({ direction }));
          }
        } else {
          die("swap requires --direction, or --source-pane + --target-pane");
        }
        break;
      }

      case "move": {
        const paneId = args[0];
        if (!paneId) die("Missing pane_id");
        const tabId = parseStrFlag(args, "--tab");
        const newTab = parseFlag(args, "--new-tab");
        const newWorkspace = parseFlag(args, "--new-workspace");
        const focus = parseFlag(args, "--focus")
          ? true
          : parseFlag(args, "--no-focus")
            ? false
            : undefined;

        if (tabId) {
          const split = parseStrFlag(args, "--split");
          const targetPane = parseStrFlag(args, "--target-pane");
          const ratio = parseNumFlag(args, "--ratio");
          await Effect.runPromise(
            movePane(paneId, {
              tabId,
              split: split === "right" || split === "down" ? split : undefined,
              targetPaneId: targetPane,
              ratio,
              focus,
            })
          );
        } else if (newTab) {
          const workspaceId = parseStrFlag(args, "--workspace");
          const label = parseStrFlag(args, "--label");
          await Effect.runPromise(movePane(paneId, { workspaceId, label, focus }));
        } else if (newWorkspace) {
          const label = parseStrFlag(args, "--label");
          const tabLabel = parseStrFlag(args, "--tab-label");
          await Effect.runPromise(movePane(paneId, { label, tabLabel, focus }));
        } else {
          die("move requires --tab, --new-tab, or --new-workspace");
        }
        break;
      }

      case "zoom": {
        const paneId = args[0];
        if (!paneId) die("Missing pane_id");
        const action: ZoomAction = parseFlag(args, "--on")
          ? "on"
          : parseFlag(args, "--off")
            ? "off"
            : "toggle";
        await Effect.runPromise(zoomPane(paneId, action));
        break;
      }

      case "resize": {
        const direction = parseDirection(args);
        if (!direction) die("Missing --direction (left|right|up|down)");
        const amount = parseNumFlag(args, "--amount");
        const paneId = parseStrFlag(args, "--pane");
        await Effect.runPromise(resizePane({ direction, amount, paneId }));
        break;
      }

      case "focus": {
        const direction = parseDirection(args);
        if (direction) {
          await Effect.runPromise(focusPane({ direction }));
        } else if (args[0] && !args[0].startsWith("-")) {
          await Effect.runPromise(focusPane({ paneId: args[0] }));
        } else {
          die("focus requires <pane_id> or --direction");
        }
        break;
      }

      case "neighbor": {
        const direction = parseDirection(args);
        if (!direction) die("Missing --direction (left|right|up|down)");
        const paneId = parseStrFlag(args, "--pane");
        const neighbor = await Effect.runPromise(neighborPane(direction, paneId));
        if (json) await writeJson(neighbor);
        else await writeOut(neighbor.paneId);
        break;
      }

      case "edges": {
        const paneId = parseStrFlag(args, "--pane");
        const edges = await Effect.runPromise(paneEdges(paneId));
        if (json) await writeJson(edges);
        else {
          await writeOut(`left:   ${edges.left ?? "(none)"}`);
          await writeOut(`right:  ${edges.right ?? "(none)"}`);
          await writeOut(`top:    ${edges.top ?? "(none)"}`);
          await writeOut(`bottom: ${edges.bottom ?? "(none)"}`);
        }
        break;
      }

      case "layout": {
        const paneId = parseStrFlag(args, "--pane");
        const layout = await Effect.runPromise(paneLayout(paneId));
        await writeJson(layout);
        break;
      }

      case "process-info": {
        const paneId = parseStrFlag(args, "--pane");
        const info = await Effect.runPromise(paneProcessInfo(paneId));
        if (json) await writeJson(info);
        else
          await writeOut(`${info.paneId} pid=${info.pid} ${info.command} ${info.args.join(" ")}`);
        break;
      }

      case "rename": {
        const paneId = args[0];
        if (!paneId) die("Missing pane_id");
        const label = parseFlag(args, "--clear") ? null : args[1];
        if (label === undefined && !parseFlag(args, "--clear")) {
          die("Missing label or --clear");
        }
        await Effect.runPromise(renamePane(paneId, label));
        break;
      }

      case "wait-output": {
        const paneId = args[0];
        if (!paneId) die("Missing pane_id");
        const match = parseStrFlag(args, "--match");
        if (!match) die("Missing --match TEXT");
        const regex = parseFlag(args, "--regex");
        const timeoutMs = parseNumFlag(args, "--timeout");
        const result = await Effect.runPromise(waitOutput(paneId, { match, regex, timeoutMs }));
        if (json) await writeJson(result);
        else {
          if (result.matched) await writeOut("matched");
          else if (result.timedOut) await writeOut("timed out");
          else await writeOut("not matched");
        }
        process.exit(result.matched ? 0 : 1);
      }

      case "wait-agent": {
        const paneId = args[0];
        if (!paneId) die("Missing pane_id");
        const status = parseStrFlag(args, "--status") as
          | "idle"
          | "working"
          | "blocked"
          | "done"
          | "unknown"
          | undefined;
        if (!status || !["idle", "working", "blocked", "done", "unknown"].includes(status)) {
          die("Missing or invalid --status (idle|working|blocked|done|unknown)");
        }
        const timeoutMs = parseNumFlag(args, "--timeout");
        const result = await Effect.runPromise(waitAgentStatus(paneId, { status, timeoutMs }));
        if (json) await writeJson(result);
        else await writeOut(result.matched ? `agent is ${status}` : "timed out");
        process.exit(result.matched ? 0 : 1);
      }

      case "split-and-run": {
        const paneId = args[0];
        if (!paneId) die("Missing pane_id");
        const rawDir = parseStrFlag(args, "--direction");
        if (rawDir !== "right" && rawDir !== "down")
          die("Missing or invalid --direction (right|down)");
        const direction = rawDir;
        const command = parseStrFlag(args, "--command");
        if (!command) die("Missing --command CMD");
        const ready = parseStrFlag(args, "--ready");
        const timeoutMs = parseNumFlag(args, "--timeout");

        if (ready) {
          const result = await Effect.runPromise(
            splitRunAndWait(paneId, command, ready, { direction, timeoutMs })
          );
          if (json) await writeJson(result);
          else {
            await writeOut(result.paneId);
            await writeOut(result.ready ? "ready" : "timeout");
          }
        } else {
          const result = await Effect.runPromise(
            splitAndRun(paneId, { direction, command, focus: false })
          );
          if (json) await writeJson({ paneId: result });
          else await writeOut(result);
        }
        break;
      }

      default:
        die(`Unknown command: ${subcommand}\nRun herdr-pane --help for usage.`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    die(`herdr-pane: ${message}`);
  }
}

main();
