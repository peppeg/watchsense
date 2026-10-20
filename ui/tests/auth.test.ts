import { describe, expect, it } from 'vitest'
import { isApiPath, normalizePath } from '../server/utils/request-path'
import {
  LoginRateLimiter, authDecision, configuredToken, internalAuthHeaders, isLoopbackHost,
  isValidBearer, isValidSession, requiresAuth, safeEqual, sessionValue,
} from '../server/utils/auth'

const TOKEN = 'test-token-0123456789'

describe('normalizePath', () => {
  it('normalizes case, double slashes, encoded chars, trailing slash and query', () => {
    expect(normalizePath('/API/Stats')).toBe('/api/stats')
    expect(normalizePath('//api//stats')).toBe('/api/stats')
    expect(normalizePath('/api/stats/')).toBe('/api/stats')
    expect(normalizePath('/api/%73tats')).toBe('/api/stats')
    expect(normalizePath('/api/%2573tats')).toBe('/api/stats')
    expect(normalizePath('/api/stats?x=1')).toBe('/api/stats')
    expect(normalizePath('/api\\stats')).toBe('/api/stats')
    expect(normalizePath('/')).toBe('/')
    expect(normalizePath('/api/%E0%A4%A')).toBe('/api/%e0%a4%a') // malformed: kept as is
  })

  it('does not resolve dot segments (no escape from a protected prefix)', () => {
    expect(normalizePath('/api/shows/..%2Fhealth')).toBe('/api/shows/../health')
  })

  it('detects API paths anywhere in the path', () => {
    expect(isApiPath('/api/stats')).toBe(true)
    expect(isApiPath('/api')).toBe(true)
    expect(isApiPath('/./api/stats')).toBe(true)
    expect(isApiPath('/')).toBe(false)
    expect(isApiPath('/_nuxt/app.js')).toBe(false)
    expect(isApiPath('/apis')).toBe(false)
  })
})

describe('requiresAuth', () => {
  it('exempts only the public endpoints', () => {
    for (const p of ['/api/health', '/api/locale', '/api/auth/login', '/api/auth/logout', '/api/auth/status', '/api/sync/ingest', '/API/Health/', '/api/_nuxt_icon/lucide.json']) {
      expect(requiresAuth(p), p).toBe(false)
    }
  })

  it('protects every other API path, including path tricks', () => {
    for (const p of ['/api/stats', '/API/stats', '//api/stats', '/api/stats/', '/api/%73tats', '/api', '/api/config',
      '/api/sync/ingest-token/regenerate', '/api/sync/ingest/x', '/api/shows/..%2Fhealth', '/./api/stats',
      '/api/_nuxt_icon/../stats', '/api/health/x', '/api/healthz', '/api/does-not-exist']) {
      expect(requiresAuth(p), p).toBe(true)
    }
  })

  it('leaves non-API paths (SPA, assets) alone', () => {
    expect(requiresAuth('/')).toBe(false)
    expect(requiresAuth('/_nuxt/entry.js')).toBe(false)
  })
})

describe('token comparison', () => {
  it('compares in constant time on hashed values', () => {
    expect(safeEqual(TOKEN, TOKEN)).toBe(true)
    expect(safeEqual(TOKEN + 'x', TOKEN)).toBe(false)
    expect(safeEqual('short', TOKEN)).toBe(false)
    expect(safeEqual('', TOKEN)).toBe(false)
    expect(safeEqual(undefined, TOKEN)).toBe(false)
    expect(safeEqual(123, TOKEN)).toBe(false)
  })

  it('accepts only a valid Bearer header', () => {
    expect(isValidBearer(`Bearer ${TOKEN}`, TOKEN)).toBe(true)
    expect(isValidBearer(`bearer  ${TOKEN}`, TOKEN)).toBe(true)
    expect(isValidBearer(`Bearer wrong`, TOKEN)).toBe(false)
    expect(isValidBearer(TOKEN, TOKEN)).toBe(false)
    expect(isValidBearer(`Basic ${TOKEN}`, TOKEN)).toBe(false)
    expect(isValidBearer(undefined, TOKEN)).toBe(false)
  })
})

