import { getTmdbKey, isValidTmdbKey, testTmdbKey } from '../../utils/tmdb'
import { userError, userMessage } from '../../utils/user-message'

// Prova la chiave TMDB dalle Impostazioni: quella del form se c'è, altrimenti quella effettiva
// (DB → env). Non salva nulla e non restituisce mai la chiave.
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({})) || {}

  let key = typeof body.api_key === 'string' ? body.api_key.trim() : ''
  if (key && !key.includes('••••••••')) {
    if (!isValidTmdbKey(key)) throw userError(400, userMessage('errors.config.invalidTmdbKey'))
  } else {
    key = getTmdbKey()
    if (!key) throw userError(400, userMessage('settings.tmdb.testNoKey'))
  }

  const result = await testTmdbKey(key)
  if (result.ok) return { ok: true, ...userMessage('settings.tmdb.testOk') }
  if (result.reason === 'rejected') {
    throw userError(400, userMessage('settings.tmdb.testRejected', { status: result.status }), { reason: 'rejected' })
  }
  if (result.reason === 'http') {
    throw userError(502, userMessage('settings.tmdb.testHttp', { status: result.status }), { reason: 'http' })
  }
  throw userError(502, userMessage('settings.tmdb.testUnreachable', { detail: result.detail }), { reason: 'network' })
})
