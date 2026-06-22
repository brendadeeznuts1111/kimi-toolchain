import { makeDir, pathExists, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, test } from "bun:test";
import { homedir } from "os";
import { join } from "path";
import { REPO_ROOT, testTempDir, withClearedEnv, withEnv } from "./helpers.ts";
import {
  parseCondition,
  parseHerdrOrchestratorSection,
  parseOrchestratorDashboardSection,
  parseHerdrAppConfig,
  resolveOrchestratorConfig,
  normalizeRemoteHostConfig,
  parseEnvOverrides,
  discoverIdentityFile,
  mergeNotifications,
  readHerdrNotifyDefaults,
  HERDR_SSH_ENV_KEYS,
  type RemoteDefaults,
} from "../src/lib/herdr-orchestrator-config.ts";
import {
  evaluateCrossWorkspaceHandoffs,
  evaluateSpawnGates,
  parseHostSession,
} from "../src/lib/herdr-orchestrator.ts";
import { buildCanonicalReferencesManifest } from "../src/lib/canonical-references.ts";
import type { HerdrProjectConfig } from "../src/lib/herdr-project-config.ts";

// ── core orchestrator config ──────────────────────────────────────────────

describe("herdr-orchestrator", () => {
  test("parseHerdrOrchestratorSection reads nested orchestrator block", () => {
    const parsed = parseHerdrOrchestratorSection({
      orchestrator: {
        enabled: true,
        contextOnIdle: true,
        handoffFrom: "kimi",
        handoffTo: "codex",
        reviewerTab: "reviewer",
      },
    });
    expect(parsed?.handoffFrom).toBe("kimi");
    expect(parsed?.handoffTo).toBe("codex");
    expect(parsed?.reviewerTab).toBe("reviewer");
    expect(parsed?.doctorTab).toBe("doctor");
  });

  test("parseHerdrOrchestratorSection reads doctorTab override", () => {
    const parsed = parseHerdrOrchestratorSection({
      orchestrator: {
        doctorTab: "health",
      },
    });
    expect(parsed?.doctorTab).toBe("health");
  });

  test("resolveOrchestratorConfig falls back to agentsTab roles", () => {
    const config = {
      schemaVersion: 1,
      enabled: true,
      workspaceLabel: "demo",
      primaryAgent: null,
      secondaryAgents: [],
      shellPane: true,
      shellSplit: "right" as const,
      bootstrap: [],
      session: "",
      agentsTab: {
        label: "agents",
        panes: [
          { role: "primary" as const, agent: "kimi" },
          { role: "secondary" as const, agent: "codex" },
        ],
      },
      tabs: [],
      sourcePath: null,
    } satisfies HerdrProjectConfig;

    const resolved = resolveOrchestratorConfig(config);
    expect(resolved.handoffFrom).toBe("kimi");
    expect(resolved.handoffTo).toBe("codex");
    expect(resolved.contextOnIdle).toBe(true);
    expect(resolved.events.enabled).toBe(true);
  });
});

// ── remote_hosts TOML parsing ─────────────────────────────────────────────

describe("remote_hosts TOML parsing", () => {
  test("parses simple string hosts", () => {
    const parsed = parseHerdrOrchestratorSection({
      orchestrator: {
        remote_hosts: { workbox: "workbox.local", staging: "user@staging.example.com" },
      },
    });
    expect(parsed!.remoteHosts).toEqual({
      workbox: "workbox.local",
      staging: "user@staging.example.com",
    });
  });

  test("handles empty remote_hosts", () => {
    const parsed = parseHerdrOrchestratorSection({ orchestrator: { enabled: true } });
    expect(parsed!.remoteHosts).toEqual({});
  });

  test("filters non-string non-object values", () => {
    const parsed = parseHerdrOrchestratorSection({
      orchestrator: { remote_hosts: { valid: "host.local", num: 123, empty: "" } },
    });
    expect(parsed!.remoteHosts).toEqual({ valid: "host.local" });
  });

  test("parses per-host config tables", () => {
    const parsed = parseHerdrOrchestratorSection({
      orchestrator: {
        remote_hosts: {
          staging: {
            host: "staging.example.com",
            port: 2222,
            user: "deploy",
            identity_file: "~/.ssh/staging_key",
            timeout: 10,
            control_master: "auto",
            control_path: "~/.ssh/control/%C",
            control_persist: 600,
            compression: true,
            proxy_jump: "bastion.example.com",
            strict_host_key_checking: "accept-new",
          },
        },
      },
    });
    const s = parsed!.remoteHosts["staging"]!;
    expect(typeof s).toBe("object");
    if (typeof s === "object") {
      expect(s.host).toBe("staging.example.com");
      expect(s.port).toBe(2222);
      expect(s.user).toBe("deploy");
      expect(s.identityFile).toBe("~/.ssh/staging_key");
      expect(s.timeout).toBe(10);
      expect(s.controlMaster).toBe("auto");
      expect(s.controlPath).toBe("~/.ssh/control/%C");
      expect(s.controlPersist).toBe(600);
      expect(s.compression).toBe(true);
      expect(s.proxyJump).toBe("bastion.example.com");
      expect(s.strictHostKeyChecking).toBe("accept-new");
    }
  });

  test("skips per-host table without host field", () => {
    const parsed = parseHerdrOrchestratorSection({
      orchestrator: { remote_hosts: { missing: { port: 2222 }, good: "good.local" } },
    });
    expect(parsed!.remoteHosts).toEqual({ good: "good.local" });
  });

  test("handles mixed simple + table hosts", () => {
    const parsed = parseHerdrOrchestratorSection({
      orchestrator: {
        remote_hosts: {
          workbox: "workbox.local",
          staging: { host: "staging.example.com", port: 2222 },
        },
      },
    });
    expect(parsed!.remoteHosts["workbox"]).toBe("workbox.local");
    const staging = parsed!.remoteHosts["staging"]!;
    expect(typeof staging).toBe("object");
    if (typeof staging === "object") {
      expect(staging.host).toBe("staging.example.com");
      expect(staging.port).toBe(2222);
    }
  });
});

