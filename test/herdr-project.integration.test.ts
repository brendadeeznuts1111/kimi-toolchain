import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { invokeTool } from "../src/lib/tool-runner.ts";

const REPO_HERDR_PROJECT = join(import.meta.dir, "..", "src", "bin", "herdr-project.ts");

function herdrProjectTool(): string {
  const desktop = join(homedir(), ".kimi-code", "tools", "herdr-project.ts");
  return existsSync(desktop) ? desktop : REPO_HERDR_PROJECT;
}

function herdrProjectWrapper(): string {
  return join(homedir(), ".local", "bin", "herdr-project");
}

async function runHerdrProject(projectRoot: string, args: string[]) {
  return invokeTool(herdrProjectTool(), args, {
    cwd: projectRoot,
    timeoutMs: 60_000,
  });
}

function herdrServerRunning(): boolean {
  try {
    const out = Bun.spawnSync(["herdr", "status"], { stdout: "pipe", stderr: "pipe" });
    return /status:\s*running/i.test(out.stdout.toString());
  } catch {
    return false;
  }
}

describe("herdr-project integration", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `herdr-project-integration-${Bun.randomUUIDv7()}`);
    mkdirSync(join(projectRoot, ".dx"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".dx/herdr.toml"),
      `schemaVersion = 1
enabled = true
workspaceLabel = "herdr-test-${Bun.randomUUIDv7().slice(0, 8)}"
shellPane = true
shellSplit = "right"
bootstrap = ["echo herdr-bootstrap-ok"]
`
    );
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  test("requires herdr-project tool and PATH wrapper", () => {
    expect(existsSync(herdrProjectTool())).toBe(true);
    expect(existsSync(herdrProjectWrapper())).toBe(true);
  });

  test("has-config exits 0 for flat .dx/herdr.toml", async () => {
    const result = await runHerdrProject(projectRoot, ["has-config", projectRoot]);
    expect(result.exitCode).toBe(0);
  });

  test("discover --json resolves flat project profile", async () => {
    const result = await runHerdrProject(projectRoot, ["discover", projectRoot, "--json"]);
    expect(result.exitCode).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      projectPath: string;
      config: { workspaceLabel: string; sourcePath: string } | null;
    };
    expect(payload.projectPath.replace(/^\/private/, "")).toBe(
      projectRoot.replace(/^\/private/, "")
    );
    expect(payload.config?.sourcePath?.replace(/^\/private/, "")).toEndWith(".dx/herdr.toml");
    expect(payload.config?.workspaceLabel.length).toBeGreaterThan(0);
  });

  test("bootstrap creates workspace when herdr server is running", async () => {
    if (!herdrServerRunning()) {
      console.warn("skip: herdr server not running");
      return;
    }

    const discover = await runHerdrProject(projectRoot, ["discover", projectRoot, "--json"]);
    const label = JSON.parse(discover.stdout).config.workspaceLabel as string;

    const bootstrap = await runHerdrProject(projectRoot, ["bootstrap", projectRoot, "--json"]);
    expect(bootstrap.exitCode).toBe(0);

    const report = JSON.parse(bootstrap.stdout) as {
      readiness: { ready: boolean };
      actions: Array<{ action: string }>;
      workspaceId: string | null;
    };
    expect(report.readiness.ready).toBe(true);
    expect(report.workspaceId).toMatch(/^w/);
    expect(
      report.actions.some(
        (row) => row.action === "workspace_created" || row.action === "focus_existing"
      )
    ).toBe(true);

    const listed = Bun.spawnSync(["herdr", "workspace", "list"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const workspaces = JSON.parse(listed.stdout.toString()) as {
      result: { workspaces: Array<{ label: string; workspace_id: string }> };
    };
    const match = workspaces.result.workspaces.find((ws) => ws.label === label);
    expect(match).toBeDefined();

    if (match?.workspace_id) {
      Bun.spawnSync(["herdr", "workspace", "close", match.workspace_id], {
        stdout: "ignore",
        stderr: "ignore",
      });
    }
  });
});
