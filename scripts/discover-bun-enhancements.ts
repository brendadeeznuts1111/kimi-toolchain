#!/usr/bin/env bun

import { $ } from "bun";
import { resolve } from "path";

interface BunRelease {
  version: string;
  title: string;
  publishedAt: string;
  link: string;
  description: string;
}

interface UpgradeFinding {
  ruleId: string;
  file: string;
  line: number;
  message: string;
  suggestion: string;
}

interface UpgradeReport {
  findings: UpgradeFinding[];
  summary: {
    total: number;
    byRule: Record<string, number>;
  };
}

interface DiscoveryGap {
  source: string;
  message: string;
}

interface DiscoveryReport {
  health: Record<string, number>;
  unifiedGaps: DiscoveryGap[];
}

type LayerResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function runJson<T>(cmd: string[], cwd: string): Promise<T> {
  const stdout = await $`${cmd}`.cwd(cwd).text();
  return JSON.parse(stdout) as T;
}

async function runText(cmd: string[], cwd: string): Promise<string> {
  const stdout = await $`${cmd}`.cwd(cwd).text();
  return stdout.trim();
}

async function runJsonLayer<T>(cmd: string[], cwd: string): Promise<LayerResult<T>> {
  try {
    return { ok: true, data: await runJson<T>(cmd, cwd) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function readTag(item: string, tag: string): string {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXmlText(match[1] ?? "") : "";
}

async function fetchReleasesFromRss(limit: number): Promise<BunRelease[]> {
  const response = await fetch("https://bun.com/rss.xml");
  if (!response.ok) {
    throw new Error(`https://bun.com/rss.xml returned ${response.status}`);
  }
  const xml = await response.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => match[1] ?? "")
    .map((item) => {
      const title = readTag(item, "title");
      return {
        version: title.replace(/^Bun\s+/, ""),
        title,
        publishedAt: new Date(readTag(item, "pubDate")).toISOString(),
        link: readTag(item, "link"),
        description: readTag(item, "description"),
      };
    })
    .filter((release) => /^Bun v\d+\.\d+\.\d+/.test(release.title))
    .slice(0, limit);
}

async function loadBunReleases(cwd: string, limit: number): Promise<BunRelease[]> {
  const blogIndex = Bun.which("bun-blog-index");
  if (blogIndex) {
    const report = await runJson<{ releases: BunRelease[] }>(
      [blogIndex, "--json", "--limit", String(limit)],
      cwd
    );
    return report.releases.slice(0, limit);
  }
  return fetchReleasesFromRss(limit);
}

function releaseImpact(release: BunRelease): string {
  const text = release.description.toLowerCase();
  const impacts: string[] = [];
  if (text.includes("global store")) impacts.push("enable install global store");
  if (text.includes("http/3") || text.includes("quic"))
    impacts.push("audit TLS Bun.serve for HTTP/3");
  if (text.includes("--no-orphans")) impacts.push("harden long-running scripts with --no-orphans");
  if (text.includes("--parallel") || text.includes("--shard") || text.includes("--changed")) {
    impacts.push("tighten test scripts around parallel/shard/changed");
  }
  if (text.includes("bun.glob") || text.includes("glob.scan"))
    impacts.push("benchmark discovery glob scans");
  if (text.includes("bun.cron")) impacts.push("review scheduled jobs for Bun.cron");
  if (text.includes("bun.image")) impacts.push("replace sharp-style image work where present");
  if (text.includes("bun.spawn")) impacts.push("retest MCP/subprocess behavior");
  return impacts.length ? impacts.join("; ") : "watch for compatibility and performance wins";
}

function formatFindings(findings: UpgradeFinding[]): string[] {
  if (findings.length === 0) return ["- No Bun upgrade-advisor findings."];
  return findings.map(
    (finding) =>
      `- ${finding.file}:${finding.line} [${finding.ruleId}] ${finding.message} — ${finding.suggestion}`
  );
}

async function main(): Promise<void> {
  const root = Bun.argv.includes("--root")
    ? resolve(Bun.argv[Bun.argv.indexOf("--root") + 1] ?? ".")
    : process.cwd();
  const limit = Number(Bun.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? 5);

  const [releases, bunVersion] = await Promise.all([
    loadBunReleases(root, limit),
    runText(["bun", "--version"], root),
  ]);
  const upgrade = await runJsonLayer<UpgradeReport>(
    ["bun", "run", "scripts/scan.ts", "--json"],
    root
  );
  const discovery = await runJsonLayer<DiscoveryReport>(
    ["bun", "run", "scripts/discover.ts", "--json"],
    root
  );

  const json = Bun.argv.includes("--json");
  if (json) {
    console.log(JSON.stringify({ bunVersion, releases, upgrade, discovery }, null, 2));
    return;
  }

  const discoveryHealth = discovery.ok
    ? JSON.stringify(discovery.data.health)
    : `unavailable (${discovery.error})`;
  const upgradeFindings = upgrade.ok
    ? formatFindings(upgrade.data.findings)
    : [`- Upgrade scan unavailable: ${upgrade.error}`];
  const discoveryGaps = discovery.ok
    ? discovery.data.unifiedGaps.map((gap) => `- [${gap.source}] ${gap.message}`)
    : [`- Discovery unavailable: ${discovery.error}`];

  const lines = [
    `# Bun Enhancement Discovery`,
    ``,
    `Project: ${root}`,
    `Bun: ${bunVersion}`,
    `Discovery health: ${discoveryHealth}`,
    ``,
    `## Last ${releases.length} Bun Releases`,
    ...releases.map(
      (release) =>
        `- ${release.version} (${release.publishedAt.slice(0, 10)}) — ${release.description}\n  Impact: ${releaseImpact(release)}\n  Source: ${release.link}`
    ),
    ``,
    `## Project Upgrade Findings`,
    ...upgradeFindings,
    ``,
    `## Discovery Gaps`,
    ...discoveryGaps,
    ``,
    `## Suggested Follow-up Commands`,
    `- bun run scripts/discover-bun-enhancements.ts`,
    `- bun run scripts/discover-bun-enhancements.ts --json`,
    `- bun run scripts/scan.ts --json`,
    `- bun run discover --json`,
    `- bun run check:fast:changed`,
  ];

  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
