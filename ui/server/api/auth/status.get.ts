import { SESSION_COOKIE, configuredToken, isAuthenticated } from '../../utils/auth'

// Stato dell'autenticazione per la UI: con auth disattivata l'accesso è sempre consentito.
export default defineEventHandler((event) => {
  const token = configuredToken()
  if (!token) return { enabled: false, authenticated: true }
  return {
    enabled: true,
    authenticated: isAuthenticated({
      cookie: getCookie(event, SESSION_COOKIE),
      authorization: getRequestHeader(event, 'authorization'),
    }, token),
  }
})
