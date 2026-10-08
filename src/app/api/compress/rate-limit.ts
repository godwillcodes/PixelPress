/**
 * A small per-instance rate limit.
 *
 * This is honest about what it is: counters in the memory of one serverless
 * instance. Several instances mean several buckets, and a restart forgets
 * everything, so it is a courtesy limit that keeps one script from monopolising
 * an instance — not a security control. Anything that needs real quotas needs
 * shared storage, and anyone who needs real throughput should run the CLI.
 */

import type { NextRequest } from 'next/server';

const PER_MINUTE = 12;
const WINDOW_MS = 60_000;
/** Enough for a burst of callers without letting the map grow unbounded. */
const MAX_TRACKED = 5_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

/** Drop expired buckets, and the oldest ones if the map is still too big. */
function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }

  if (buckets.size <= MAX_TRACKED) return;

  const oldestFirst = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (const [key] of oldestFirst.slice(0, buckets.size - MAX_TRACKED)) buckets.delete(key);
}

export function rateLimit(request: NextRequest): {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  prune(now);

  const key = clientKey(request);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: PER_MINUTE - 1, retryAfterSeconds: 0 };
  }

  bucket.count++;

  return {
    allowed: bucket.count <= PER_MINUTE,
    remaining: Math.max(0, PER_MINUTE - bucket.count),
    retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
  };
}

rateLimit.perMinute = PER_MINUTE;

/** Used by the tests to start from a known state. */
export function resetRateLimit(): void {
  buckets.clear();
}
