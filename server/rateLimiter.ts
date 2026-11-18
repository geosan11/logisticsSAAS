export interface RateLimiterOptions {
  name: string;
  maxReqs: number;
  windowMs: number;
  perUser?: boolean;
}

interface MemoryRateLimitEntry {
  count: number;
  resetAt: number;
}

const memoryRateLimits = new Map<string, MemoryRateLimitEntry>();

/**
 * In-memory rate limiting check.
 * Used when Supabase service credentials are not configured (e.g. tests, offline dev)
 * or as a resilient fallback if the Supabase RPC call fails.
 */
export function checkMemoryRateLimit(
  key: string,
  maxReqs: number,
  windowMs: number
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = memoryRateLimits.get(key);
  if (!entry || entry.resetAt <= now) {
    memoryRateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  entry.count++;
  if (entry.count > maxReqs) {
    const remainingMs = entry.resetAt - now;
    const retryAfter = Math.max(1, Math.ceil(remainingMs / 1000));
    return { allowed: false, retryAfter };
  }
  return { allowed: true, retryAfter: 0 };
}

/**
 * Resets the in-memory rate limiter store (useful in test teardown).
 */
export function resetMemoryRateLimits(): void {
  memoryRateLimits.clear();
}

/**
 * Checks rate limit against Supabase distributed RPC if configured,
 * otherwise falls back to memory store.
 */
export async function checkDistributedRateLimit(
  key: string,
  maxReqs: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfter: number }> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceKey) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: allowed, error } = await admin.rpc('check_rate_limit', {
        p_key: key,
        p_max: maxReqs,
        p_window_ms: windowMs,
      });

      if (error) {
        console.error('Distributed rate limiter check failed (falling back to memory):', error);
        return checkMemoryRateLimit(key, maxReqs, windowMs);
      }

      const retryAfter = Math.ceil(windowMs / 1000);
      return { allowed: allowed !== false, retryAfter };
    } catch (err) {
      console.error('Distributed rate limiter error (falling back to memory):', err);
      return checkMemoryRateLimit(key, maxReqs, windowMs);
    }
  }

  // When Supabase is not configured (e.g. tests, offline dev environment), use memory rate limiter
  return checkMemoryRateLimit(key, maxReqs, windowMs);
}

/**
 * Creates Express rate limiter middleware.
 * Supports per-IP limiting as well as optional per-User limiting.
 * Returns HTTP 429 with Retry-After header when limit is exceeded.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const { name, maxReqs, windowMs, perUser = false } = options;
  const defaultRetryAfter = Math.ceil(windowMs / 1000);

  return async (req: any, res: any, next: any) => {
    try {
      const ip =
        req.ip ||
        (req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : null) ||
        req.socket?.remoteAddress ||
        'unknown';

      // 1. Check IP rate limit
      const ipKey = `${name}:ip:${ip}`;
      const ipResult = await checkDistributedRateLimit(ipKey, maxReqs, windowMs);
      if (!ipResult.allowed) {
        const retryAfter = ipResult.retryAfter || defaultRetryAfter;
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({
          error: 'Too many requests from this IP. Please slow down.',
          retryAfter,
        });
      }

      // 2. Check User rate limit if enabled and user identifier is present
      if (perUser) {
        const userId =
          req.user?.id ||
          req.userId ||
          (req.headers['x-user-id'] ? String(req.headers['x-user-id']).trim() : null);

        if (userId) {
          const userKey = `${name}:user:${userId}`;
          const userResult = await checkDistributedRateLimit(userKey, maxReqs, windowMs);
          if (!userResult.allowed) {
            const retryAfter = userResult.retryAfter || defaultRetryAfter;
            res.setHeader('Retry-After', String(retryAfter));
            return res.status(429).json({
              error: 'Too many requests for this user account. Please slow down.',
              retryAfter,
            });
          }
        }
      }

      next();
    } catch (err) {
      // Fail open on unexpected middleware errors
      console.error(`Rate limiter error for ${name} (failing open):`, err);
      next();
    }
  };
}

/**
 * Backwards compatible helper matching server/app.ts's original signature.
 */
export const rateLimiter = (name: string, maxReqs: number, windowMs: number) => {
  return createRateLimiter({ name, maxReqs, windowMs, perUser: false });
};
