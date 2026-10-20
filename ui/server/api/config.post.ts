import { getDb } from '../utils/db'
import { getLlmConfig, getStoredLlmConfig, sameBaseUrl } from '../utils/llm'
import { setHiddenHomeSections } from '../utils/home-layout'
import { LOCALE_CONFIG_KEYS, normalizeAppLocale, normalizeTmdbLanguage, normalizeTmdbRegion } from '../utils/locale'
import { userError, userMessage } from '../utils/user-message'
import { clearTmdbCaches, isValidTmdbKey, TMDB_KEY_CONFIG_KEY } from '../utils/tmdb'
import { ONBOARDING_DISMISSED_KEY } from '../utils/onboarding'
import { isValidNetflixSyncInterval, NETFLIX_INTERVAL_CONFIG_KEY, netflixSyncIntervalChoices } from '../utils/sync-helpers'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const body = await readBody(event).catch(() => ({}))

  const setConfig = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')

  // 0. Lingua e regione: si validano tutte prima di salvare qualsiasi cosa, così un
  //    valore non valido non lascia un salvataggio a metà
  const localeUpdates: [string, string][] = []
  if (body.locale) {
    const fields = [
      ['app_locale', LOCALE_CONFIG_KEYS.appLocale, normalizeAppLocale, 'errors.config.invalidAppLocale'],
      ['tmdb_language', LOCALE_CONFIG_KEYS.tmdbLanguage, normalizeTmdbLanguage, 'errors.config.invalidTmdbLanguage'],
      ['tmdb_region', LOCALE_CONFIG_KEYS.tmdbRegion, normalizeTmdbRegion, 'errors.config.invalidTmdbRegion'],
    ] as const
    for (const [field, key, normalize, code] of fields) {
      if (body.locale[field] === undefined) continue
      const value = normalize(body.locale[field])
      if (!value) throw userError(400, userMessage(code))
      localeUpdates.push([key, value])
    }
  }
  // Chiave TMDB: come la chiave LLM (vuota o mascherata = invariata, clear_api_key = cancella).
  // Si valida qui, prima di salvare il resto. null = nessuna modifica, '' = cancella.
  let tmdbKeyUpdate: string | null = null
  if (body.tmdb && body.tmdb.api_key !== undefined) {
    const keyTrimmed = String(body.tmdb.api_key).trim()
    if (keyTrimmed !== '' && !keyTrimmed.includes('••••••••')) {
      if (!isValidTmdbKey(keyTrimmed)) throw userError(400, userMessage('errors.config.invalidTmdbKey'))
      tmdbKeyUpdate = keyTrimmed
    } else if (body.tmdb.clear_api_key) {
      tmdbKeyUpdate = ''
    }
  }

  // Intervallo della sync automatica Netflix: solo uno di quelli offerti (6/12/24, più il
  // valore dell'env se diverso); null = torna all'env/default. undefined = nessuna modifica.
  let netflixIntervalUpdate: number | null | undefined
  if (body.netflix && body.netflix.sync_interval_hours !== undefined) {
    const value = body.netflix.sync_interval_hours
    if (value === null || value === '') {
      netflixIntervalUpdate = null
    } else if (isValidNetflixSyncInterval(value)) {
      netflixIntervalUpdate = Number(value)
    } else {
      throw userError(400, userMessage('errors.config.invalidSyncInterval', { choices: netflixSyncIntervalChoices().join(', ') }))
    }
  }

  // Lista "Per iniziare" nascosta: solo un booleano. undefined = nessuna modifica.
  let onboardingDismissed: boolean | undefined
  if (body.onboarding && body.onboarding.dismissed !== undefined) {
    if (typeof body.onboarding.dismissed !== 'boolean') throw userError(400, userMessage('errors.config.invalidOnboarding'))
    onboardingDismissed = body.onboarding.dismissed
  }

  for (const [key, value] of localeUpdates) setConfig.run(key, value)

  if (onboardingDismissed === true) setConfig.run(ONBOARDING_DISMISSED_KEY, '1')
  else if (onboardingDismissed === false) db.prepare('DELETE FROM config WHERE key = ?').run(ONBOARDING_DISMISSED_KEY)

  if (netflixIntervalUpdate === null) db.prepare('DELETE FROM config WHERE key = ?').run(NETFLIX_INTERVAL_CONFIG_KEY)
  else if (netflixIntervalUpdate !== undefined) setConfig.run(NETFLIX_INTERVAL_CONFIG_KEY, String(netflixIntervalUpdate))

  if (tmdbKeyUpdate !== null) {
    // Cancellata: la riga sparisce e torna valida TMDB_API_KEY dell'env (se c'è)
    if (tmdbKeyUpdate) setConfig.run(TMDB_KEY_CONFIG_KEY, tmdbKeyUpdate)
    else db.prepare('DELETE FROM config WHERE key = ?').run(TMDB_KEY_CONFIG_KEY)
    // Le classifiche in cache possono venire dalla chiave precedente (o dalla sua assenza)
    clearTmdbCaches()
  }

  // 1. LLM Config
  if (body.llm) {
    // Base: config effettiva, ma la chiave salvata in DB è solo quella del DB (mai quella da env)
    const effective = getLlmConfig()
    const currentLlm = {
      base_url: effective.base_url,
      api_key: getStoredLlmConfig()?.api_key?.trim() || '',
      model: effective.model,
    }

    if (body.llm.base_url !== undefined) {
      const newBase = String(body.llm.base_url).trim().replace(/\/+$/, '')
      // Cambio provider: la vecchia chiave non va mai inviata al nuovo base_url
      if (!sameBaseUrl(newBase, currentLlm.base_url)) currentLlm.api_key = ''
      currentLlm.base_url = newBase
    }
    if (body.llm.model !== undefined) currentLlm.model = String(body.llm.model).trim()
    // Update API key only if provided non-empty, or explicitly cleared
    if (body.llm.api_key !== undefined) {
      const keyTrimmed = body.llm.api_key.trim()
      if (keyTrimmed !== '' && !keyTrimmed.includes('••••••••')) {
        currentLlm.api_key = keyTrimmed
      } else if (body.llm.clear_api_key) {
        currentLlm.api_key = ''
      }
    }

    setConfig.run('llm_config', JSON.stringify(currentLlm))
  }

  // 2. Stremio Auth Key
  if (body.stremio) {
    if (body.stremio.auth_key !== undefined) {
      const keyTrimmed = body.stremio.auth_key.trim()
      if (keyTrimmed !== '' && !keyTrimmed.includes('••••••••')) {
        setConfig.run('stremio_auth_key', keyTrimmed)
      } else if (body.stremio.clear_auth_key) {
        setConfig.run('stremio_auth_key', '')
      }
    }
  }

  // 3. Netflix Cookies
  if (body.netflix) {
    if (body.netflix.cookies !== undefined) {
      const val = body.netflix.cookies.trim()
      if (val !== '' && !val.includes('••••••••')) {
        setConfig.run('netflix_cookies', val)
      } else if (body.netflix.clear_cookies) {
        setConfig.run('netflix_cookies', '')
      }
    }
  }

  // 4. Custom Taste Notes
  if (body.taste && body.taste.custom_notes !== undefined) {
    setConfig.run('taste_custom_notes', body.taste.custom_notes.trim())
  }

  // 5. Sezioni nascoste della Home
  if (body.home && body.home.hidden !== undefined) {
    if (!setHiddenHomeSections(body.home.hidden)) {
      throw userError(400, userMessage('errors.config.invalidHomeSections'))
    }
  }

  return { ok: true, ...userMessage('settings.saved') }
})