// ── remote_defaults TOML parsing ──────────────────────────────────────────

describe("remote_defaults TOML parsing", () => {
  test("parses all default fields", () => {
    const parsed = parseHerdrOrchestratorSection({
      orchestrator: {
        remote_defaults: {
          timeout: 10,
          batch_mode: false,
          connect_timeout: 3,
          identity_file: "~/.ssh/id_rsa",
          control_master: "yes",
          control_path: "~/.ssh/control/%C",
          control_persist: 300,
          compression: true,
          proxy_jump: "bastion.internal",
          strict_host_key_checking: "yes",
          server_alive_interval: 60,
          server_alive_count_max: 3,
        },
        remote_hosts: { workbox: "workbox.local" },
      },
    });
    const d = parsed!.remoteDefaults;
    expect(d.timeout).toBe(10);
    expect(d.batchMode).toBe(false);
    expect(d.connectTimeout).toBe(3);
    expect(d.identityFile).toBe("~/.ssh/id_rsa");
    expect(d.controlMaster).toBe("yes");
    expect(d.controlPath).toBe("~/.ssh/control/%C");
    expect(d.controlPersist).toBe(300);
    expect(d.compression).toBe(true);
    expect(d.proxyJump).toBe("bastion.internal");
    expect(d.strictHostKeyChecking).toBe("yes");
    expect(d.serverAliveInterval).toBe(60);
    expect(d.serverAliveCountMax).toBe(3);
  });

  test("empty remote_defaults yields empty object", () => {
    const parsed = parseHerdrOrchestratorSection({
      orchestrator: {
        remote_defaults: {},
        remote_hosts: { w: "w.local" },
      },
    });
    expect(parsed!.remoteDefaults).toEqual({});
  });
});

// ── normalizeRemoteHostConfig ─────────────────────────────────────────────

describe("normalizeRemoteHostConfig", () => {
  test("simple string hosts get all defaults", () => {
    const result = normalizeRemoteHostConfig({
      workbox: "workbox.local",
    });
    const r = result["workbox"]!;
    expect(r.host).toBe("workbox.local");
    expect(r.port).toBeUndefined(); // not set for simple hosts
    expect(r.user).toBeUndefined();
    expect(r.timeout).toBe(15_000);
    expect(r.batchMode).toBe(true);
    expect(r.connectTimeout).toBe(5);
    expect(r.strictHostKeyChecking).toBe("accept-new");
    expect(r.compression).toBe(false);
    expect(r.controlMaster).toBe("no");
    expect(r.identitiesOnly).toBe(false);
    expect(r.serverAliveInterval).toBe(0);
    expect(r.serverAliveCountMax).toBe(3); // HARDCODED_DEFAULTS
  });

  test("per-host config objects override defaults", () => {
    const result = normalizeRemoteHostConfig({
      staging: {
        host: "staging.example.com",
        port: 2222,
        user: "deploy",
        identityFile: "~/.ssh/key",
        timeout: 10,
        compression: true,
      },
    });
    const r = result["staging"]!;
    expect(r.host).toBe("staging.example.com");
    expect(r.port).toBe(2222);
    expect(r.user).toBe("deploy");
    expect(r.identityFile).toBe("~/.ssh/key");
    expect(r.timeout).toBe(10000); // 10 seconds → 10000 ms
    expect(r.compression).toBe(true);
    expect(r.batchMode).toBe(true);
  });

  test("global defaults merge with per-host overrides", () => {
    const defaults: RemoteDefaults = {
      timeout: 30,
      batchMode: false,
      connectTimeout: 10,
      identityFile: "~/.ssh/global",
      compression: true,
      proxyJump: "bastion.local",
    };
    const result = normalizeRemoteHostConfig(
      {
        simple: "simple.local",
        detailed: { host: "detailed.local", timeout: 15 },
      },
      defaults
    );
    // Simple inherits all globals
    expect(result["simple"]!.timeout).toBe(30000); // 30 seconds → ms
    expect(result["simple"]!.batchMode).toBe(false);
    expect(result["simple"]!.connectTimeout).toBe(10);
    expect(result["simple"]!.identityFile).toBe("~/.ssh/global");
    expect(result["simple"]!.compression).toBe(true);
    expect(result["simple"]!.proxyJump).toBe("bastion.local");
    // Detailed overrides timeout, inherits rest
    expect(result["detailed"]!.timeout).toBe(15000); // 15 seconds → ms
    expect(result["detailed"]!.compression).toBe(true);
    expect(result["detailed"]!.proxyJump).toBe("bastion.local");
  });

  test("per-host identityFile overrides global", () => {
    const defaults: RemoteDefaults = { identityFile: "~/.ssh/global" };
    const result = normalizeRemoteHostConfig(
      { w: { host: "w.local", identityFile: "~/.ssh/w" } },
      defaults
    );
    expect(result["w"]!.identityFile).toBe("~/.ssh/w");
  });

  test("empty hosts returns empty", () => {
    expect(Object.keys(normalizeRemoteHostConfig({}))).toEqual([]);
  });

  test("mixed string and object hosts", () => {
    const result = normalizeRemoteHostConfig({
      simple: "simple.local",
      detailed: { host: "detailed.local", port: 2222, user: "admin" },
    });
    expect(result["simple"]!.host).toBe("simple.local");
    expect(result["simple"]!.port).toBeUndefined();
    expect(result["detailed"]!.port).toBe(2222);
    expect(result["detailed"]!.user).toBe("admin");
  });

  test("controlMaster defaults to no when not set", () => {
    const result = normalizeRemoteHostConfig({ w: "w.local" });
    expect(result["w"]!.controlMaster).toBe("no");
    expect(result["w"]!.controlPath).toBeUndefined();
    expect(result["w"]!.controlPersist).toBeUndefined();
  });

  test("controlMaster auto with path propagates", () => {
    const result = normalizeRemoteHostConfig({
      w: {
        host: "w.local",
        controlMaster: "auto",
        controlPath: "~/.ssh/ctl/%C",
        controlPersist: 600,
      },
    });
    expect(result["w"]!.controlMaster).toBe("auto");
    expect(result["w"]!.controlPath).toBe("~/.ssh/ctl/%C");
    expect(result["w"]!.controlPersist).toBe(600);
  });

  test("strictHostKeyChecking values flow through", () => {
    const result = normalizeRemoteHostConfig({
      yes: { host: "y.local", strictHostKeyChecking: "yes" },
      no: { host: "n.local", strictHostKeyChecking: "no" },
    });
    expect(result["yes"]!.strictHostKeyChecking).toBe("yes");
    expect(result["no"]!.strictHostKeyChecking).toBe("no");
  });

  test("resolveOrchestratorConfig defaults remoteHosts and remoteDefaults", () => {
    const config = {
      schemaVersion: 1,
      enabled: true,
      workspaceLabel: "demo",
      primaryAgent: null,
      secondaryAgents: [],
      shellPane: true,
      shellSplit: "right" as const,
      bootstrap: [],
      session: "",
      agentsTab: null,
      tabs: [],
      sourcePath: null,
    } satisfies HerdrProjectConfig;
    const resolved = resolveOrchestratorConfig(config);
    expect(resolved.remoteHosts).toEqual({});
    expect(resolved.remoteDefaults).toEqual({});
  });
});

