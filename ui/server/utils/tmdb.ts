import { platformFromProvider } from './ingest-normalize'
import { normalizeGenres } from './genres'
import { getLocaleConfig } from './locale'
import type Database from 'better-sqlite3'
import { getDb } from './db'
import { airedEpisodeCount } from './watch-status'

/** Chiave in `config` della chiave TMDB salvata dalle Impostazioni. */
export const TMDB_KEY_CONFIG_KEY = 'tmdb_api_key'

/** Chiave TMDB v3: 32 caratteri esadecimali (i token v4 "Read Access" non sono supportati). */
export function isValidTmdbKey(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value)
}

// getTmdbKey() si chiama spesso: lo statement si prepara una volta per connessione
const keyStmtCache = new WeakMap<Database.Database, Database.Statement>()

/** Chiave TMDB salvata in DB dalle Impostazioni ('' se assente o DB non leggibile). */
export function getStoredTmdbKey(): string {
  try {
    const db = getDb()
    let stmt = keyStmtCache.get(db)
    if (!stmt) {
      stmt = db.prepare('SELECT value FROM config WHERE key = ?')
      keyStmtCache.set(db, stmt)
    }
    const row = stmt.get(TMDB_KEY_CONFIG_KEY) as { value: string } | undefined
    return row?.value?.trim() || ''
  } catch {
    return ''
  }
}

/** Da dove arriva la chiave TMDB effettiva. */
export function getTmdbKeySource(): 'db' | 'env' | 'none' {
  if (getStoredTmdbKey()) return 'db'
  return process.env.TMDB_API_KEY?.trim() ? 'env' : 'none'
}

/**
 * TMDB v3 API key: priorità DB (Impostazioni) → env `TMDB_API_KEY` (che include `<root>/.env`,
 * caricato all'avvio da server/plugins/00.env.ts; vedi docs/CONFIGURATION.md) → ''.
 */
export function getTmdbKey(): string {
  return getStoredTmdbKey() || process.env.TMDB_API_KEY?.trim() || ''
}

const TMDB_TEST_TIMEOUT_MS = 8_000

export type TmdbKeyTestResult =
  | { ok: true }
  | { ok: false, reason: 'rejected', status: number }
  | { ok: false, reason: 'http', status: number }
  | { ok: false, reason: 'network', detail: string }

/**
 * Prova una chiave su TMDB (`/3/configuration`, la chiamata più leggera). 401/403 = chiave
 * rifiutata; gli altri errori HTTP e di rete si distinguono, così la UI non dà la colpa alla chiave.
 */
export async function testTmdbKey(key: string): Promise<TmdbKeyTestResult> {
  const url = new URL('https://api.themoviedb.org/3/configuration')
  url.searchParams.set('api_key', key)
  let res: Response
  try {
    res = await fetch(url.toString(), { signal: AbortSignal.timeout(TMDB_TEST_TIMEOUT_MS) })
  } catch (err: any) {
    // Il dettaglio non deve mai contenere la chiave (finisce nella UI)
    const raw = String(err?.cause?.message || err?.message || 'network error')
    return { ok: false, reason: 'network', detail: raw.split(key).join('…').slice(0, 200) }
  }
  if (res.ok) return { ok: true }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'rejected', status: res.status }
  return { ok: false, reason: 'http', status: res.status }
}

// In-memory cache for provider charts (1 hour TTL). Le chiavi includono lingua e regione TMDB:
// cambiandole dalle Impostazioni non si servono classifiche o schede della config precedente.
const chartsCache = new Map<string, { timestamp: number, data: any[] }>()

/** Svuota le cache in memoria: da chiamare quando cambia la chiave TMDB (una chiave errata
 *  o assente lascia classifiche vuote in cache per un'ora). */
export function clearTmdbCaches(): void {
  chartsCache.clear()
}

export const CHART_SIZE = 12
/** Candidati per le classifiche delle piattaforme: la Home toglie i titoli già mostrati in
 *  una fila precedente e riempie con i successivi (vedi dedupeChartRows). */
const CHART_POOL = 36
const CHART_MAX_PAGES = 3

/**
 * True when a TMDB display name is readable for a Latin-script audience: Latin letters must
 * outnumber letters of other scripts. TMDB falls back to the original name when there is
 * no translation in the configured language, so worldwide-popular shows can surface as "सीआईडी" or "닥터X".
 * Names without letters ("1899", "3%") pass; empty names do not.
 */
export function hasLatinTitle(name: unknown): boolean {
  if (typeof name !== 'string' || !name.trim()) return false
  const letters = name.match(/\p{L}/gu)
  if (!letters) return true
  const latin = letters.filter(ch => /\p{Script=Latin}/u.test(ch)).length
  return latin > letters.length - latin
}

/**
 * Fetches TMDB result pages until `limit` entries with a Latin title are collected
 * (or pages run out). `build(page)` returns the URL for that page.
 */
