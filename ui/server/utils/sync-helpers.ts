import { createError } from 'h3'
import { getDb } from './db'
import { fetchShowDetails, getTmdbKey } from './tmdb'
import { airedEpisodeCount } from './watch-status'
import { normalizeGenres } from './genres'
import { getLocaleConfig } from './locale'
import { messageFields, userMessage, UserMessageError, type UserMessage } from './user-message'

export type MediaType = 'tv' | 'movie'

/** Risultato di un abbinamento TMDB: l'id va letto sull'endpoint di `mediaType` (/tv o /movie). */
export interface TmdbMatch {
  tmdbId: number
  mediaType: MediaType
  name: string
  posterPath?: string
}

/** Valore valido per la colonna media_type, altrimenti null. */
export function parseMediaType(value: unknown): MediaType | null {
  return value === 'tv' || value === 'movie' ? value : null
}

/**
 * Tipo richiesto da un parametro di API (`?type=`, `media_type` nel body):
 * assente → 'tv' (compatibilità con i client che non lo inviano), non valido → 400.
 */
export function requireMediaType(value: unknown): MediaType {
  if (value === undefined || value === null || value === '') return 'tv'
  const type = parseMediaType(value)
  if (!type) {
    throw createError({ statusCode: 400, message: "Invalid media type: expected 'tv' or 'movie'" })
  }
  return type
}

/**
 * Resolve an IMDb ID (e.g. "tt0903747") to a TMDB ID.
 * `preferred` decide quale lista di /find vince se l'id compare in entrambe
 * (default: serie, come prima); `mediaType` dice quale endpoint ha restituito l'id.
 */
export async function resolveImdbToTmdb(imdbId: string, preferred: MediaType = 'tv'): Promise<TmdbMatch | null> {
  const key = getTmdbKey()
  if (!key || !imdbId) return null

  try {
    const url = new URL(`https://api.themoviedb.org/3/find/${imdbId}`)
    url.searchParams.set('api_key', key)
    url.searchParams.set('external_source', 'imdb_id')
    url.searchParams.set('language', getLocaleConfig().tmdbLanguage)

    const res = await fetch(url.toString())
    if (!res.ok) return null
    const json: any = await res.json()

    const tv = json.tv_results?.[0]
    const movie = json.movie_results?.[0]
    const tvMatch: TmdbMatch | null = tv ? { tmdbId: tv.id, mediaType: 'tv', name: tv.name || tv.original_name } : null
    const movieMatch: TmdbMatch | null = movie ? { tmdbId: movie.id, mediaType: 'movie', name: movie.title || movie.original_title } : null
    return preferred === 'movie' ? (movieMatch || tvMatch) : (tvMatch || movieMatch)
  } catch {
    return null
  }
}

function sameTitle(a: unknown, query: string): boolean {
  return typeof a === 'string' && a.toLowerCase() === query.toLowerCase()
}

/** GET su un endpoint di ricerca TMDB; lista dei risultati (vuota se errore, o eccezione con `strict`). */
async function tmdbSearch(endpoint: 'tv' | 'movie' | 'multi', key: string, query: string, strict = false): Promise<any[]> {
  const url = new URL(`https://api.themoviedb.org/3/search/${endpoint}`)
  url.searchParams.set('api_key', key)
  url.searchParams.set('language', getLocaleConfig().tmdbLanguage)
  url.searchParams.set('query', query)
  const res = await fetch(url.toString())
  if (!res.ok) {
    if (strict) throw new Error(`TMDB search/${endpoint}: HTTP ${res.status}`)
    return []
  }
  const json: any = await res.json()
  return Array.isArray(json?.results) ? json.results : []
}

