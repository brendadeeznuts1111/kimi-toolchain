/**
 * Fixture for property-table unit tests — not imported by production code.
 */

/** @description Demo application settings */
export interface DemoConfig {
  /**
   * @description API base URL
   * @example https://api.example.com
   * @envVar DEMO_API_URL
   */
  apiUrl: string;

  /**
   * @description Request timeout in milliseconds
   * @min 1000
   * @max 60000
   * @default 30000
   */
  timeout?: number;

  /**
   * @required
   * @description API secret (required even when optional in TS)
   */
  apiKey?: string;

  /** @deprecatedIn 2.0.0 */
  legacyMode: boolean;
}
