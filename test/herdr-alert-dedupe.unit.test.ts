import { describe, expect, test } from "bun:test";
import {
  ALERT_DEDUPE_BUCKET_MS,
  alertBucketKey,
  alertHourBucket,
  markAlertEmitted,
  shouldSuppressAlert,
} from "../src/lib/herdr-alert-dedupe.ts";

describe("herdr-alert-dedupe", () => {
  test("alertBucketKey scopes taxonomy, pid, and hour", () => {
    expect(alertBucketKey("herdr_socket_saturation", 42, 100)).toBe(
      "herdr_socket_saturation:42:100"
    );
    expect(alertBucketKey("herdr_socket_saturation", null, 100)).toBe(
      "herdr_socket_saturation:none:100"
    );
  });

  test("shouldSuppressAlert blocks repeat within bucket window", () => {
    const map = new Map<string, number>();
    const t0 = 5_000_000;
    const hit = { taxonomyId: "herdr_socket_saturation", pid: 42 };

    expect(shouldSuppressAlert(hit, map, t0)).toBe(false);
    markAlertEmitted(hit, map, t0);

    expect(shouldSuppressAlert(hit, map, t0 + 1_000)).toBe(true);
    expect(shouldSuppressAlert(hit, map, t0 + ALERT_DEDUPE_BUCKET_MS)).toBe(false);
  });

  test("alertHourBucket uses epoch hour slots", () => {
    expect(alertHourBucket(0)).toBe(0);
    expect(alertHourBucket(ALERT_DEDUPE_BUCKET_MS)).toBe(1);
  });
});