describe('session cookie', () => {
  it('is derived from the token, never the token itself', () => {
    const value = sessionValue(TOKEN)
    expect(value).toMatch(/^[0-9a-f]{64}$/)
    expect(value).not.toContain(TOKEN)
    expect(sessionValue(TOKEN)).toBe(value)
    expect(sessionValue(TOKEN + 'x')).not.toBe(value)
  })

  it('validates the derived value and rejects the raw token', () => {
    expect(isValidSession(sessionValue(TOKEN), TOKEN)).toBe(true)
    expect(isValidSession(TOKEN, TOKEN)).toBe(false)
    expect(isValidSession(sessionValue('other'), TOKEN)).toBe(false)
    expect(isValidSession(undefined, TOKEN)).toBe(false)
  })
})

describe('authDecision (middleware)', () => {
  it('allows everything when no token is configured', () => {
    expect(configuredToken({})).toBeNull()
    expect(configuredToken({ WATCHSENSE_TOKEN: '   ' })).toBeNull()
    expect(authDecision({ path: '/api/stats' }, null)).toBe('allow')
    expect(authDecision({ path: '/api/config' }, configuredToken({ WATCHSENSE_TOKEN: '' }))).toBe('allow')
  })

  it('requires a session or Bearer when a token is configured', () => {
    const token = configuredToken({ WATCHSENSE_TOKEN: ` ${TOKEN} ` })!
    expect(token).toBe(TOKEN)
    expect(authDecision({ path: '/api/stats' }, token)).toBe('deny')
    expect(authDecision({ path: '//API/stats/' }, token)).toBe('deny')
    expect(authDecision({ path: '/api/stats', cookie: 'nope' }, token)).toBe('deny')
    expect(authDecision({ path: '/api/stats', cookie: sessionValue(TOKEN) }, token)).toBe('allow')
    expect(authDecision({ path: '/api/stats', authorization: `Bearer ${TOKEN}` }, token)).toBe('allow')
    expect(authDecision({ path: '/api/health' }, token)).toBe('allow')
    expect(authDecision({ path: '/api/sync/ingest' }, token)).toBe('allow')
    expect(authDecision({ path: '/' }, token)).toBe('allow')
  })

  it('gives internal callers a Bearer header only when enabled', () => {
    expect(internalAuthHeaders({})).toEqual({})
    expect(internalAuthHeaders({ WATCHSENSE_TOKEN: TOKEN })).toEqual({ authorization: `Bearer ${TOKEN}` })
  })
})

describe('isLoopbackHost', () => {
  it('recognizes loopback bind addresses', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]']) expect(isLoopbackHost(h), h).toBe(true)
    for (const h of [undefined, '', '0.0.0.0', '::', '100.64.1.2', '192.168.1.10']) expect(isLoopbackHost(h), String(h)).toBe(false)
  })
})

describe('LoginRateLimiter', () => {
  it('blocks an IP after too many failures within the window', () => {
    const limiter = new LoginRateLimiter(3, 60_000)
    const t0 = 1_000_000
    for (let i = 0; i < 3; i++) {
      expect(limiter.retryAfter('1.2.3.4', t0)).toBe(0)
      limiter.recordFailure('1.2.3.4', t0)
    }
    expect(limiter.retryAfter('1.2.3.4', t0 + 1000)).toBe(59)
    expect(limiter.retryAfter('5.6.7.8', t0 + 1000)).toBe(0)
    expect(limiter.retryAfter('1.2.3.4', t0 + 60_000)).toBe(0)
  })

  it('resets after a successful login', () => {
    const limiter = new LoginRateLimiter(2, 60_000)
    limiter.recordFailure('ip', 0)
    limiter.recordFailure('ip', 0)
    expect(limiter.retryAfter('ip', 10)).toBeGreaterThan(0)
    limiter.reset('ip')
    expect(limiter.retryAfter('ip', 10)).toBe(0)
  })
})

describe('bookmarklet with auth enabled (T08)', () => {
  it('keeps the ingest endpoint (and its CORS preflight) outside the session check', () => {
    // The ingest endpoint is authorized by its own per-instance ingest token, never by WATCHSENSE_TOKEN
    expect(authDecision({ path: '/api/sync/ingest' }, TOKEN)).toBe('allow')
    expect(authDecision({ path: '/api/sync/ingest?x=1' }, TOKEN)).toBe('allow')
  })

  it('protects the endpoints that reveal or regenerate the ingest token', () => {
    expect(authDecision({ path: '/api/config' }, TOKEN)).toBe('deny')
    expect(authDecision({ path: '/api/sync/ingest-token/regenerate' }, TOKEN)).toBe('deny')
    expect(authDecision({ path: '/api/sync/ingest-token/regenerate', cookie: sessionValue(TOKEN) }, TOKEN)).toBe('allow')
  })
})
