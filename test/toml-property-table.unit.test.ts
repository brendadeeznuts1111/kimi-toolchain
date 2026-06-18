import { describe, expect, test } from "bun:test";
import { join } from "path";
import { previewMarkdownWithBun } from "../src/lib/markdown-table.ts";
import {
  buildTomlPropertyTable,
  formatTomlPropertyTableMarkdown,
  REMOTE_HOSTS_TABLE_COLUMNS,
} from "../src/lib/toml-property-table.ts";
import { REPO_ROOT, testTempDir } from "./helpers.ts";

const FIXTURE = "test/fixtures/dx-remote-hosts.toml";

describe("toml-property-table", () => {
  test("buildTomlPropertyTable resolves remote_hosts with defaults", async () => {
    const result = await buildTomlPropertyTable({
      projectRoot: REPO_ROOT,
      filePath: FIXTURE,
      tablePath: "herdr.orchestrator.remote_hosts",
    });

    expect(result.columns).toEqual(REMOTE_HOSTS_TABLE_COLUMNS);
    expect(result.rows.length).toBe(2);

    const staging = result.rows.find((r) => r.Host === "staging")!;
    expect(staging.Port).toBe("2222");
    expect(staging.User).toBe("deploy");
    expect(staging.IdentityFile).toBe("~/.ssh/staging_key");
    expect(staging.Timeout).toBe("10");
    expect(staging.ConnectTimeout).toBe("5");
    expect(staging.LastModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const workbox = result.rows.find((r) => r.Host === "workbox")!;
    expect(workbox.Port).toBe("—");
    expect(workbox.User).toBe("—");
  });

  test("formatTomlPropertyTableMarkdown renders markdown table", async () => {
    const result = await buildTomlPropertyTable({
      projectRoot: REPO_ROOT,
      filePath: FIXTURE,
      tablePath: "herdr.orchestrator.remote_hosts",
    });
    const md = formatTomlPropertyTableMarkdown(result);
    expect(md).toContain(
      "| Host | Port | User | IdentityFile | Timeout | ConnectTimeout | LastModified |"
    );
    expect(md).toContain("| :--- | ---: | :--- | :--- | ---: | ---: | ---: |");
    expect(md).toContain("staging");
    expect(md).toContain("2222");
  });

  test("repo dx.config.toml remote_hosts table builds", async () => {
    const result = await buildTomlPropertyTable({
      projectRoot: REPO_ROOT,
      filePath: "dx.config.toml",
      tablePath: "herdr.orchestrator.remote_hosts",
    });
    expect(result.rows.some((r) => r.Host === "staging")).toBe(true);
  });

  test("buildTomlPropertyTable extracts handoff_rules from dx.config.toml", async () => {
    const result = await buildTomlPropertyTable({
      projectRoot: REPO_ROOT,
      filePath: "dx.config.toml",
      tablePath: "herdr.orchestrator.handoff_rules",
    });
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    const wB = result.rows.find((r) => r.FromWorkspace === "wB" && r.FromAgent === "kimi");
    expect(wB?.Condition).toBe("finish-work:handoff-ready");
    expect(wB?.ToAgent).toBe("codex-primary");
    expect(wB?.When).toContain("finishWorkReport.review.resolved");
  });

  test("buildTomlPropertyTable extracts endpoints fixture", async () => {
    const result = await buildTomlPropertyTable({
      projectRoot: REPO_ROOT,
      filePath: "test/fixtures/dx-url-endpoints.toml",
      tablePath: "endpoints",
    });
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]?.name).toBe("users");
    expect(result.rows[0]?.url).toContain("8443");
  });

  test("unknown table path throws", async () => {
    await expect(
      buildTomlPropertyTable({
        projectRoot: REPO_ROOT,
        filePath: FIXTURE,
        tablePath: "herdr.unknown",
      })
    ).rejects.toThrow(/Unknown table path/);
    await expect(
      buildTomlPropertyTable({
        projectRoot: REPO_ROOT,
        filePath: FIXTURE,
        tablePath: "herdr.orchestrator.remote_hosts_typo",
      })
    ).rejects.toThrow(/Top-level keys/);
  });

  test("buildTomlPropertyTable extracts herdr.orchestrator.dashboard", async () => {
    const result = await buildTomlPropertyTable({
      projectRoot: REPO_ROOT,
      filePath: "dx.config.toml",
      tablePath: "herdr.orchestrator.dashboard",
    });
    expect(result.rows.map((r) => r.Property)).toEqual([
      "stale_ms",
      "sse_poll_ms",
      "poll_hint_ms",
      "persist_profile",
    ]);
    expect(result.rows.find((r) => r.Property === "persist_profile")?.Value).toBe("true");
  });

  test("bun ./table.md renders remote_hosts content in terminal", async () => {
    const result = await buildTomlPropertyTable({
      projectRoot: REPO_ROOT,
      filePath: FIXTURE,
      tablePath: "herdr.orchestrator.remote_hosts",
    });
    const md = formatTomlPropertyTableMarkdown(result);
    const dir = testTempDir("toml-bun-render-");
    const mdPath = join(dir, "table-remote-hosts.md");
    await Bun.write(mdPath, md);

    const preview = await previewMarkdownWithBun(mdPath);
    const combined = `${preview.stdout}\n${preview.stderr}`;
    expect(preview.exitCode).toBe(0);
    expect(combined).toContain("staging");
    expect(combined).toContain("2222");
    expect(combined).toContain("deploy");
  }, 15_000);
});
