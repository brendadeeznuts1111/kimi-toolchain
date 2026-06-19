// ── Threshold Overrides ────────────────────────────────────────────

export async function apiThresholdOverrides(): Promise<Response> {
  // Read bunfig.toml [doctor.thresholds] if present
  let bunfigOverrides: Record<string, number> = {};
  let bunfigPath = "";
  try {
    const path = `${import.meta.dir}/../bunfig.toml`;
    const file = Bun.file(path);
    if (await file.exists()) {
      bunfigPath = "./bunfig.toml";
      const parsed = Bun.TOML.parse(await file.text());
      const doctor = (parsed as any).doctor;
      if (doctor?.thresholds && typeof doctor.thresholds === "object") {
        bunfigOverrides = doctor.thresholds as Record<string, number>;
      }
    }
  } catch {
    /* no file */
  }

  // Default thresholds (what perf-monitor uses as fallback)
  const defaults: Record<string, number> = {
    "kimi.effect.image.metadata": 5,
    "kimi.effect.image.placeholder": 50,
    "kimi.effect.image.thumbnail": 200,
    "kimi.effect.db.query": 10,
    "kimi.effect.uuid": 0.1,
    "kimi.effect.clock": 0.01,
  };

  // Merged: trained > bunfig > defaults
  const merged = { ...defaults, ...bunfigOverrides };

  return jsonResponse({
    sources: { bunfig: bunfigPath || "(none)", defaults: Object.keys(defaults).length },
    bunfigOverrides,
    merged,
    precedence: [
      { layer: 1, source: "overrideThresholds() API", method: "Programmatic" },
      {
        layer: 2,
        source: "bunfig.toml",
        method: "Human config ([doctor.thresholds] or [test.kimi-doctor.thresholds])",
      },
      { layer: 3, source: "thresholds.json", method: "Machine-trained (kimi-doctor --train)" },
      { layer: 4, source: "DEFAULT_THRESHOLDS", method: "Built-in fallback" },
    ],
    tomlFormats: [
      "[doctor.thresholds]",
      "[test.kimi-doctor.thresholds]",
      "[kimi-doctor.thresholds]",
    ],
    fallback:
      "Manual regex parser for older Bun versions without Bun.TOML.parse(). Gracefully degrades.",
    exampleConfig: `# bunfig.toml
[doctor.thresholds]
"kimi.effect.image.metadata" = 3.5
"kimi.effect.image.thumbnail" = 150`,
    note: "Dual TOML format + regex fallback. 4-layer precedence: overrideThresholds() > bunfig.toml > thresholds.json > DEFAULT_THRESHOLDS. kimi-publish wraps bun publish with README check + perf gates.",
  });
}