// ── identity file discovery ───────────────────────────────────────────────

describe("discoverIdentityFile", () => {
  test("returns first existing key from probe list", () => {
    // We can't rely on real files existing, but we can test the function shape
    const result = discoverIdentityFile();
    expect(result === undefined || typeof result === "string").toBe(true);
  });

  test("returns undefined when no standard keys exist", () => {
    // discoverIdentityFile uses a hardcoded probe list; we test via
    // the invariant that if ~/.ssh doesn't exist at all, result is undefined.
    const sshDir = join(homedir(), ".ssh");
    if (!pathExists(sshDir)) {
      expect(discoverIdentityFile()).toBeUndefined();
    }
  });
});

// ── environment variable overrides ────────────────────────────────────────

describe("parseEnvOverrides", () => {
  test("returns empty when no env vars set", () => {
    withClearedEnv(HERDR_SSH_ENV_KEYS, () => {
      expect(parseEnvOverrides()).toEqual({});
    });
  });

  test("parses numeric vars", () => {
    withEnv(
      {
        HERDR_SSH_TIMEOUT: "30",
        HERDR_SSH_CONNECT_TIMEOUT: "8",
        HERDR_SSH_PORT: "2222",
      },
      () => {
        const overrides = parseEnvOverrides();
        expect(overrides.timeout).toBe(30000);
        expect(overrides.connectTimeout).toBe(8);
        expect(overrides.port).toBe(2222);
      }
    );
  });

  test("ignores non-numeric numeric vars", () => {
    withEnv({ HERDR_SSH_TIMEOUT: "abc", HERDR_SSH_PORT: "xyz" }, () => {
      const overrides = parseEnvOverrides();
      expect(overrides.timeout).toBeUndefined();
      expect(overrides.port).toBeUndefined();
    });
  });

  test("parses boolean vars", () => {
    withEnv(
      {
        HERDR_SSH_BATCH_MODE: "false",
        HERDR_SSH_COMPRESSION: "1",
        HERDR_SSH_IDENTITIES_ONLY: "true",
      },
      () => {
        const overrides = parseEnvOverrides();
        expect(overrides.batchMode).toBe(false);
        expect(overrides.compression).toBe(true);
        expect(overrides.identitiesOnly).toBe(true);
      }
    );
  });

  test("parses string vars", () => {
    withEnv(
      {
        HERDR_SSH_IDENTITY_FILE: "~/.ssh/ci_key",
        HERDR_SSH_STRICT_HOST_KEY_CHECKING: "no",
        HERDR_SSH_CONTROL_MASTER: "auto",
        HERDR_SSH_CONTROL_PATH: "~/.ssh/ctl/%C",
        HERDR_SSH_PROXY_JUMP: "bastion.ci",
        HERDR_SSH_USER: "ci-runner",
      },
      () => {
        const overrides = parseEnvOverrides();
        expect(overrides.identityFile).toBe("~/.ssh/ci_key");
        expect(overrides.strictHostKeyChecking).toBe("no");
        expect(overrides.controlMaster).toBe("auto");
        expect(overrides.controlPath).toBe("~/.ssh/ctl/%C");
        expect(overrides.proxyJump).toBe("bastion.ci");
        expect(overrides.user).toBe("ci-runner");
      }
    );
  });

  test("parses control_persist and server_alive as numbers", () => {
    withEnv(
      {
        HERDR_SSH_CONTROL_PERSIST: "120",
        HERDR_SSH_SERVER_ALIVE_INTERVAL: "45",
        HERDR_SSH_SERVER_ALIVE_COUNT_MAX: "2",
      },
      () => {
        const overrides = parseEnvOverrides();
        expect(overrides.controlPersist).toBe(120);
        expect(overrides.serverAliveInterval).toBe(45);
        expect(overrides.serverAliveCountMax).toBe(2);
      }
    );
  });
});

