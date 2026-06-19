// ── Kimi Publish ───────────────────────────────────────────────────

export async function apiKimiPublish(): Promise<Response> {
  return jsonResponse({
    pipeline: [
      "1. ensureReadme() — generate README from package.json if missing",
      "2. ensureReadmeField() — add 'readme' field to package.json",
      "3. runPrePublishGates() — kimi-doctor --perf-gates (skip with --no-perf-gates)",
      "4. bun publish — actual publish (with --access, --tag, etc.)",
    ],
    flags: [
      { flag: "--no-perf-gates", description: "Skip performance gates before publish" },
      { flag: "--dry-run", description: "Print what would happen without publishing" },
    ],
    tomlOverridesNote: "bunfig.toml [doctor.thresholds] overrides: probes Bun.TOML.parse, silently skips if unavailable. Human overrides take highest precedence over thresholds.json and defaults.",
    note: "kimi publish ensures every published package has a README, a readme field in package.json, and passes performance gates. Artifact-quality gate before npm registry push.",
  });
}

