import { SESSION_COOKIE } from '../../utils/auth'

// Cancella il cookie di sessione nel browser. Il valore è derivato dal token:
// per invalidare ogni sessione esistente bisogna cambiare WATCHSENSE_TOKEN.
export default defineEventHandler((event) => {
  deleteCookie(event, SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'strict' })
  return { ok: true }
})