/** Primo risultato con titolo esatto, altrimenti il primo; null se la lista è vuota. */
function pickResult(results: any[], query: string, mediaType: MediaType | null): TmdbMatch | null {
  const typed = results
    .map(r => ({ r, type: mediaType || parseMediaType(r?.media_type) }))
    .filter((x): x is { r: any; type: MediaType } => x.type !== null)
  if (typed.length === 0) return null
  const exact = typed.find(({ r }) =>
    sameTitle(r.name, query) || sameTitle(r.title, query) ||
    sameTitle(r.original_name, query) || sameTitle(r.original_title, query))
  const { r, type } = exact || typed[0]!
  return {
    tmdbId: r.id,
    mediaType: type,
    name: r.name || r.title || r.original_name || r.original_title,
    posterPath: r.poster_path || undefined,
  }
}

/**
 * Search TMDB by title (lingua TMDB configurata, utils/locale.ts).
 * - preferred 'tv' (default, comportamento storico): /search/tv, poi /search/multi;
 * - preferred 'movie' (il chiamante sa che è un film): /search/movie, poi /search/tv.
 * `mediaType` è il tipo dell'endpoint/risultato che ha dato l'id: va salvato con l'id.
 */
export async function searchTmdbByTitle(title: string, preferred: MediaType = 'tv'): Promise<TmdbMatch | null> {
  const key = getTmdbKey()
  if (!key || !title) return null

  const cleanQuery = title.replace(/:\s*Il processo.*$/i, '').trim()

  try {
    if (preferred === 'movie') {
      return pickResult(await tmdbSearch('movie', key, cleanQuery), cleanQuery, 'movie')
        || pickResult(await tmdbSearch('tv', key, cleanQuery), cleanQuery, 'tv')
    }
    // Fallback: search/multi in case it is classified as a movie/miniseries (persone escluse)
    return pickResult(await tmdbSearch('tv', key, cleanQuery), cleanQuery, 'tv')
      || pickResult(await tmdbSearch('multi', key, cleanQuery), cleanQuery, null)
  } catch {
    return null
  }
}

/**
 * Cerca solo tra le serie TV (/search/tv): nessun ripiego su film. Per i riabbinamenti
 * in un'app di sole serie, dove un film trovato non va collegato a righe 'tv'.
 */
export async function searchTmdbTvByTitle(title: string): Promise<TmdbMatch | null> {
  const key = getTmdbKey()
  if (!key || !title) return null
  const cleanQuery = title.replace(/:\s*Il processo.*$/i, '').trim()
  try {
    return pickResult(await tmdbSearch('tv', key, cleanQuery), cleanQuery, 'tv')
  } catch {
    return null
  }
}

/** Risultato di /search/tv per la scelta manuale dell'abbinamento. */
export interface TmdbTvCandidate {
  id: number
  name: string
  original_name: string | null
  first_air_date: string | null
  poster_path: string | null
  overview: string
}

/** Lunghezza massima della trama nei risultati di ricerca (la lista resta compatta). */
const CANDIDATE_OVERVIEW_MAX = 220

/**
 * Tutti i risultati (prima pagina) di /search/tv, nella lingua TMDB configurata, per l'abbinamento manuale: solo
 * serie. Eccezione se la chiave manca o TMDB non risponde (il chiamante mostra l'errore).
 */
export async function searchTmdbTvCandidates(query: string): Promise<TmdbTvCandidate[]> {
  const key = getTmdbKey()
  if (!key) throw new UserMessageError(userMessage('errors.tmdbKeyMissingSearch'))
  const results = await tmdbSearch('tv', key, query, true)
  return results
    .filter(r => Number.isSafeInteger(r?.id) && r.id > 0)
    .map(r => {
      const overview = typeof r.overview === 'string' ? r.overview.trim() : ''
      return {
        id: r.id,
        name: r.name || r.original_name || `#${r.id}`,
        original_name: r.original_name && r.original_name !== r.name ? r.original_name : null,
        first_air_date: r.first_air_date || null,
        poster_path: r.poster_path || null,
        overview: overview.length > CANDIDATE_OVERVIEW_MAX ? `${overview.slice(0, CANDIDATE_OVERVIEW_MAX - 1).trimEnd()}…` : overview,
      }
    })
}