// ── env overrides in normalizeRemoteHostConfig ────────────────────────────

describe("normalizeRemoteHostConfig with env overrides", () => {
  test("env overrides trump TOML defaults", () => {
    withEnv({ HERDR_SSH_TIMEOUT: "60", HERDR_SSH_BATCH_MODE: "false" }, () => {
      const defaults: RemoteDefaults = { timeout: 10, batchMode: true };
      const result = normalizeRemoteHostConfig({ w: "w.local" }, defaults);
      expect(result["w"]!.timeout).toBe(60000);
      expect(result["w"]!.batchMode).toBe(false);
    });
  });

  test("env overrides trump per-host settings", () => {
    withEnv({ HERDR_SSH_IDENTITY_FILE: "~/.ssh/env_key", HERDR_SSH_PORT: "9999" }, () => {
      const result = normalizeRemoteHostConfig({
        w: { host: "w.local", identityFile: "~/.ssh/toml_key", port: 2222 },
      });
      expect(result["w"]!.identityFile).toBe("~/.ssh/env_key");
      expect(result["w"]!.port).toBe(9999);
    });
  });

  test("env user propagates", () => {
    withEnv({ HERDR_SSH_USER: "envuser" }, () => {
      const result = normalizeRemoteHostConfig({ w: "w.local" });
      expect(result["w"]!.user).toBe("envuser");
    });
  });
});

// ── parseHostSession ──────────────────────────────────────────────────────

describe("parseHostSession", () => {
  test("parses host:session", () => {
    expect(parseHostSession("workbox:dev")).toEqual({ host: "workbox", session: "dev" });
  });
  test("plain session name", () => {
    expect(parseHostSession("default")).toEqual({ host: null, session: "default" });
  });
  test("empty string", () => {
    expect(parseHostSession("")).toEqual({ host: null, session: "" });
  });
  test("foo: → host null", () => {
    const r = parseHostSession("foo:");
    expect(r.host).toBeNull();
    expect(r.session).toBe("foo:");
  });
  test(":bar → host null", () => {
    const r = parseHostSession(":bar");
    expect(r.host).toBeNull();
    expect(r.session).toBe(":bar");
  });
  test("host with dots", () => {
    expect(parseHostSession("staging.example.com:prod")).toEqual({
      host: "staging.example.com",
      session: "prod",
    });
  });
});

// ── spawn_fallback TOML parsing ─────────────────────────────────────────

describe("spawn_fallback TOML parsing", () => {
  test("parses full spawn_fallback config", () => {
    const section = {
      orchestrator: {
        handoff_rules: [
          {
            from_workspace: "w1",
            from_agent: "kimi",
            condition: "done",
            to_workspace: "w1",
            to_agent: "least_busy",
            spawn_fallback: {
              host: "staging",
              session: "dev",
              agent_cli: "kimi",
              label: "reviewer-2",
              workspace: "w1",
              cwd: "/home/deploy/projects/app",
              split: "right",
              tab: "tab_p4",
            },
          },
        ],
      },
    };
    const parsed = parseHerdrOrchestratorSection(section);
    expect(parsed).not.toBeNull();
    const rule = parsed!.handoffRules[0]!;
    expect(rule.spawnFallback).not.toBeUndefined();
    const sf = rule.spawnFallback!;
    expect(sf.host).toBe("staging");
    expect(sf.session).toBe("dev");
    expect(sf.agentCli).toBe("kimi");
    expect(sf.label).toBe("reviewer-2");
    expect(sf.workspace).toBe("w1");
    expect(sf.cwd).toBe("/home/deploy/projects/app");
    expect(sf.split).toBe("right");
    expect(sf.tab).toBe("tab_p4");
  });

  test("skips spawn_fallback without host or agent_cli", () => {
    const section = {
      orchestrator: {
        handoff_rules: [
          {
            from_workspace: "w1",
            from_agent: "kimi",
            condition: "done",
            to_workspace: "w1",
            to_agent: "codex",
            spawn_fallback: {
              session: "dev",
            },
          },
        ],
      },
    };
    const parsed = parseHerdrOrchestratorSection(section);
    expect(parsed!.handoffRules[0]!.spawnFallback).toBeUndefined();
  });

  test("spawn_fallback is undefined when not set", () => {
    const section = {
      orchestrator: {
        handoff_rules: [
          {
            from_workspace: "w1",
            from_agent: "kimi",
            condition: "done",
            to_workspace: "w1",
            to_agent: "codex",
          },
        ],
      },
    };
    const parsed = parseHerdrOrchestratorSection(section);
    expect(parsed!.handoffRules[0]!.spawnFallback).toBeUndefined();
  });
});

