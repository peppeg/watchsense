import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { isApiPath, normalizePath } from './request-path'

// Autenticazione opzionale: attiva solo se WATCHSENSE_TOKEN è impostato (non vuoto).
// Senza token l'app si comporta come prima (nessun login, nessun controllo).
// Funzioni pure (niente h3) per poterle testare senza Nuxt: il middleware è solo un adattatore.

export const SESSION_COOKIE = 'ws_session'
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30 // 30 giorni

// Il valore del cookie è un HMAC del token: un cookie trapelato non rivela il token
// (che resta valido anche come Bearer). Cambiando il token tutte le sessioni decadono.
const SESSION_CONTEXT = 'watchsense:session:v1'

// Percorsi /api pubblici anche con auth attiva (confronto esatto sul percorso normalizzato):
// - health: healthcheck Docker/monitoraggio, non legge dati;
// - auth/*: login, logout e stato servono prima di autenticarsi;
// - sync/ingest: bookmarklet cross-origin, autorizzato dal suo token per-istanza (ingest_token),
//   che si legge solo dalle Impostazioni, a loro volta protette;
// - locale: lingua dell'app e lingua/regione TMDB, servono già alla schermata di login.
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/locale',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/status',
  '/api/sync/ingest',
])
// Icone servite da @nuxt/icon (dati pubblici di Iconify), usate anche dalla schermata di login
const PUBLIC_RE = /^\/api\/_nuxt_icon\/[a-z0-9-]+\.json$/

/** Token configurato (spazi esterni ignorati); null se l'auth è disattivata. */
export function configuredToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = (env.WATCHSENSE_TOKEN || '').trim()
  return token || null
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/** Confronto a tempo costante: entrambi i lati passano da SHA-256 (buffer di pari lunghezza). */
export function safeEqual(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || !given) return false
  return timingSafeEqual(sha256(given), sha256(expected))
}

/** Valore del cookie di sessione derivato dal token (HMAC-SHA256, hex). */
export function sessionValue(token: string): string {
  return createHmac('sha256', token).update(SESSION_CONTEXT).digest('hex')
}

/** Header Authorization 'Bearer <token>' valido. */
export function isValidBearer(header: unknown, token: string): boolean {
  if (typeof header !== 'string') return false
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return !!match && safeEqual(match[1]!.trim(), token)
}

/** Cookie ws_session valido. */
export function isValidSession(cookie: unknown, token: string): boolean {
  return safeEqual(cookie, sessionValue(token))
}

/** Richiesta autenticata (cookie di sessione o Bearer). */
export function isAuthenticated(req: { cookie?: string | null, authorization?: string | null }, token: string): boolean {
  return isValidSession(req.cookie, token) || isValidBearer(req.authorization, token)
}

/** Vero se il percorso richiede l'autenticazione (quando è attiva): tutto /api tranne i pubblici. */
export function requiresAuth(path: string): boolean {
  const normalized = normalizePath(path)
  if (!isApiPath(normalized)) return false
  return !PUBLIC_PATHS.has(normalized) && !PUBLIC_RE.test(normalized)
}

export type AuthDecision = 'allow' | 'deny'

/** Decisione del middleware: senza token configurato tutto passa. */
export function authDecision(req: { path: string, cookie?: string | null, authorization?: string | null }, token: string | null): AuthDecision {
  if (!token || !requiresAuth(req.path)) return 'allow'
  return isAuthenticated(req, token) ? 'allow' : 'deny'
}

/** Header per le chiamate interne del server ($fetch dello scheduler) quando l'auth è attiva. */
export function internalAuthHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const token = configuredToken(env)
  return token ? { authorization: `Bearer ${token}` } : {}
}

/** Indirizzo di ascolto di loopback ('localhost', 127.x, ::1). Vuoto = tutte le interfacce. */
export function isLoopbackHost(host: string | undefined): boolean {
  const h = (host || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h)
}

// ── Limite tentativi di login (in memoria, per IP) ──

export const LOGIN_MAX_FAILURES = 10
export const LOGIN_WINDOW_MS = 60 * 1000

export class LoginRateLimiter {
  private failures = new Map<string, { count: number, resetAt: number }>()

  constructor(private max = LOGIN_MAX_FAILURES, private windowMs = LOGIN_WINDOW_MS) {}

  /** Secondi di attesa se l'IP ha superato il limite, altrimenti 0. */
  retryAfter(ip: string, now = Date.now()): number {
    const entry = this.failures.get(ip)
    if (!entry || entry.resetAt <= now) return 0
    return entry.count >= this.max ? Math.ceil((entry.resetAt - now) / 1000) : 0
  }

  recordFailure(ip: string, now = Date.now()): void {
    this.prune(now)
    const entry = this.failures.get(ip)
    if (!entry || entry.resetAt <= now) this.failures.set(ip, { count: 1, resetAt: now + this.windowMs })
    else entry.count++
  }

  reset(ip: string): void {
    this.failures.delete(ip)
  }

  private prune(now: number): void {
    if (this.failures.size < 1000) return
    for (const [ip, entry] of this.failures) if (entry.resetAt <= now) this.failures.delete(ip)
  }
}

export const loginLimiter = new LoginRateLimiter()
