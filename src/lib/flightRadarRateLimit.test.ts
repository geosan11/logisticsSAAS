import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  createRateLimiter,
  checkMemoryRateLimit,
  resetMemoryRateLimits,
} from '../../server/rateLimiter';
import {
  getUpstreamCache,
  setUpstreamCache,
  clearUpstreamCache,
  UPSTREAM_CACHE_TTL_MS,
} from '../../server/flightRadar';

// Helper to simulate mock Express req/res/next
function createMockHttp(options: {
  ip?: string;
  userId?: string;
  headers?: Record<string, string>;
}) {
  const req: any = {
    ip: options.ip || '127.0.0.1',
    headers: options.headers || {},
    user: options.userId ? { id: options.userId } : undefined,
    userId: options.userId,
    socket: { remoteAddress: options.ip || '127.0.0.1' },
  };

  const resHeaders: Record<string, string> = {};
  let resStatus = 200;
  let resBody: any = null;

  const res: any = {
    setHeader(name: string, value: string) {
      resHeaders[name.toLowerCase()] = value;
      return res;
    },
    getHeader(name: string) {
      return resHeaders[name.toLowerCase()];
    },
    status(code: number) {
      resStatus = code;
      return res;
    },
    json(body: any) {
      resBody = body;
      return res;
    },
  };

  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };

  return {
    req,
    res,
    next,
    get status() {
      return resStatus;
    },
    get body() {
      return resBody;
    },
    get headers() {
      return resHeaders;
    },
    get nextCalled() {
      return nextCalled;
    },
  };
}

describe('Server Rate Limiter Middleware (/api/flight-radar)', () => {
  beforeEach(() => {
    resetMemoryRateLimits();
  });

  test('checkMemoryRateLimit permits requests up to maxReqs and rejects excess', () => {
    const key = 'test:key:1';
    for (let i = 1; i <= 30; i++) {
      const res = checkMemoryRateLimit(key, 30, 60_000);
      assert.strictEqual(res.allowed, true, `Request ${i} should be allowed`);
    }

    // 31st request is blocked with retry-after
    const blocked = checkMemoryRateLimit(key, 30, 60_000);
    assert.strictEqual(blocked.allowed, false);
    assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= 60);
  });

  test('rate limiter middleware permits requests up to 30 requests/minute', async () => {
    const limiter = createRateLimiter({
      name: 'flight-radar-test',
      maxReqs: 30,
      windowMs: 60_000,
      perUser: true,
    });

    for (let i = 1; i <= 30; i++) {
      const http = createMockHttp({ ip: '192.168.1.10', userId: 'user-abc' });
      await limiter(http.req, http.res, http.next);
      assert.strictEqual(http.nextCalled, true, `Request ${i} should call next()`);
      assert.strictEqual(http.status, 200);
    }
  });

  test('rate limiter returns 429 with Retry-After header and error json on 31st request', async () => {
    const limiter = createRateLimiter({
      name: 'flight-radar-test-429',
      maxReqs: 30,
      windowMs: 60_000,
      perUser: true,
    });

    // Send 30 requests
    for (let i = 1; i <= 30; i++) {
      const http = createMockHttp({ ip: '10.0.0.5', userId: 'user-test-1' });
      await limiter(http.req, http.res, http.next);
    }

    // 31st request should be rejected
    const blockedHttp = createMockHttp({ ip: '10.0.0.5', userId: 'user-test-1' });
    await limiter(blockedHttp.req, blockedHttp.res, blockedHttp.next);

    assert.strictEqual(blockedHttp.nextCalled, false, 'next() must NOT be called on 429');
    assert.strictEqual(blockedHttp.status, 429, 'Status must be 429');
    assert.strictEqual(blockedHttp.headers['retry-after'], '60', 'Retry-After header must be set');
    assert.ok(blockedHttp.body?.error, 'Body should contain error message');
    assert.strictEqual(blockedHttp.body?.retryAfter, 60, 'Body should contain retryAfter seconds');
  });

  test('per-IP rate limiting: different IPs have independent request quotas', async () => {
    const limiter = createRateLimiter({
      name: 'flight-radar-ip-test',
      maxReqs: 5,
      windowMs: 60_000,
      perUser: false,
    });

    // Exhaust quota for IP 1.2.3.4
    for (let i = 1; i <= 5; i++) {
      const http = createMockHttp({ ip: '1.2.3.4' });
      await limiter(http.req, http.res, http.next);
      assert.strictEqual(http.nextCalled, true);
    }

    // IP 1.2.3.4 request 6 is rate limited
    const ip1Blocked = createMockHttp({ ip: '1.2.3.4' });
    await limiter(ip1Blocked.req, ip1Blocked.res, ip1Blocked.next);
    assert.strictEqual(ip1Blocked.status, 429);
    assert.strictEqual(ip1Blocked.headers['retry-after'], '60');

    // Different IP 5.6.7.8 is NOT blocked
    const ip2Allowed = createMockHttp({ ip: '5.6.7.8' });
    await limiter(ip2Allowed.req, ip2Allowed.res, ip2Allowed.next);
    assert.strictEqual(ip2Allowed.nextCalled, true);
    assert.strictEqual(ip2Allowed.status, 200);
  });

  test('per-User rate limiting: user cannot bypass limit by rotating IPs', async () => {
    const limiter = createRateLimiter({
      name: 'flight-radar-user-test',
      maxReqs: 5,
      windowMs: 60_000,
      perUser: true,
    });

    // User user-456 sends 5 requests, each from a different IP
    for (let i = 1; i <= 5; i++) {
      const http = createMockHttp({ ip: `10.0.0.${i}`, userId: 'user-456' });
      await limiter(http.req, http.res, http.next);
      assert.strictEqual(http.nextCalled, true);
    }

    // 6th request from another brand-new IP by the same user is rejected by per-user limit
    const blockedHttp = createMockHttp({ ip: '10.0.0.99', userId: 'user-456' });
    await limiter(blockedHttp.req, blockedHttp.res, blockedHttp.next);

    assert.strictEqual(blockedHttp.nextCalled, false);
    assert.strictEqual(blockedHttp.status, 429);
    assert.strictEqual(blockedHttp.headers['retry-after'], '60');
    assert.ok(blockedHttp.body?.error.includes('user account') || blockedHttp.body?.error.includes('user'));

    // Another user (user-789) is not affected
    const otherUser = createMockHttp({ ip: '10.0.0.99', userId: 'user-789' });
    await limiter(otherUser.req, otherUser.res, otherUser.next);
    assert.strictEqual(otherUser.nextCalled, true);
    assert.strictEqual(otherUser.status, 200);
  });
});