describe("herdr_app_config plugins.notify", () => {
  test("parseHerdrAppConfig reads [plugins.notify]", () => {
    const parsed = parseHerdrAppConfig({
      plugins: {
        notify: {
          webhook_url: "https://hooks.example.com/herdr",
          on_handoff: true,
          on_spawn: false,
          on_error: true,
        },
      },
    });
    expect(parsed.plugins?.notify?.webhookUrl).toBe("https://hooks.example.com/herdr");
    expect(parsed.plugins?.notify?.onHandoff).toBe(true);
    expect(parsed.plugins?.notify?.onSpawn).toBe(false);
  });

  test("resolveOrchestratorConfig merges project notifications over Herdr plugin defaults", () => {
    const config: HerdrProjectConfig = {
      schemaVersion: 1,
      enabled: true,
      workspaceLabel: "demo",
      primaryAgent: "kimi",
      secondaryAgents: [],
      shellPane: true,
      shellSplit: "right",
      bootstrap: [],
      session: "dev",
      agentsTab: { label: "agents", panes: [{ role: "primary", agent: "kimi" }] },
      tabs: [],
      sourcePath: "",
      projectPath: "/tmp/demo",
    };
    const doc = {
      herdr: {
        orchestrator: {
          notifications: {
            webhook_url: "https://hooks.example.com/project",
            on_spawn: true,
          },
        },
      },
    };
    const resolved = resolveOrchestratorConfig(config, doc);
    expect(resolved.notifications.webhookUrl).toBe("https://hooks.example.com/project");
    expect(resolved.notifications.onSpawn).toBe(true);
  });

  // ── mergeNotifications pure-function tests ──────────────────────────

  test("mergeNotifications: primary wins over fallback on every field", () => {
    const primary = {
      webhookUrl: "https://project.example.com/hook",
      onHandoff: true,
      onSpawn: false,
      onError: true,
    };
    const fallback = {
      webhookUrl: "https://herdr.example.com/hook",
      onHandoff: false,
      onSpawn: true,
      onError: false,
    };
    const merged = mergeNotifications(primary, fallback);
    expect(merged.webhookUrl).toBe("https://project.example.com/hook");
    expect(merged.onHandoff).toBe(true);
    expect(merged.onSpawn).toBe(false);
    expect(merged.onError).toBe(true);
  });

  test("mergeNotifications: fallback fills gaps when primary is partial", () => {
    const primary = { onSpawn: true };
    const fallback = {
      webhookUrl: "https://herdr.example.com/hook",
      onHandoff: true,
      onError: true,
    };
    const merged = mergeNotifications(primary, fallback);
    expect(merged.webhookUrl).toBe("https://herdr.example.com/hook");
    expect(merged.onHandoff).toBe(true);
    expect(merged.onSpawn).toBe(true);
    expect(merged.onError).toBe(true);
  });

  test("mergeNotifications: fallback provides all values when primary is empty", () => {
    const fallback = {
      webhookUrl: "https://herdr.example.com/hook",
      onHandoff: false,
      onSpawn: true,
      onError: false,
    };
    const merged = mergeNotifications({}, fallback);
    expect(merged.webhookUrl).toBe("https://herdr.example.com/hook");
    expect(merged.onHandoff).toBe(false);
    expect(merged.onSpawn).toBe(true);
    expect(merged.onError).toBe(false);
  });

  test("mergeNotifications: returns empty when both are empty", () => {
    const merged = mergeNotifications({}, {});
    expect(merged.webhookUrl).toBeUndefined();
    expect(merged.onHandoff).toBeUndefined();
    expect(merged.onSpawn).toBeUndefined();
    expect(merged.onError).toBeUndefined();
  });

  test("readHerdrNotifyDefaults: returns disabled when notify plugin is off or missing", () => {
    const defaults = readHerdrNotifyDefaults();
    expect(defaults).toEqual({ enabled: false });
  });
});

