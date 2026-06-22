import type { SupabaseClient } from "npm:@supabase/supabase-js@2.108.2";
import { HttpError } from "./http.ts";

function cleanHeaderValue(value: string | null): string | null {
  const cleaned = value?.trim().slice(0, 96);
  return cleaned || null;
}

function cleanLongHeaderValue(value: string | null): string | null {
  const cleaned = value?.trim().slice(0, 768);
  return cleaned || null;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function shouldTrustEdgeIpHeaders(explicit: boolean | undefined): boolean {
  if (typeof explicit === "boolean") return explicit;
  try {
    return Deno.env.get("APP_TRUST_EDGE_IP_HEADERS") === "true";
  } catch {
    return false;
  }
}

function platformClientIp(
  req: Request,
  trustProxyHeaders: boolean,
): string | null {
  if (!trustProxyHeaders) return null;
  return (
    cleanHeaderValue(req.headers.get("cf-connecting-ip")) ??
      cleanHeaderValue(req.headers.get("fly-client-ip")) ??
      cleanHeaderValue(req.headers.get("x-real-ip"))
  );
}

function credentialBucket(req: Request): string | null {
  const authorization = cleanLongHeaderValue(req.headers.get("authorization"));
  if (!authorization) return null;
  return `auth:${stableHash(authorization)}`;
}

function mapRateLimitError(message: string): never {
  if (message.includes("rate_limited")) {
    throw new HttpError(
      429,
      "Too many requests. Try again shortly.",
      "rate_limited",
    );
  }
  throw new HttpError(500, "Rate limit check failed.", "rate_limit_failed");
}

type PreAuthBucket = {
  count: number;
  resetAt: number;
};

type PreAuthRateLimitOptions = {
  fallbackLimit?: number;
  limit?: number;
  now?: number;
  trustProxyHeaders?: boolean;
  windowSeconds?: number;
};

type AuthRateLimitOptions = {
  trustProxyHeaders?: boolean;
};

const preAuthBuckets = new Map<string, PreAuthBucket>();
let preAuthChecks = 0;

export function clearPreAuthRateLimitForTest(): void {
  preAuthBuckets.clear();
  preAuthChecks = 0;
}

function prunePreAuthBuckets(now: number): void {
  preAuthChecks += 1;
  if (preAuthChecks % 256 !== 0) return;
  for (const [key, bucket] of preAuthBuckets) {
    if (bucket.resetAt <= now) preAuthBuckets.delete(key);
  }
}

export function checkPreAuthRateLimit(
  req: Request,
  endpoint: string,
  options: PreAuthRateLimitOptions = {},
): void {
  const limit = options.limit ?? 120;
  const fallbackLimit = options.fallbackLimit ?? limit * 5;
  const windowMs = (options.windowSeconds ?? 60) * 1000;
  const now = options.now ?? Date.now();
  const trustedIp = platformClientIp(
    req,
    shouldTrustEdgeIpHeaders(options.trustProxyHeaders),
  );
  const sourceBucket = trustedIp ? `ip:${trustedIp}` : "unknown-source";
  const bucketKeys = [
    {
      key: `${endpoint}:preauth:${sourceBucket}`,
      limit: trustedIp ? limit : fallbackLimit,
    },
  ];
  const credential = credentialBucket(req);
  if (credential) {
    bucketKeys.push({ key: `${endpoint}:preauth:${credential}`, limit });
  }

  prunePreAuthBuckets(now);

  for (const bucket of bucketKeys) {
    const existing = preAuthBuckets.get(bucket.key);
    if (!existing || existing.resetAt <= now) {
      preAuthBuckets.set(bucket.key, { count: 1, resetAt: now + windowMs });
      continue;
    }

    existing.count += 1;
    if (existing.count > bucket.limit) {
      throw new HttpError(
        429,
        "Too many requests. Try again shortly.",
        "rate_limited",
      );
    }
  }
}

export async function checkRateLimit(
  admin: SupabaseClient,
  req: Request,
  endpoint: string,
  playerId: string,
  limit: number,
  windowSeconds = 60,
  options: AuthRateLimitOptions = {},
): Promise<void> {
  const trustedIp = platformClientIp(
    req,
    shouldTrustEdgeIpHeaders(options.trustProxyHeaders),
  );
  const buckets = [
    `${endpoint}:user:${playerId}`,
  ];
  if (trustedIp) buckets.push(`${endpoint}:ip:${trustedIp}`);

  for (const bucket of buckets) {
    const { error } = await admin.rpc("check_rate_limit", {
      p_scope: endpoint,
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) mapRateLimitError(error.message);
  }
}