async function fetchLatinResults(build: (page: number) => URL, limit = CHART_SIZE): Promise<any[]> {
  const out: any[] = []
  for (let page = 1; page <= CHART_MAX_PAGES && out.length < limit; page++) {
    const res = await fetch(build(page).toString())
    if (!res.ok) {
      if (page === 1) return []
      break
    }
    const json: any = await res.json()
    for (const s of json.results || []) {
      if (out.length >= limit) break
      if (hasLatinTitle(s.name)) out.push(s)
    }
    if (page >= (json.total_pages || 1)) break
  }
  return out
}

function toChartItem(s: any, platforms: string) {
  return {
    title: s.name,
    tmdb_id: s.id,
    media_type: 'tv',
    tmdb_name: s.name,
    tmdb_vote_avg: s.vote_average,
    poster_path: s.poster_path,
    backdrop_path: s.backdrop_path,
    tmdb_overview: s.overview,
    platforms,
    episode_count: 0,
    genres: [],
  }
}

export async function fetchStreamingCharts(providerId: number, providerKey: string): Promise<any[]> {
  const { tmdbLanguage, tmdbRegion } = getLocaleConfig()
  const cacheKey = `provider_${providerId}_${tmdbLanguage}_${tmdbRegion}`
  const cached = chartsCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < 3600000) {
    return cached.data
  }

  const key = getTmdbKey()
  if (!key) return []

  try {
    const raw = await fetchLatinResults((page) => {
      const url = new URL('https://api.themoviedb.org/3/discover/tv')
      url.searchParams.set('api_key', key)
      url.searchParams.set('watch_region', tmdbRegion)
      url.searchParams.set('with_watch_providers', providerId.toString())
      url.searchParams.set('sort_by', 'popularity.desc')
      url.searchParams.set('language', tmdbLanguage)
      url.searchParams.set('page', String(page))
      return url
    }, CHART_POOL)
    const results = raw.map(s => toChartItem(s, providerKey))

    chartsCache.set(cacheKey, { timestamp: Date.now(), data: results })
    return results
  } catch {
    return []
  }
}

export async function fetchNetworkCharts(networkIds: string, platformKey: string): Promise<any[]> {
  // I network non dipendono dalla regione, ma la chiave la include per uniformità
  const { tmdbLanguage, tmdbRegion } = getLocaleConfig()
  const cacheKey = `network_${networkIds}_${tmdbLanguage}_${tmdbRegion}`
  const cached = chartsCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < 3600000) {
    return cached.data
  }

  const key = getTmdbKey()
  if (!key) return []

  try {
    const raw = await fetchLatinResults((page) => {
      const url = new URL('https://api.themoviedb.org/3/discover/tv')
      url.searchParams.set('api_key', key)
      url.searchParams.set('with_networks', networkIds)
      url.searchParams.set('sort_by', 'popularity.desc')
      url.searchParams.set('language', tmdbLanguage)
      url.searchParams.set('page', String(page))
      return url
    }, CHART_POOL)
    const results = raw.map(s => toChartItem(s, platformKey))

    chartsCache.set(cacheKey, { timestamp: Date.now(), data: results })
    return results
  } catch {
    return []
  }
}

export async function fetchTrendingShows(): Promise<any[]> {
  const { tmdbLanguage, tmdbRegion } = getLocaleConfig()
  const cacheKey = `trending_tv_week_${tmdbLanguage}_${tmdbRegion}`
  const cached = chartsCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < 3600000) {
    return cached.data
  }

  const key = getTmdbKey()
  if (!key) return []

  try {
    // Title filter runs before the provider lookups, so no calls are spent on dropped entries.
    const rawResults = await fetchLatinResults((page) => {
      const url = new URL('https://api.themoviedb.org/3/trending/tv/week')
      url.searchParams.set('api_key', key)
      url.searchParams.set('language', tmdbLanguage)
      url.searchParams.set('page', String(page))
      return url
    })

    // Fetch providers in parallel for the trending shows
    const results = await Promise.all(rawResults.map(async (s: any) => {
      let platform = ''
      try {
        const provUrl = new URL(`https://api.themoviedb.org/3/tv/${s.id}/watch/providers`)
        provUrl.searchParams.set('api_key', key)
        const provRes = await fetch(provUrl.toString())
        if (provRes.ok) {
          const provJson: any = await provRes.json()
          const flatrate = provJson.results?.[tmdbRegion]?.flatrate || []
          if (flatrate.length > 0) {
            platform = platformFromProvider(flatrate[0].provider_name)
          }
        }
      } catch {}

      return toChartItem(s, platform)
    }))

    chartsCache.set(cacheKey, { timestamp: Date.now(), data: results })
    return results
  } catch {
    return []
  }
}

/** Spazio di id TMDB: /tv/{id} e /movie/{id} sono contenuti diversi. */
export type TmdbMediaType = 'tv' | 'movie'