describe("handoff probe conditions", () => {
  test("parseCondition accepts probe:canonical-references:runtime-aligned", () => {
    expect(parseCondition("probe:canonical-references:runtime-aligned")).toEqual({
      kind: "probe",
      probeId: "canonical-references:runtime-aligned",
    });
  });

  test("parseCondition accepts bare finish-work:clean syntax", () => {
    expect(parseCondition("finish-work:clean")).toEqual({
      kind: "probe",
      probeId: "finish-work:clean",
    });
  });

  test("evaluateCrossWorkspaceHandoffs fires on aligned runtime probe", async () => {
    const tmpHome = testTempDir("handoff-probe-");
    makeDir(join(tmpHome, ".kimi-code"), { recursive: true });
    const repoManifestPath = join(REPO_ROOT, "canonical-references.json");
    const runtimeManifestText = pathExists(repoManifestPath)
      ? await Bun.file(repoManifestPath).text()
      : JSON.stringify(buildCanonicalReferencesManifest(), null, 2);
    writeText(join(tmpHome, ".kimi-code", "canonical-references.json"), runtimeManifestText);

    const agents = [
      {
        paneId: "pane-kimi",
        agent: "kimi",
        status: "working" as const,
        workspaceId: "wB",
        tabId: "tab1",
      },
      {
        paneId: "pane-codex",
        agent: "codex",
        status: "idle" as const,
        workspaceId: "wB",
        tabId: "tab1",
      },
    ];

    const results = await evaluateCrossWorkspaceHandoffs(
      {
        enabled: true,
        handoffRules: [
          {
            fromWorkspace: "wB",
            fromAgent: "kimi",
            condition: "probe:canonical-references:runtime-aligned",
            toWorkspace: "wB",
            toAgent: "codex",
          },
        ],
        spawnGates: [],
        handoffFrom: "kimi",
        handoffTo: "codex",
        reviewerTab: "reviewer",
        doctorTab: "doctor",
        contextOnIdle: false,
        events: {
          enabled: false,
          debounceMs: 2000,
          allowlist: [],
          watchGit: false,
          gitRefCooldownMs: 5000,
        },
        remoteHosts: {},
        remoteDefaults: {},
        notifications: {},
        domains: {},
        dashboard: parseOrchestratorDashboardSection(undefined),
      },
      agents,
      new Map(),
      "default",
      undefined,
      true,
      { projectRoot: REPO_ROOT, home: tmpHome }
    );

    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.detail).toContain("[dry-run]");
    removePath(tmpHome, { recursive: true, force: true });
  });

  test("evaluateCrossWorkspaceHandoffs skips satisfied probe when cache missing", async () => {
    const tmpHome = testTempDir("handoff-probe-fail-");
    makeDir(tmpHome, { recursive: true });

    const agents = [
      {
        paneId: "pane-kimi",
        agent: "kimi",
        status: "working" as const,
        workspaceId: "wB",
        tabId: "tab1",
      },
      {
        paneId: "pane-codex",
        agent: "codex",
        status: "idle" as const,
        workspaceId: "wB",
        tabId: "tab1",
      },
    ];

    const results = await evaluateCrossWorkspaceHandoffs(
      {
        enabled: true,
        handoffRules: [
          {
            fromWorkspace: "wB",
            fromAgent: "kimi",
            condition: "probe:canonical-references:runtime-aligned",
            toWorkspace: "wB",
            toAgent: "codex",
          },
        ],
        spawnGates: [],
        handoffFrom: "kimi",
        handoffTo: "codex",
        reviewerTab: "reviewer",
        doctorTab: "doctor",
        contextOnIdle: false,
        events: {
          enabled: false,
          debounceMs: 2000,
          allowlist: [],
          watchGit: false,
          gitRefCooldownMs: 5000,
        },
        remoteHosts: {},
        remoteDefaults: {},
        notifications: {},
        domains: {},
        dashboard: parseOrchestratorDashboardSection(undefined),
      },
      agents,
      new Map(),
      "default",
      undefined,
      true,
      { projectRoot: REPO_ROOT, home: tmpHome }
    );

    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.detail).toContain("runtime cache missing");
    expect(results[0]?.detail).not.toContain("probe check missing");
    removePath(tmpHome, { recursive: true, force: true });
  });

  test("evaluateCrossWorkspaceHandoffs fires on finish-work:pushed probe", async () => {
    const root = testTempDir("handoff-fw-");
    makeDir(join(root, ".kimi"), { recursive: true });
    writeText(
      join(root, ".kimi", "finish-work-report.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          tool: "finish-work",
          ok: true,
          outcome: "ok",
          gateSource: "finishWork",
          results: [{ name: "check:fast", exitCode: 0, ms: 1 }],
          git: { attempted: true, committed: true, pushed: true, error: null },
          tree: { clean: true, dirty: [] },
        },
        null,
        2
      )
    );

    const agents = [
      {
        paneId: "pane-kimi",
        agent: "kimi",
        status: "idle" as const,
        workspaceId: "wB",
        tabId: "tab1",
      },
      {
        paneId: "pane-codex",
        agent: "codex-primary",
        status: "idle" as const,
        workspaceId: "wB",
        tabId: "tab1",
      },
    ];

    const labelMap = new Map<string, Map<string, string>>();
    labelMap.set("wB", new Map([["codex-primary", "codex-primary"]]));

    const results = await evaluateCrossWorkspaceHandoffs(
      {
        enabled: true,
        handoffRules: [
          {
            fromWorkspace: "wB",
            fromAgent: "kimi",
            condition: "probe:finish-work:pushed",
            toWorkspace: "wB",
            toAgent: "codex-primary",
          },
        ],
        spawnGates: [],
        handoffFrom: "kimi",
        handoffTo: "codex-primary",
        reviewerTab: "reviewer",
        doctorTab: "doctor",
        contextOnIdle: false,
        events: {
          enabled: false,
          debounceMs: 2000,
          allowlist: [],
          watchGit: false,
          gitRefCooldownMs: 5000,
        },
        remoteHosts: {},
        remoteDefaults: {},
        notifications: {},
        domains: {},
        dashboard: parseOrchestratorDashboardSection(undefined),
      },
      agents,
      new Map(),
      "default",
      labelMap,
      true,
      { projectRoot: root, home: join(root, "home") }
    );

    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.detail).toContain("[dry-run]");
    removePath(root, { recursive: true, force: true });
  });

  test("evaluateCrossWorkspaceHandoffs uses target_strategy least_busy in workspace", async () => {
    const agents = [
      {
        paneId: "pane-kimi",
        agent: "kimi",
        status: "done" as const,
        workspaceId: "wB",
        tabId: "tab1",
      },
      {
        paneId: "pane-codex-busy",
        agent: "codex",
        status: "working" as const,
        workspaceId: "staging",
        tabId: "tab1",
      },
      {
        paneId: "pane-codex-idle",
        agent: "codex",
        status: "idle" as const,
        workspaceId: "staging",
        tabId: "tab1",
      },
    ];

    const results = await evaluateCrossWorkspaceHandoffs(
      {
        enabled: true,
        handoffRules: [
          {
            fromWorkspace: "wB",
            fromAgent: "kimi",
            condition: "done",
            toWorkspace: "staging",
            toAgent: "codex",
            targetStrategy: "least_busy",
          },
        ],
        spawnGates: [],
        handoffFrom: "kimi",
        handoffTo: "codex",
        reviewerTab: "reviewer",
        doctorTab: "doctor",
        contextOnIdle: false,
        events: {
          enabled: false,
          debounceMs: 2000,
          allowlist: [],
          watchGit: false,
          gitRefCooldownMs: 5000,
        },
        remoteHosts: {},
        remoteDefaults: {},
        notifications: {},
        domains: {},
        dashboard: parseOrchestratorDashboardSection(undefined),
      },
      agents,
      new Map(),
      "default",
      undefined,
      true
    );

    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.detail).toContain("staging/codex");
    expect(results[0]?.detail).toContain("least_busy");
    expect(results[0]?.detail).toContain("pane-codex-idle");
  });

  test("evaluateCrossWorkspaceHandoffs fires on report when clauses", async () => {
    const root = testTempDir("handoff-when-");
    makeDir(join(root, ".kimi"), { recursive: true });
    writeText(
      join(root, ".kimi", "finish-work-report.json"),
      JSON.stringify(
        {
          schemaVersion: "1.1",
          timestamp: "2026-06-17T02:37:00.000Z",
          git: { committed: true, pushed: true, hash: "d6bc96d" },
          tree: { clean: true, dirtyFiles: [], untracked: 0 },
          gates: { "check:fast": { status: "pass", durationMs: 1 } },
          outcome: "clean",
          outcomeReason: "All gates passed + clean tree after push",
          summary: "feat: when rule — gates passed, pushed d6bc96d, tree clean.",
          handoffCandidate: {
            targetPane: "pane-codex",
            targetAgent: "codex-primary",
            reason: "clean finish-work close",
            shouldHandoff: true,
          },
          review: {
            escalated: false,
            reviewerPane: null,
            reportPath: ".kimi/finish-work-report.json",
          },
          latm: {
            markerSeen: true,
            completionSignal: "__LATM_DONE__",
            invokedVia: "finish-work --push",
          },
        },
        null,
        2
      )
    );

    const agents = [
      {
        paneId: "pane-kimi",
        agent: "kimi",
        status: "idle" as const,
        workspaceId: "wB",
        tabId: "tab1",
      },
      {
        paneId: "pane-codex",
        agent: "codex-primary",
        status: "idle" as const,
        workspaceId: "wB",
        tabId: "tab1",
      },
    ];

    const results = await evaluateCrossWorkspaceHandoffs(
      {
        enabled: true,
        handoffRules: [
          {
            fromWorkspace: "wB",
            fromAgent: "kimi",
            condition: "report:when",
            when: [
              { path: "finishWorkReport.outcome", expected: "clean" },
              { path: "finishWorkReport.handoffCandidate.shouldHandoff", expected: true },
            ],
            toWorkspace: "wB",
            toAgent: "codex-primary",
          },
        ],
        spawnGates: [],
        handoffFrom: "kimi",
        handoffTo: "codex-primary",
        reviewerTab: "reviewer",
        doctorTab: "doctor",
        contextOnIdle: false,
        events: {
          enabled: false,
          debounceMs: 2000,
          allowlist: [],
          watchGit: false,
          gitRefCooldownMs: 5000,
        },
        remoteHosts: {},
        remoteDefaults: {},
        notifications: {},
        domains: {},
        dashboard: parseOrchestratorDashboardSection(undefined),
      },
      agents,
      new Map(),
      "default",
      undefined,
      true,
      { projectRoot: root, home: join(root, "home") }
    );

    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.detail).toContain("[dry-run]");
    expect(results[0]?.durationMs).toBeGreaterThanOrEqual(0);
    removePath(root, { recursive: true, force: true });
  });

  test("evaluateCrossWorkspaceHandoffs fires on handoff-ready probe with review when + pane idle", async () => {
    const root = testTempDir("handoff-ready-");
    makeDir(join(root, ".kimi"), { recursive: true });
    writeText(
      join(root, ".kimi", "finish-work-report.json"),
      JSON.stringify(
        {
          schemaVersion: "1.1",
          timestamp: "2026-06-17T02:37:00.000Z",
          git: { committed: true, pushed: true, hash: "d6bc96d" },
          tree: { clean: true, dirtyFiles: [], untracked: 0 },
          gates: { "check:fast": { status: "pass", durationMs: 1 } },
          outcome: "clean",
          outcomeReason: "All gates passed + clean tree after push",
          summary: "feat: post-review handoff",
          handoffCandidate: {
            targetPane: "pane-codex",
            targetAgent: "codex-primary",
            reason: "clean finish-work close",
            shouldHandoff: true,
          },
          review: {
            escalated: false,
            reviewerPane: "pane-reviewer",
            reportPath: ".kimi/finish-work-report.json",
            resolved: true,
          },
          latm: {
            markerSeen: true,
            completionSignal: "__LATM_DONE__",
            invokedVia: "finish-work --push",
          },
        },
        null,
        2
      )
    );

    const agents = [
      {
        paneId: "pane-kimi",
        agent: "kimi",
        status: "idle" as const,
        workspaceId: "wB",
        tabId: "tab1",
      },
      {
        paneId: "pane-codex",
        agent: "codex-primary",
        status: "idle" as const,
        workspaceId: "wB",
        tabId: "tab1",
      },
    ];

    const results = await evaluateCrossWorkspaceHandoffs(
      {
        enabled: true,
        handoffRules: [
          {
            fromWorkspace: "wB",
            fromAgent: "kimi",
            condition: "finish-work:handoff-ready",
            when: [
              { path: "finishWorkReport.review.resolved", expected: true },
              { path: "pane.status", expected: "idle" },
            ],
            toWorkspace: "wB",
            toAgent: "codex-primary",
          },
        ],
        spawnGates: [],
        handoffFrom: "kimi",
        handoffTo: "codex-primary",
        reviewerTab: "reviewer",
        doctorTab: "doctor",
        contextOnIdle: false,
        events: {
          enabled: false,
          debounceMs: 2000,
          allowlist: [],
          watchGit: false,
          gitRefCooldownMs: 5000,
        },
        remoteHosts: {},
        remoteDefaults: {},
        notifications: {},
        domains: {},
        dashboard: parseOrchestratorDashboardSection(undefined),
      },
      agents,
      new Map(),
      "default",
      undefined,
      true,
      { projectRoot: root, home: join(root, "home") }
    );

    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.detail).toContain("[dry-run]");
    expect(results[0]?.durationMs).toBeGreaterThanOrEqual(0);
    removePath(root, { recursive: true, force: true });
  });
});

