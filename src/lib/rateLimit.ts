import { NextRequest, NextResponse } from 'next/server';

// Simple in-memory rate limiter.
// NOTE: state is per-process. This is correct for the supported single-instance
// (single container) deployment. Running multiple replicas would give each its
// own counters — move this to a shared store (e.g. Redis) before scaling out.
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// Configuration
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 60;  // 60 requests per minute per IP
const CLEANUP_INTERVAL = 5 * 60 * 1000; // Clean up every 5 minutes

// Number of trusted reverse-proxy hops in front of the app (e.g. 1 for a single
// Traefik/nginx). The client IP is read this many positions from the RIGHT of
// X-Forwarded-For — the entries our own proxies append, which a client cannot
// forge. Reading the leftmost value instead would let anyone bypass the limit
// by sending a unique X-Forwarded-For per request.
const TRUSTED_PROXY_HOPS = Math.max(
  1,
  parseInt(process.env.RATE_LIMIT_PROXY_HOPS || '1', 10) || 1
);

// Periodic cleanup of expired entries to prevent memory leaks
let cleanupScheduled = false;
function scheduleCleanup(): void {
  if (cleanupScheduled) return;
  cleanupScheduled = true;

  const timer = setInterval(() => {
    const now = Date.now();
    const entries = Array.from(rateLimitMap.entries());
    for (const [key, entry] of entries) {
      if (entry.resetTime < now) {
        rateLimitMap.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);

  // Housekeeping only — it must not be the reason the process stays alive,
  // otherwise the server ignores SIGTERM and the container takes the full
  // 10s stop timeout to shut down on every deploy.
  if (typeof timer.unref === 'function') timer.unref();
}

// Get client IP from request headers
function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ips = forwardedFor.split(',').map(ip => ip.trim()).filter(Boolean);
    if (ips.length > 0) {
      // Count TRUSTED_PROXY_HOPS in from the right; clamp to the leftmost entry
      // if the chain is shorter than expected.
      const index = Math.max(0, ips.length - TRUSTED_PROXY_HOPS);
      return ips[index];
    }
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  // Fallback - this won't work in production behind a proxy
  // but provides some protection for direct connections
  return 'unknown';
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

// Check and update rate limit for a request
export function checkRateLimit(request: NextRequest): RateLimitResult {
  scheduleCleanup();

  const ip = getClientIp(request);
  const now = Date.now();

  let entry = rateLimitMap.get(ip);

  // If no entry or window expired, create new entry
  if (!entry || entry.resetTime < now) {
    entry = {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW,
    };
    rateLimitMap.set(ip, entry);
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      resetTime: entry.resetTime,
    };
  }

  // Increment count
  entry.count++;

  // Check if over limit
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.resetTime,
    };
  }

  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - entry.count,
    resetTime: entry.resetTime,
  };
}

// Create rate limit response
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);

  return NextResponse.json(
    {
      error: 'Too many requests',
      retryAfter,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(result.resetTime / 1000)),
      },
    }
  );
}

// Helper to add rate limit headers to response
export function addRateLimitHeaders(
  response: NextResponse,
  result: RateLimitResult
): NextResponse {
  response.headers.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX_REQUESTS));
  response.headers.set('X-RateLimit-Remaining', String(result.remaining));
  response.headers.set('X-RateLimit-Reset', String(Math.ceil(result.resetTime / 1000)));
  return response;
}
