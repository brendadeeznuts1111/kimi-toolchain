/**
 * Runtime environment variable typings for kimi-toolchain.
 *
 * Bun exposes env vars via `process.env`, `Bun.env`, and `import.meta.env`, which
 * are aliases. This module augments Bun's `Env` interface so commonly-used
 * variables get autocompletion while keeping them optional (`string | undefined`)
 * to preserve runtime safety.
 *
 * @see https://bun.com/docs/runtime/environment-variables
 * @see .env.example for canonical names and descriptions
 */

declare module "bun" {
  interface Env {
    // -- Core app runtime ---------------------------------------------------
    /** PostgreSQL connection string. */
    DATABASE_URL?: string;
    /** Generic API key placeholder. */
    API_KEY?: string;
    /** Server port (0 = auto). */
    PORT?: string;
    /** Logging level: debug, info, warn, error. */
    LOG_LEVEL?: string;
    /** Node/Bun runtime environment: development, test, production. */
    NODE_ENV?: string;

    // -- Bun runtime and diagnostics ----------------------------------------
    /** Directory for Bun's runtime transpiler cache; "0" or empty disables it. */
    BUN_RUNTIME_TRANSPILER_CACHE_PATH?: string;
    /** Verbose fetch logging: "curl", "1", or unset. */
    BUN_CONFIG_VERBOSE_FETCH?: string;
    /** Maximum concurrent HTTP requests for fetch and bun install (default 256). */
    BUN_CONFIG_MAX_HTTP_REQUESTS?: string;
    /** When true, bun --watch will not clear the console on reload. */
    BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD?: string;
    /** Disable crash-report/telemetry uploads to bun.report when set to "1". */
    DO_NOT_TRACK?: string;
    /** Directory for Bun's intermediate assets (defaults to platform tmpdir). */
    TMPDIR?: string;
    /** Prepended Bun CLI flags, e.g. "--hot". */
    BUN_OPTIONS?: string;

    // -- Terminal output ----------------------------------------------------
    /** Disable ANSI colors when set to "1". */
    NO_COLOR?: string;
    /** Force ANSI colors when set to "1". */
    FORCE_COLOR?: string;

    // -- Test isolation -----------------------------------------------------
    /** Isolated home directory used by test/setup.ts. */
    KIMI_TEST_HOME?: string;
    /** Repo root exported by git hook shell templates to avoid redundant rev-parse. */
    KIMI_REPO_ROOT?: string;
    /** Timezone for deterministic tests (defaults to Etc/UTC). */
    TZ?: string;
    HOME?: string;

    // -- Dashboard server endpoints -----------------------------------------
    HERDR_DASHBOARD_URL?: string;
    HERDR_EXAMPLES_DASHBOARD_URL?: string;

    // -- Cloudflare Access legacy service -----------------------------------
    CLOUDFLARE_ACCOUNT_ID?: string;
    CLOUDFLARE_API_TOKEN?: string;

    // -- Herdr CLI secrets (canonical reverse-domain env fallbacks) ---------
    COM_HERDR_CLI_GITHUB_TOKEN?: string;
    COM_HERDR_CLI_NPM_TOKEN?: string;
    COM_HERDR_CLI_GITHUB_API_DOMAIN?: string;
    COM_HERDR_CLI_R2_ACCESS_KEY_ID?: string;
    COM_HERDR_CLI_R2_SECRET_ACCESS_KEY?: string;
    COM_HERDR_CLI_DISCORD_WEBHOOK_URL?: string;
    COM_HERDR_CLI_TELEGRAM_BOT_TOKEN?: string;
    COM_HERDR_CLI_BUCKEYE_API_KEY?: string;
    COM_HERDR_CLI_BET365_API_KEY?: string;
    COM_HERDR_CLI_STRIPE_SECRET_KEY?: string;
    COM_HERDR_CLI_SHIPPO_API_TOKEN?: string;
    COM_HERDR_CLI_KALSHI_API_KEY?: string;
    COM_HERDR_CLI_MASSEY_API_KEY?: string;

    // -- Dashboard secrets --------------------------------------------------
    COM_HERDR_DASHBOARD_JWT_SECRET?: string;
    COM_HERDR_DASHBOARD_CSRF_SECRET?: string;
    COM_HERDR_DASHBOARD_MASTER_KEY?: string;

    // -- Core / harness / metrics secrets -----------------------------------
    COM_HERDR_CORE_SERVICE_TOKEN?: string;
    COM_HERDR_HARNESS_AGENT_TOKEN?: string;
    COM_HERDR_METRICS_GRAFANA_TOKEN?: string;
    COM_HERDR_METRICS_R2_KPI_BUCKET?: string;

    // -- CI secrets ---------------------------------------------------------
    COM_HERDR_CI_GITHUB_TOKEN?: string;

    // -- Well-known short aliases supported by secrets-env.ts ---------------
    GITHUB_TOKEN?: string;
    GH_TOKEN?: string;
    NPM_TOKEN?: string;
    NPM_CONFIG_TOKEN?: string;
    JWT_SECRET?: string;
    CSRF_SECRET?: string;
  }
}

export {};