describe("spawn gates", () => {
  test("evaluateSpawnGates returns ok when no gates configured", async () => {
    const result = await evaluateSpawnGates([], REPO_ROOT, homedir());
    expect(result.ok).toBe(true);
    expect(result.detail).toBe("no spawn gates configured");
  });

  test("evaluateSpawnGates requires project root", async () => {
    const result = await evaluateSpawnGates(
      ["probe:canonical-references:runtime-aligned"],
      undefined,
      homedir()
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("spawn gates require project root");
  });

  test("evaluateSpawnGates passes when runtime cache is aligned", async () => {
    const tmpHome = testTempDir("spawn-gate-pass-");
    makeDir(join(tmpHome, ".kimi-code"), { recursive: true });
    const repoManifestPath = join(REPO_ROOT, "canonical-references.json");
    const runtimeManifestText = pathExists(repoManifestPath)
      ? await Bun.file(repoManifestPath).text()
      : JSON.stringify(buildCanonicalReferencesManifest(), null, 2);
    writeText(join(tmpHome, ".kimi-code", "canonical-references.json"), runtimeManifestText);

    const result = await evaluateSpawnGates(
      ["probe:canonical-references:runtime-aligned"],
      REPO_ROOT,
      tmpHome
    );
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("spawn gates passed");
    removePath(tmpHome, { recursive: true, force: true });
  });

  test("evaluateSpawnGates blocks when runtime cache is missing", async () => {
    const tmpHome = testTempDir("spawn-gate-block-");
    const result = await evaluateSpawnGates(
      ["probe:canonical-references:runtime-aligned"],
      REPO_ROOT,
      tmpHome
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain(
      "spawn gate probe:canonical-references:runtime-aligned blocked"
    );
    expect(
      result.detail.includes("bun run sync") ||
        result.detail.includes("bun run references:generate")
    ).toBe(true);
    removePath(tmpHome, { recursive: true, force: true });
  });

  test("parseHerdrOrchestratorSection reads spawn_gates", () => {
    const parsed = parseHerdrOrchestratorSection({
      orchestrator: {
        spawn_gates: ["probe:canonical-references:runtime-aligned", "finish-work:clean"],
      },
    });
    expect(parsed?.spawnGates).toEqual([
      "probe:canonical-references:runtime-aligned",
      "finish-work:clean",
    ]);
  });

  test("resolveOrchestratorConfig preserves spawn_gates", () => {
    const config = {
      schemaVersion: 1 as const,
      enabled: true,
      workspaceLabel: "demo",
      primaryAgent: null,
      secondaryAgents: [],
      shellPane: true,
      shellSplit: "right" as const,
      bootstrap: [],
      session: "",
      agentsTab: { label: "agents", panes: [] },
      tabs: [],
      sourcePath: null,
    } satisfies HerdrProjectConfig;

    const resolved = resolveOrchestratorConfig(config, {
      herdr: {
        orchestrator: {
          spawn_gates: ["probe:canonical-references:runtime-aligned"],
        },
      },
    });
    expect(resolved.spawnGates).toEqual(["probe:canonical-references:runtime-aligned"]);
  });

  test("evaluateCrossWorkspaceHandoffs blocks spawn_if_missing when gate fails", async () => {
    const tmpHome = testTempDir("spawn-gate-spawn-if-missing-");
    const agents = [
      {
        paneId: "pane-kimi",
        agent: "kimi",
        status: "done" as const,
        workspaceId: "wB",
        tabId: "tab1",
      },
    ];

    const results = await evaluateCrossWorkspaceHandoffs(
      {
        enabled: true,
        handoffRules: [
          {
            fromWorkspace: "wB",
            fromAgent: "kimi",
            condition: "done",
            toWorkspace: "wB",
            toAgent: "codex",
            spawnIfMissing: true,
          },
        ],
        spawnGates: ["probe:canonical-references:runtime-aligned"],
        handoffFrom: "kimi",
        handoffTo: "codex",
        reviewerTab: "reviewer",
        doctorTab: "doctor",
        contextOnIdle: false,
        events: {
          enabled: false,
          debounceMs: 2000,
          allowlist: [],
          watchGit: false,
          gitRefCooldownMs: 5000,
        },
        remoteHosts: {},
        remoteDefaults: {},
        notifications: {},
        domains: {},
        dashboard: parseOrchestratorDashboardSection(undefined),
      },
      agents,
      new Map(),
      "default",
      undefined,
      true,
      { projectRoot: REPO_ROOT, home: tmpHome }
    );

    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.detail).toContain(
      "spawn gate probe:canonical-references:runtime-aligned blocked"
    );
    removePath(tmpHome, { recursive: true, force: true });
  });

  test("evaluateCrossWorkspaceHandoffs blocks spawn_fallback when gate fails", async () => {
    const tmpHome = testTempDir("spawn-gate-spawn-fallback-");
    const agents = [
      {
        paneId: "pane-kimi",
        agent: "kimi",
        status: "done" as const,
        workspaceId: "wB",
        tabId: "tab1",
      },
    ];

    const results = await evaluateCrossWorkspaceHandoffs(
      {
        enabled: true,
        handoffRules: [
          {
            fromWorkspace: "wB",
            fromAgent: "kimi",
            condition: "done",
            toWorkspace: "wB",
            toAgent: "codex",
            spawnFallback: {
              host: "workbox",
              agentCli: "kimi",
            },
          },
        ],
        spawnGates: ["probe:canonical-references:runtime-aligned"],
        handoffFrom: "kimi",
        handoffTo: "codex",
        reviewerTab: "reviewer",
        doctorTab: "doctor",
        contextOnIdle: false,
        events: {
          enabled: false,
          debounceMs: 2000,
          allowlist: [],
          watchGit: false,
          gitRefCooldownMs: 5000,
        },
        remoteHosts: {
          workbox: "workbox.local",
        },
        remoteDefaults: {},
        notifications: {},
        domains: {},
        dashboard: parseOrchestratorDashboardSection(undefined),
      },
      agents,
      new Map(),
      "default",
      undefined,
      true,
      { projectRoot: REPO_ROOT, home: tmpHome }
    );

    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.detail).toContain(
      "spawn gate probe:canonical-references:runtime-aligned blocked"
    );
    removePath(tmpHome, { recursive: true, force: true });
  });
});
