/**
 * Alert dedupe for Herdr failure correlation — (taxonomyId, pid, hour) buckets.
 */

export const ALERT_DEDUPE_BUCKET_MS = 60 * 60 * 1000;

export type AlertDedupeHit = {
  taxonomyId: string;
  pid: number | null;
};

export function alertHourBucket(nowMs: number, bucketMs = ALERT_DEDUPE_BUCKET_MS): number {
  return Math.floor(nowMs / bucketMs);
}

export function alertBucketKey(taxonomyId: string, pid: number | null, hour: number): string {
  return `${taxonomyId}:${pid ?? "none"}:${hour}`;
}

/** True when this hit should be suppressed (already emitted in the current bucket window). */
export function shouldSuppressAlert(
  hit: AlertDedupeHit,
  lastEmitByBucket: ReadonlyMap<string, number>,
  nowMs = Date.now(),
  bucketMs = ALERT_DEDUPE_BUCKET_MS
): boolean {
  const hour = alertHourBucket(nowMs, bucketMs);
  const key = alertBucketKey(hit.taxonomyId, hit.pid, hour);
  const last = lastEmitByBucket.get(key);
  if (last == null) return false;
  return nowMs - last < bucketMs;
}

export function markAlertEmitted(
  hit: AlertDedupeHit,
  lastEmitByBucket: Map<string, number>,
  nowMs = Date.now(),
  bucketMs = ALERT_DEDUPE_BUCKET_MS
): string {
  const hour = alertHourBucket(nowMs, bucketMs);
  const key = alertBucketKey(hit.taxonomyId, hit.pid, hour);
  lastEmitByBucket.set(key, nowMs);
  return key;
}