describe('Upstream Flight Radar Caching (server/flightRadar.ts)', () => {
  beforeEach(() => {
    clearUpstreamCache();
  });

  test('UPSTREAM_CACHE_TTL_MS is configured between 15s and 30s', () => {
    assert.ok(
      UPSTREAM_CACHE_TTL_MS >= 15_000 && UPSTREAM_CACHE_TTL_MS <= 30_000,
      `Expected TTL between 15000 and 30000 ms, got ${UPSTREAM_CACHE_TTL_MS}`
    );
  });

  test('setUpstreamCache and getUpstreamCache store and retrieve flight responses', () => {
    const key = 'flight:W3100:2026-11-18';
    const mockPayload = { flightNumber: 'W3100', status: 'landed' };

    assert.strictEqual(getUpstreamCache(key), undefined);

    setUpstreamCache(key, mockPayload);
    const retrieved = getUpstreamCache(key);

    assert.deepStrictEqual(retrieved, mockPayload);
  });

  test('getUpstreamCache returns undefined after cache entry expires', async () => {
    const key = 'flight:P47120:2026-11-18';
    const mockPayload = { flightNumber: 'P47120', status: 'departed' };

    // Set with short TTL
    setUpstreamCache(key, mockPayload, 50); // 50ms TTL

    assert.deepStrictEqual(getUpstreamCache(key), mockPayload);

    // Wait 60ms
    await new Promise(r => setTimeout(r, 60));

    // Entry should now be expired and return undefined
    assert.strictEqual(getUpstreamCache(key), undefined);
  });

  test('clearUpstreamCache removes all cached items', () => {
    setUpstreamCache('key1', { a: 1 });
    setUpstreamCache('key2', { b: 2 });

    assert.ok(getUpstreamCache('key1'));
    assert.ok(getUpstreamCache('key2'));

    clearUpstreamCache();

    assert.strictEqual(getUpstreamCache('key1'), undefined);
    assert.strictEqual(getUpstreamCache('key2'), undefined);
  });
});
