import { setSecretConfig } from '../../utils/secrets'
import { StremioLoginError, stremioLogin } from '../../utils/stremio'
import { userError, userMessage } from '../../utils/user-message'

// Collega Stremio con email e password: si salva SOLO la authKey restituita da Stremio
// (stessa chiave del campo authKey delle Impostazioni). La password non si salva, non si
// registra nei log e non torna nella risposta; nemmeno la authKey torna al browser.
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!email || !password) {
    throw userError(400, userMessage('sync.stremio.loginMissing'))
  }

  let authKey: string
  try {
    authKey = await stremioLogin(email, password)
  } catch (err: any) {
    if (err instanceof StremioLoginError) throw userError(err.statusCode, err.userMessage)
    throw userError(502, userMessage('sync.stremio.loginUnexpected'))
  }

  setSecretConfig('stremio_auth_key', authKey)
  return { ok: true, ...userMessage('sync.stremio.loginDone') }
})