/** Metadati TMDB di un titolo, pronti per le colonne tmdb_* di `shows`. */
export interface TmdbEnrichment {
  name: string
  genres: string[]
  overview: string
  keywords: string[]
  networks: string[]
  watchProviders: string[]
  voteAvg: number
  status: string
  posterPath: string | null
  backdropPath: string | null
  numberOfEpisodes: number | null
  numberOfSeasons: number | null
  /** Episodi già usciti (serie; null se ignoto, vedi airedEpisodeCount). */
  airedEpisodes: number | null
  firstAirDate: string | null
}

/**
 * Scarica dettagli, keyword e provider della regione configurata di un id TMDB dall'endpoint di `mediaType`
 * (/tv o /movie): nessun tentativo di indovinare il tipo. null se TMDB non risponde.
 */
export async function fetchTmdbEnrichment(tmdbId: number, mediaType: MediaType): Promise<TmdbEnrichment | null> {
  const key = getTmdbKey()
  if (!key || !tmdbId) return null
  const isMovie = mediaType === 'movie'
  const { tmdbLanguage, tmdbRegion } = getLocaleConfig()

  try {
    const details: any = await fetch(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${key}&language=${encodeURIComponent(tmdbLanguage)}`)
      .then(r => r.json()).catch(() => null)

    if (!details || !details.id) return null

    const [keywords, providers] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/keywords?api_key=${key}`).then(r => r.json()).catch(() => ({ results: [] })),
      fetch(`https://api.themoviedb.org/3/${mediaType}/${tmdbId}/watch/providers?api_key=${key}`).then(r => r.json()).catch(() => ({ results: {} })),
    ])

    // /movie/{id}/keywords risponde con `keywords`, /tv/{id}/keywords con `results`
    const rawKeywords = isMovie ? (keywords.keywords || []) : (keywords.results || [])
    return {
      name: details.name || details.title || details.original_name || details.original_title,
      genres: normalizeGenres(details.genres?.map((g: any) => g.name)),
      overview: details.overview || '',
      keywords: rawKeywords.map((k: any) => k.name) || [],
      networks: details.networks?.map((n: any) => n.name) || [],
      watchProviders: providers.results?.[tmdbRegion]?.flatrate?.map((p: any) => p.provider_name) || [],
      voteAvg: details.vote_average || 0,
      status: details.status || '',
      posterPath: details.poster_path || null,
      backdropPath: details.backdrop_path || null,
      numberOfEpisodes: details.number_of_episodes || (isMovie ? 1 : null),
      numberOfSeasons: details.number_of_seasons || (isMovie ? 1 : null),
      airedEpisodes: isMovie ? null : airedEpisodeCount(details),
      firstAirDate: details.first_air_date || details.release_date || null,
    }
  } catch {
    return null
  }
}

/**
 * Scrive i metadati sulle righe non ancora arricchite di (tmdb_id, media_type, platform).
 * Stato TMDB e conteggi di episodi e stagioni cambiano finché la serie è in onda: quelli si
 * aggiornano su tutte le righe del titolo, così righe arricchite in momenti diversi non
 * mostrano totali diversi.
 */
export function applyTmdbEnrichment(data: TmdbEnrichment, tmdbId: number, mediaType: MediaType, platform: string): void {
  const db = getDb()
  db.prepare(`
    UPDATE shows SET
      tmdb_name = ?,
      tmdb_genres = ?,
      tmdb_overview = ?,
      tmdb_keywords = ?,
      tmdb_networks = ?,
      tmdb_watch_providers = ?,
      tmdb_vote_avg = ?,
      tmdb_status = ?,
      poster_path = ?,
      backdrop_path = ?,
      tmdb_number_of_episodes = ?,
      tmdb_number_of_seasons = ?,
      tmdb_aired_episodes = ?,
      tmdb_first_air_date = ?,
      enriched_at = datetime('now')
    WHERE tmdb_id = ? AND media_type = ? AND platform = ? AND tmdb_genres IS NULL
  `).run(
    data.name,
    JSON.stringify(data.genres),
    data.overview,
    JSON.stringify(data.keywords),
    JSON.stringify(data.networks),
    JSON.stringify(data.watchProviders),
    data.voteAvg,
    data.status,
    data.posterPath,
    data.backdropPath,
    data.numberOfEpisodes,
    data.numberOfSeasons,
    data.airedEpisodes,
    data.firstAirDate,
    tmdbId,
    mediaType,
    platform,
  )
  updateEpisodeCounts(tmdbId, mediaType, {
    status: data.status,
    numberOfEpisodes: data.numberOfEpisodes,
    numberOfSeasons: data.numberOfSeasons,
    airedEpisodes: data.airedEpisodes,
  })
}