/**
 * Dettagli di una serie (/tv) o di un film (/movie), con i campi normalizzati
 * sui nomi usati per le serie (title/name → tmdb_name, release_date →
 * tmdb_first_air_date). I film non hanno stagioni né episodi.
 */
export async function fetchShowDetails(tmdbId: number, mediaType: TmdbMediaType = 'tv'): Promise<any | null> {
  const { tmdbLanguage, tmdbRegion } = getLocaleConfig()
  const cacheKey = `show_details_${mediaType}_${tmdbId}_${tmdbLanguage}_${tmdbRegion}`
  const cached = chartsCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < 3600000) {
    return cached.data
  }

  const key = getTmdbKey()
  if (!key) return null

  try {
    const url = new URL(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}`)
    url.searchParams.set('api_key', key)
    url.searchParams.set('language', tmdbLanguage)
    url.searchParams.set('append_to_response', 'keywords,watch/providers')

    const res = await fetch(url.toString())
    if (!res.ok) return null
    const data: any = await res.json()
    const isMovie = mediaType === 'movie'

    const genres = normalizeGenres((data.genres || []).map((g: any) => g.name))
    // /tv: keywords.results, /movie: keywords.keywords
    const keywords = (data.keywords?.results || data.keywords?.keywords || []).map((k: any) => k.name)
    const networks = (isMovie ? [] : data.networks || []).map((n: any) => n.name)
    const regionProviders = data['watch/providers']?.results?.[tmdbRegion]?.flatrate || []
    const providers = regionProviders.map((p: any) => p.provider_name)
    const name = isMovie ? data.title : data.name

    const show = {
      title: name,
      tmdb_id: data.id,
      media_type: mediaType,
      tmdb_name: name,
      tmdb_overview: data.overview,
      tmdb_vote_avg: data.vote_average,
      tmdb_status: data.status,
      poster_path: data.poster_path,
      backdrop_path: data.backdrop_path,
      tmdb_number_of_episodes: isMovie ? null : data.number_of_episodes,
      tmdb_number_of_seasons: isMovie ? null : data.number_of_seasons,
      tmdb_aired_episodes: isMovie ? null : airedEpisodeCount(data),
      tmdb_first_air_date: isMovie ? data.release_date : data.first_air_date,
      genres,
      keywords,
      networks,
      providers,
      platforms: regionProviders.length > 0 ? platformFromProvider(regionProviders[0].provider_name) : '',
      episode_count: 0,
      first_watched: null,
      last_watched: null,
    }

    chartsCache.set(cacheKey, { timestamp: Date.now(), data: show })
    return show
  } catch {
    return null
  }
}

/** Titoli simili dallo stesso spazio di id (/tv/{id}/… o /movie/{id}/…). */
export async function fetchSimilarShows(tmdbId: number, mediaType: TmdbMediaType = 'tv'): Promise<any[]> {
  const { tmdbLanguage } = getLocaleConfig()
  const cacheKey = `show_similar_${mediaType}_${tmdbId}_${tmdbLanguage}`
  const cached = chartsCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < 3600000) {
    return cached.data
  }

  const key = getTmdbKey()
  if (!key) return []

  try {
    // 1. Try curated TMDB recommendations endpoint first (much higher quality than raw similar)
    let url = new URL(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/recommendations`)
    url.searchParams.set('api_key', key)
    url.searchParams.set('language', tmdbLanguage)

    let res = await fetch(url.toString())
    let json: any = res.ok ? await res.json() : null

    // 2. Fallback to similar only if recommendations returns no results
    if (!json?.results || json.results.length === 0) {
      url = new URL(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/similar`)
      url.searchParams.set('api_key', key)
      url.searchParams.set('language', tmdbLanguage)
      res = await fetch(url.toString())
      json = res.ok ? await res.json() : null
    }

    if (!json?.results) return []

    // Filter: require valid poster, exclude non-Latin untranslated titles (Chinese, Japanese, Arabic, Thai, Korean)
    const nonLatinRegex = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f\u0600-\u06FF\u0E00-\u0E7F\u0900-\u097F\uAC00-\uD7AF]/
    const results = (json.results || [])
      .map((s: any) => ({ ...s, name: s.name || s.title }))
      .filter((s: any) => s.poster_path && s.name && !nonLatinRegex.test(s.name))
      .slice(0, 12)
      .map((s: any) => ({
        title: s.name,
        tmdb_id: s.id,
        media_type: mediaType,
        tmdb_name: s.name,
        tmdb_vote_avg: s.vote_average,
        poster_path: s.poster_path,
        backdrop_path: s.backdrop_path,
        tmdb_overview: s.overview,
        platforms: '',
        episode_count: 0,
      }))

    chartsCache.set(cacheKey, { timestamp: Date.now(), data: results })
    return results
  } catch {
    return []
  }
}
