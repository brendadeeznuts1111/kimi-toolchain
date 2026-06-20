/**
 * Discover CLI option specs — shared by parser, help, and shell completion.
 */

export type DiscoverShell = "bash" | "zsh";
export type DiscoverCompleteValuesKind = "domain" | "key";

export const DISCOVER_COMPLETION_SHELLS: readonly DiscoverShell[] = ["bash", "zsh"];
export const DISCOVER_COMPLETE_VALUE_KINDS: readonly DiscoverCompleteValuesKind[] = [
  "domain",
  "key",
];

type DiscoverCliValueKey = "root" | "domain" | "key";
type DiscoverCliBooleanKey = "json" | "deep" | "probe" | "noUsages" | "orphansOnly";
type DiscoverCliLayerFlagKey = "constants" | "dx";
export type DiscoverCliSpecKey =
  | DiscoverCliBooleanKey
  | DiscoverCliValueKey
  | DiscoverCliLayerFlagKey;

export type DiscoverCliOptionKind = "boolean" | "value" | "help";

export interface DiscoverCliOptionSpec {
  flags: readonly string[];
  kind: DiscoverCliOptionKind;
  description: string;
  key?: DiscoverCliSpecKey;
  valueLabel?: string;
}

export interface DiscoverCliMetaSpec {
  flags: readonly string[];
  valueLabel: string;
  description: string;
}

/** Single source of truth for discover CLI flags, parsing, and --help text. */
export const DISCOVER_CLI_SPECS: readonly DiscoverCliOptionSpec[] = [
  {
    flags: ["--deep"],
    kind: "boolean",
    key: "deep",
    description: "Detailed output (per-constant or full dx sections)",
  },
  {
    flags: ["--json"],
    kind: "boolean",
    key: "json",
    description: "Emit JSON report (layer-shaped when --constants or --dx)",
  },
  {
    flags: ["--probe"],
    kind: "boolean",
    key: "probe",
    description: "Evaluate live probes and endpoint reachability (dx layer)",
  },
  {
    flags: ["--constants"],
    kind: "boolean",
    key: "constants",
    description: "Constants layer only (bunfig [define] inventory)",
  },
  {
    flags: ["--dx"],
    kind: "boolean",
    key: "dx",
    description: "DX inventory layer only (dx.config.toml endpoints and handoff)",
  },
  {
    flags: ["--domain"],
    kind: "value",
    key: "domain",
    valueLabel: "name",
    description: "Filter constants by define-domain (constants layer)",
  },
  {
    flags: ["--key"],
    kind: "value",
    key: "key",
    valueLabel: "KIMI_*",
    description: "Filter constants by define key (constants layer)",
  },
  {
    flags: ["--orphans"],
    kind: "boolean",
    key: "orphansOnly",
    description: "Show orphan constants only (no src/ usage)",
  },
  {
    flags: ["--no-usages"],
    kind: "boolean",
    key: "noUsages",
    description: "Skip usage scanning (faster constants pass)",
  },
  {
    flags: ["--root"],
    kind: "value",
    key: "root",
    valueLabel: "path",
    description: "Project root (default: repo root)",
  },
  {
    flags: ["-h", "--help"],
    kind: "help",
    description: "Show this help",
  },
] as const;

/** Meta flags used by shell integration (not part of discovery runs). */
export const DISCOVER_CLI_META_SPECS: readonly DiscoverCliMetaSpec[] = [
  {
    flags: ["--completion"],
    valueLabel: "bash|zsh",
    description: "Emit shell completion script to stdout",
  },
  {
    flags: ["--complete-values"],
    valueLabel: "domain|key",
    description: "List completion candidates for shell scripts (domain names or KIMI_* keys)",
  },
];

export const DISCOVER_CLI_FLAG_LOOKUP = new Map<string, DiscoverCliOptionSpec>(
  DISCOVER_CLI_SPECS.flatMap((spec) => spec.flags.map((flag) => [flag, spec] as const))
);

export const DISCOVER_CLI_KNOWN_FLAGS = DISCOVER_CLI_SPECS.flatMap((spec) => spec.flags).filter(
  (flag) => flag.startsWith("--")
);
