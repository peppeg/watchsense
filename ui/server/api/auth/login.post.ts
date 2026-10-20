import { SESSION_COOKIE, SESSION_MAX_AGE, configuredToken, loginLimiter, safeEqual, sessionValue } from '../../utils/auth'
import { userError, userMessage } from '../../utils/user-message'

const FAILURE_DELAY_MS = 300

// Login con il token: imposta il cookie ws_session (derivato dal token, mai il token stesso).
// Limite: LOGIN_MAX_FAILURES tentativi errati al minuto per IP (in memoria).
export default defineEventHandler(async (event) => {
  const token = configuredToken()
  if (!token) return { ok: true, enabled: false }

  // IP del socket (X-Forwarded-For è falsificabile): dietro un proxy il limite diventa globale
  const ip = getRequestIP(event) || 'unknown'
  const wait = loginLimiter.retryAfter(ip)
  if (wait) {
    setResponseHeader(event, 'Retry-After', String(wait))
    throw userError(429, userMessage('errors.auth.tooManyAttempts', { seconds: wait }))
  }

  const body = await readBody(event).catch(() => null)
  const given = body && typeof body === 'object' && typeof body.token === 'string' ? body.token.trim() : ''
  if (!safeEqual(given, token)) {
    loginLimiter.recordFailure(ip)
    await new Promise(resolve => setTimeout(resolve, FAILURE_DELAY_MS))
    throw userError(401, userMessage('errors.auth.invalidToken'))
  }

  loginLimiter.reset(ip)
  setCookie(event, SESSION_COOKIE, sessionValue(token), {
    httpOnly: true,
    sameSite: 'strict',
    secure: getRequestProtocol(event) === 'https',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
  return { ok: true, enabled: true }
})