type EpisodeCounts = Pick<TmdbEnrichment, 'status' | 'numberOfEpisodes' | 'numberOfSeasons' | 'airedEpisodes'>

/** Stato TMDB, totali ed episodi usciti su tutte le righe già arricchite di un titolo. */
function updateEpisodeCounts(tmdbId: number, mediaType: MediaType, c: EpisodeCounts): void {
  getDb().prepare(`
    UPDATE shows SET tmdb_status = ?, tmdb_number_of_episodes = ?, tmdb_number_of_seasons = ?, tmdb_aired_episodes = ?
    WHERE tmdb_id = ? AND media_type = ? AND tmdb_genres IS NOT NULL
  `).run(c.status, c.numberOfEpisodes, c.numberOfSeasons, c.airedEpisodes, tmdbId, mediaType)
}

/** Stati TMDB di una serie conclusa: episodi usciti = totale, niente da aggiornare. */
const FINISHED_TMDB_STATUSES = new Set(['Ended', 'Canceled'])

/** Serie arricchita ancora in onda (o in produzione): gli episodi usciti cambiano nel tempo. */
export function isAiringStatus(status: unknown): boolean {
  return typeof status === 'string' && status !== '' && !FINISHED_TMDB_STATUSES.has(status)
}

/**
 * Serie in onda: l'arricchimento non si ripete, quindi la scheda serie aggiorna stato,
 * totali ed episodi usciti dai dettagli TMDB (fetchShowDetails, in cache per un'ora).
 * Restituisce i valori scritti, o null (nessuna chiave TMDB, TMDB non risponde, episodi
 * usciti ignoti): in quel caso il DB resta com'è.
 */
export async function refreshAiringInfo(tmdbId: number): Promise<EpisodeCounts | null> {
  const details = await fetchShowDetails(tmdbId, 'tv').catch(() => null)
  if (!details || details.tmdb_aired_episodes == null) return null
  const counts: EpisodeCounts = {
    status: details.tmdb_status || '',
    numberOfEpisodes: details.tmdb_number_of_episodes || null,
    numberOfSeasons: details.tmdb_number_of_seasons || null,
    airedEpisodes: details.tmdb_aired_episodes,
  }
  try {
    updateEpisodeCounts(tmdbId, 'tv', counts)
  } catch {
    return null
  }
  return counts
}

/**
 * Enriches all unenriched shows in SQLite for a given TMDB ID, media type and platform.
 * Per un singolo titolo (aggiunte manuali); gli import usano `runIngest` (utils/ingest.ts).
 */
export async function enrichShowRecord(tmdbId: number, mediaType: MediaType, platform: string): Promise<boolean> {
  const data = await fetchTmdbEnrichment(tmdbId, mediaType)
  if (!data) return false
  try {
    applyTmdbEnrichment(data, tmdbId, mediaType, platform)
    return true
  } catch {
    return false
  }
}

/** Causa di una sync fallita: 'auth' = credenziali rifiutate (cookie scaduti), 'error' = altro. */
export type SyncFailureReason = 'auth' | 'error'

/**
 * Salva l'esito dell'ultima sync di un servizio (`last_sync_status_<service>`)
 * come JSON { ok, at, message, code?, params?, notes?, reason? }. Usato sia dalle sync manuali
 * sia dallo scheduler. Con un messaggio con codice (utils/user-message.ts) la UI lo traduce;
 * `message` resta il testo italiano. `reason` serve solo per gli esiti falliti (default 'error').
 */
