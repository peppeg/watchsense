// Autenticazione opzionale (WATCHSENSE_TOKEN): se il token è impostato, ogni /api/** tranne i
// percorsi pubblici (vedi utils/auth.ts) richiede il cookie ws_session o 'Authorization: Bearer'.
// Senza token non fa nulla. I middleware Nitro girano in ordine alfabetico: auth.ts precede
// csrf.ts, quindi una richiesta non autenticata riceve 401 prima di ogni altro controllo.
// Le chiamate interne ($fetch dello scheduler, useFetch durante l'SSR) passano di qui:
// lo scheduler manda il Bearer, l'SSR inoltra il cookie del browser.

import { SESSION_COOKIE, authDecision, configuredToken } from '../utils/auth'
import { userError, userMessage } from '../utils/user-message'

export default defineEventHandler((event) => {
  const token = configuredToken()
  if (!token) return

  const decision = authDecision({
    path: event.path,
    cookie: getCookie(event, SESSION_COOKIE),
    authorization: getRequestHeader(event, 'authorization'),
  }, token)
  if (decision === 'allow') return

  setResponseHeader(event, 'WWW-Authenticate', 'Bearer')
  throw userError(401, userMessage('errors.auth.required'))
})
