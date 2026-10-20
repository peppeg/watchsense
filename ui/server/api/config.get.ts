import { getDb } from '../utils/db'
import { getLlmConfig, isLlmConfigured } from '../utils/llm'
import {
  envNetflixSyncIntervalHours,
  getNetflixSyncInterval,
  netflixSyncIntervalChoices,
  nextScheduledRun,
  STREMIO_SYNC_INTERVAL_HOURS,
} from '../utils/sync-helpers'
import { seriesRows } from '../utils/series-filter'
import { getIngestToken } from '../utils/ingest-token'
import { CHART_REGIONS, getHomeLayout } from '../utils/home-layout'
import { getLocaleConfig, isLocaleConfigured, SUPPORTED_LOCALES } from '../utils/locale'
import { ONBOARDING_DISMISSED_KEY } from '../utils/onboarding'
import { getTmdbKey, getTmdbKeySource } from '../utils/tmdb'

function maskSecret(val: string | null | undefined): string {
  if (!val || val.length === 0) return ''
  if (val.length <= 8) return '••••••••'
  return `${val.slice(0, 4)}••••••••${val.slice(-4)}`
}

function parseJson(val: string | undefined): any {
  if (!val) return null
  try {
    return JSON.parse(val)
  } catch {
    return null
  }
}

export default defineEventHandler(() => {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM config').all() as { key: string; value: string }[]
  const configMap: Record<string, string> = {}
  for (const r of rows) {
    configMap[r.key] = r.value
  }

  // Config LLM effettiva (DB → env)
  const llmConfig = getLlmConfig()

  const stremioAuthKey = configMap.stremio_auth_key || ''
  const netflixCookies = configMap.netflix_cookies || ''
  const locale = getLocaleConfig(db)
  const tmdbKey = getTmdbKey()
  const netflixInterval = getNetflixSyncInterval()

  // Episodi di serie per piattaforma (stato delle fonti nelle Impostazioni)
  const platforms: Record<string, { episodes: number; last_watched: string | null }> = {}
  const platformRows = db.prepare(`
    SELECT platform, COUNT(*) AS episodes, MAX(watched_at) AS last_watched
    FROM shows WHERE ${seriesRows()} GROUP BY platform
  `).all() as { platform: string; episodes: number; last_watched: string | null }[]
  for (const r of platformRows) platforms[r.platform] = { episodes: r.episodes, last_watched: r.last_watched }

  return {
    llm: {
      base_url: llmConfig.base_url,
      model: llmConfig.model,
      has_api_key: Boolean(llmConfig.api_key),
      masked_api_key: maskSecret(llmConfig.api_key),
      // Pronto per le chiamate (chiave, o provider locale): stesse regole di assertLlmConfig
      configured: isLlmConfigured(llmConfig),
    },
    // Chiave TMDB effettiva (DB → env): solo stato e versione mascherata, mai la chiave
    tmdb: {
      has_api_key: Boolean(tmdbKey),
      masked_api_key: maskSecret(tmdbKey),
      source: getTmdbKeySource(),
    },
    sync: {
      stremio: {
        has_auth_key: Boolean(stremioAuthKey),
        masked_auth_key: maskSecret(stremioAuthKey),
        // Esito ultima sync (manuale o automatica): { ok, at, message }
        last_status: parseJson(configMap.last_sync_status_stremio),
        // Prossima sync automatica prevista (lo scheduler controlla ogni ora)
        next_run_at: stremioAuthKey ? nextScheduledRun(configMap.last_cron_stremio, STREMIO_SYNC_INTERVAL_HOURS) : null,
      },
      netflix: {
        has_cookies: Boolean(netflixCookies),
        masked_cookies: maskSecret(netflixCookies),
        // Esito ultima sync (manuale o automatica): { ok, at, message }
        last_status: parseJson(configMap.last_sync_status_netflix),
        // Intervallo della sync automatica: DB (Impostazioni) → env SYNC_INTERVAL_HOURS → 12
        interval_hours: netflixInterval.hours,
        interval_source: netflixInterval.source,
        interval_choices: netflixSyncIntervalChoices(),
        env_interval_hours: envNetflixSyncIntervalHours(),
        next_run_at: netflixCookies ? nextScheduledRun(configMap.last_cron_netflix, netflixInterval.hours) : null,
      },
      // Token del bookmarklet: serve alla UI per generarne il codice (le Impostazioni sono
      // protette da WATCHSENSE_TOKEN, se impostato); esito dell'ultimo invio
      bookmarklet: {
        ingest_token: getIngestToken(),
        last_status: parseJson(configMap.last_sync_status_bookmarklet),
      },
      platforms,
      last_sync_timestamp: configMap.last_sync_timestamp || null,
      last_sync_result: parseJson(configMap.last_sync_result),
    },
    // Sezioni della Home con lo stato visibile/nascosta
    home: getHomeLayout(),
    // Lingua dell'app e lingua/regione TMDB effettive (DB → env → default)
    locale: {
      app_locale: locale.appLocale,
      tmdb_language: locale.tmdbLanguage,
      tmdb_region: locale.tmdbRegion,
      // Scelte almeno una volta (DB o env), non solo i default
      configured: isLocaleConfigured(db),
      supported_locales: SUPPORTED_LOCALES,
      // Regioni con le classifiche della Home verificate (server/utils/home-layout.ts)
      chart_regions: CHART_REGIONS,
    },
    // Lista "Per iniziare" della Home nascosta con "Nascondi"
    onboarding: {
      dismissed: configMap[ONBOARDING_DISMISSED_KEY] === '1',
    },
    taste: {
      custom_notes: configMap.taste_custom_notes || '',
      ai_summary: configMap.taste_ai_summary || '',
      ai_summary_updated_at: configMap.taste_ai_summary_updated_at || null,
    },
  }
})