export function setSyncStatus(service: string, ok: boolean, message: string | UserMessage, reason?: SyncFailureReason): void {
  try {
    const text = typeof message === 'string' ? { message } : { message: message.message, ...messageFields(message) }
    const status = ok
      ? { ok, at: new Date().toISOString(), ...text }
      : { ok, at: new Date().toISOString(), ...text, reason: reason || 'error' }
    getDb()
      .prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
      .run(`last_sync_status_${service}`, JSON.stringify(status))
  } catch (e: any) {
    console.error(`[WatchSense] Cannot save the ${service} sync state:`, e.message)
  }
}

/** Chiave in config dell'intervallo della sync automatica Netflix scelto dalle Impostazioni. */
export const NETFLIX_INTERVAL_CONFIG_KEY = 'netflix_sync_interval_hours'
/** Intervalli offerti dalle Impostazioni (ore). */
export const NETFLIX_INTERVAL_CHOICES = [6, 12, 24]
const DEFAULT_NETFLIX_INTERVAL_HOURS = 12
/** Intervallo della sync automatica Stremio (ore): giornaliera. */
export const STREMIO_SYNC_INTERVAL_HOURS = 24

/** Ore valide come intervallo: numero finito e positivo (come SYNC_INTERVAL_HOURS da sempre). */
function positiveHours(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** SYNC_INTERVAL_HOURS dell'env, se valido. */
export function envNetflixSyncIntervalHours(env: NodeJS.ProcessEnv = process.env): number | null {
  return positiveHours(env.SYNC_INTERVAL_HOURS)
}

/** Intervalli selezionabili: 6/12/24 più il valore dell'env se diverso (ordinati). */
export function netflixSyncIntervalChoices(env: NodeJS.ProcessEnv = process.env): number[] {
  const envHours = envNetflixSyncIntervalHours(env)
  const choices = new Set(NETFLIX_INTERVAL_CHOICES)
  if (envHours !== null) choices.add(envHours)
  return [...choices].sort((a, b) => a - b)
}

/** Valore accettato da POST /api/config: solo uno degli intervalli selezionabili. */
export function isValidNetflixSyncInterval(value: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const n = positiveHours(value)
  return n !== null && netflixSyncIntervalChoices(env).includes(n)
}

/** Intervallo effettivo e da dove viene: DB (Impostazioni) → env SYNC_INTERVAL_HOURS → 12. */
export function getNetflixSyncInterval(): { hours: number; source: 'db' | 'env' | 'default' } {
  let stored: number | null = null
  try {
    const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(NETFLIX_INTERVAL_CONFIG_KEY) as { value: string } | undefined
    stored = positiveHours(row?.value)
  } catch {
    stored = null
  }
  if (stored !== null) return { hours: stored, source: 'db' }
  const envHours = envNetflixSyncIntervalHours()
  if (envHours !== null) return { hours: envHours, source: 'env' }
  return { hours: DEFAULT_NETFLIX_INTERVAL_HOURS, source: 'default' }
}

/**
 * Intervallo della sync automatica Netflix in ore: DB → env SYNC_INTERVAL_HOURS → 12.
 * Lo scheduler lo rilegge a ogni controllo: un cambio dalle Impostazioni vale senza riavvio.
 */
export function getNetflixSyncIntervalHours(): number {
  return getNetflixSyncInterval().hours
}

/** Prossima esecuzione prevista (ISO) da ultima esecuzione + intervallo; null se mai eseguita. */
export function nextScheduledRun(lastRunIso: string | null | undefined, intervalHours: number): string | null {
  if (!lastRunIso) return null
  const last = new Date(lastRunIso).getTime()
  if (!Number.isFinite(last)) return null
  return new Date(last + intervalHours * 60 * 60 * 1000).toISOString()
}
