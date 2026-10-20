/**
 * Lettura della libreria Stremio (datastore `libraryItem`) in episodi visti.
 *
 * `state.watched` è il WatchedBitField di stremio-core, serializzato come
 * "<id del video àncora>:<lunghezza>:<base64 zlib>": un bit per video, nell'ordine della
 * lista episodi della serie (stagione, episodio; gli speciali, stagione 0, in testa), NON
 * una stagione sola. Per leggerlo serve quella lista (Cinemeta): come fa Stremio, l'àncora
 * riallinea i bit se nel frattempo la lista è cambiata (es. speciali aggiunti dopo).
 * Senza lista (Cinemeta irraggiungibile, id Kitsu) si tiene solo ciò che è certo:
 * l'àncora, se il suo bit è acceso.
 *
 * Episodio in corso (`state.video_id`): conta se guardato almeno 1 minuto
 * (`timeOffset` è in millisecondi), così i clic di pochi secondi non diventano visioni.
 */
import zlib from 'node:zlib'
import type Database from 'better-sqlite3'
import { mapWithConcurrency } from './ingest'
import { userMessage, UserMessageError, type UserMessage } from './user-message'

/** Minimo guardato perché l'episodio in corso conti (ms). */
export const STREMIO_MIN_PROGRESS_MS = 60_000

const CINEMETA_URL = 'https://v3-cinemeta.strem.io/meta/series'
const CINEMETA_CONCURRENCY = 5

export interface StremioLibraryItem {
  _id: string
  name: string
  type: string
  removed?: boolean
  temp?: boolean
  _ctime?: string
  _mtime?: string
  state?: {
    lastWatched?: string
    timeOffset?: number
    duration?: number
    video_id?: string
    watched?: string
    timesWatched?: number
    flaggedWatched?: number
  }
}

export interface StremioEpisode {
  episodeTitle: string
  watchedAt: string | null
}

export interface StremioExtraction {
  episodes: StremioEpisode[]
  /** true = elenco completo e affidabile (bitfield letto con la lista Cinemeta). */
  exact: boolean
}

/** Bitfield di `state.watched`: id dell'àncora, lunghezza e indici dei bit accesi. null se illeggibile. */
export function decodeStremioBitfield(watched: string | undefined | null):
  { anchorId: string; anchorLength: number; bits: Set<number> } | null {
  if (!watched || typeof watched !== 'string') return null
  const parts = watched.split(':')
  if (parts.length < 3) return null
  const anchorLength = Number(parts[parts.length - 2])
  if (!Number.isInteger(anchorLength) || anchorLength < 0) return null
  try {
    const buf = zlib.inflateSync(Buffer.from(parts[parts.length - 1]!, 'base64'))
    const bits = new Set<number>()
    for (let i = 0; i < buf.length; i++) {
      for (let bit = 0; bit < 8; bit++) {
        if (buf[i]! & (1 << bit)) bits.add(i * 8 + bit)
      }
    }
    return { anchorId: parts.slice(0, -2).join(':'), anchorLength, bits }
  } catch {
    return null
  }
}

/**
 * Id dei video visti secondo il bitfield, data la lista attuale degli episodi.
 * null se l'àncora non è nella lista (lista diversa da quella di Stremio: non si indovina).
 */
export function watchedVideoIds(watched: string | undefined | null, videoIds: string[]): string[] | null {
  const field = decodeStremioBitfield(watched)
  if (!field) return null
  const anchorIdx = videoIds.indexOf(field.anchorId)
  if (anchorIdx < 0) return null
  // Come stremio-core (WatchedBitField::construct_and_resize): il bit dell'àncora era
  // anchorLength - 1, ora è anchorIdx
  const offset = field.anchorLength - anchorIdx - 1
  return videoIds.filter((_, i) => {
    const prev = i + offset
    return prev >= 0 && prev < field.anchorLength && field.bits.has(prev)
  })
}

/** "tt123:2:5" → "S2E5"; "kitsu:456:7" → "S1E7" (Kitsu numera per serie). null se non è un episodio. */
export function stremioEpisodeTitle(videoId: string | undefined | null): string | null {
  if (!videoId) return null
  const parts = videoId.split(':')
  if (parts[0] === 'kitsu' && parts.length === 3) {
    const ep = Number(parts[2])
    return Number.isInteger(ep) && ep >= 0 ? `S1E${ep}` : null
  }
  if (parts.length < 3) return null
  const season = Number(parts[parts.length - 2])
  const ep = Number(parts[parts.length - 1])
  return Number.isInteger(season) && season >= 0 && Number.isInteger(ep) && ep >= 0 ? `S${season}E${ep}` : null
}

/** Episodio in corso guardato abbastanza da contare. */
function inProgressVideoId(item: StremioLibraryItem): string | null {
  const state = item.state || {}
  return state.video_id && (state.timeOffset || 0) >= STREMIO_MIN_PROGRESS_MS ? state.video_id : null
}

/** Il titolo ha uno storico di visione (anche se tolto dalla libreria o mai aggiunto). */
export function hasStremioWatchHistory(item: StremioLibraryItem): boolean {
  const state = item.state
  if (!state) return false
  const field = decodeStremioBitfield(state.watched)
  return Boolean(
    (field && field.bits.size > 0) ||
    (state.timesWatched && state.timesWatched > 0) ||
    state.flaggedWatched ||
    (state.timeOffset && state.timeOffset >= STREMIO_MIN_PROGRESS_MS),
  )
}

/**
 * Episodi visti di un elemento della libreria. `videoIds` = lista episodi Cinemeta della
 * serie (ordinata), se disponibile. Date: l'ultimo episodio (o quello in corso) prende
 * `lastWatched`, gli altri la data in cui il titolo è entrato in Stremio (`_ctime`).
 */
export function extractStremioWatchedEpisodes(item: StremioLibraryItem, videoIds?: string[] | null): StremioExtraction {
  const state = item.state || {}
  const lastWatchedDate = state.lastWatched ? state.lastWatched.split('T')[0]! : null
  const firstWatchedDate = item._ctime ? item._ctime.split('T')[0]! : lastWatchedDate

  if (item.type === 'movie') {
    return { episodes: [{ episodeTitle: '(film)', watchedAt: lastWatchedDate }], exact: true }
  }

  const inProgress = inProgressVideoId(item)
  let watched: string[] | null = videoIds?.length ? watchedVideoIds(state.watched, videoIds) : null
  // Nessun episodio finito (nessun bitfield): l'elenco è completo anche senza lista episodi
  const exact = watched !== null || !state.watched
  if (!watched) {
    // Senza lista episodi: solo l'àncora, se segnata come vista
    const field = decodeStremioBitfield(state.watched)
    watched = field && field.anchorLength > 0 && field.bits.has(field.anchorLength - 1) ? [field.anchorId] : []
  }

  const last = inProgress && !watched.includes(inProgress) ? inProgress : watched[watched.length - 1]
  const ids = inProgress && !watched.includes(inProgress) ? [...watched, inProgress] : watched
  const episodes: StremioEpisode[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    const episodeTitle = stremioEpisodeTitle(id)
    if (!episodeTitle || seen.has(episodeTitle)) continue
    seen.add(episodeTitle)
    episodes.push({ episodeTitle, watchedAt: id === last ? lastWatchedDate : firstWatchedDate })
  }
  return { episodes, exact }
}

/** Lista episodi Cinemeta di una serie (id IMDb), ordinata come in Stremio. null se non disponibile. */
export async function fetchCinemetaVideoIds(imdbId: string): Promise<string[] | null> {
  if (!/^tt\d+$/.test(imdbId)) return null
  try {
    const res = await fetch(`${CINEMETA_URL}/${imdbId}.json`)
    if (!res.ok) return null
    const json: any = await res.json()
    const videos: any[] = Array.isArray(json?.meta?.videos) ? json.meta.videos : []
    const ids = videos
      .filter(v => typeof v?.id === 'string')
      .map(v => ({ id: v.id as string, season: Number(v.season) || 0, episode: Number(v.episode ?? v.number) || 0 }))
      .sort((a, b) => a.season - b.season || a.episode - b.episode)
      .map(v => v.id)
    return ids.length ? ids : null
  } catch {
    return null
  }
}

/** Liste episodi Cinemeta per gli id IMDb dati (concorrenza limitata). */
export async function fetchCinemetaVideoLists(imdbIds: string[]): Promise<Map<string, string[]>> {
  const unique = Array.from(new Set(imdbIds))
  const lists = await mapWithConcurrency(unique, CINEMETA_CONCURRENCY, fetchCinemetaVideoIds)
  const map = new Map<string, string[]>()
  unique.forEach((id, i) => {
    const list = lists[i]
    if (list) map.set(id, list)
  })
  return map
}

export interface StremioReconcileResult {
  /** Righe con un episodio che Stremio non riporta (numerazione sbagliata delle versioni precedenti). */
  removedWrong: number
  /** Stesso episodio registrato più volte con date diverse: resta la data più vecchia. */
  removedDuplicates: number
  /** Righe di elementi che non sono serie né film (canali TV, eventi). */
  removedNonSeries: number
}

/**
 * Riallinea le righe Stremio già salvate allo stato attuale di Stremio, prima dell'import:
 * - per i titoli letti in modo completo (`exactEpisodes`: titolo → episodi visti), si tolgono
 *   gli episodi che Stremio non riporta e i doppioni dello stesso episodio;
 * - si tolgono le righe dei titoli che non sono serie né film (`nonSeriesTitles`).
 * Mai le righe aggiunte a mano (is_manual), mai i film, mai i titoli letti in modo parziale.
 * Idempotente.
 */
export function reconcileStremioRows(
  db: Database.Database,
  exactEpisodes: Map<string, Set<string>>,
  nonSeriesTitles: string[],
): StremioReconcileResult {
  const result: StremioReconcileResult = { removedWrong: 0, removedDuplicates: 0, removedNonSeries: 0 }
  const removeWrong = db.prepare(`
    DELETE FROM shows
    WHERE platform = 'stremio' AND title = ? AND media_type = 'tv' AND is_manual = 0
      AND (episode_title IS NULL OR episode_title NOT IN (SELECT value FROM json_each(?)))
  `)
  const removeDuplicates = db.prepare(`
    DELETE FROM shows
    WHERE platform = 'stremio' AND title = ? AND media_type = 'tv' AND is_manual = 0
      AND id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY episode_title ORDER BY watched_at IS NULL, watched_at, id
          ) AS n
          FROM shows
          WHERE platform = 'stremio' AND title = ? AND media_type = 'tv' AND is_manual = 0
        ) WHERE n = 1
      )
  `)
  const removeTitle = db.prepare(`
    DELETE FROM shows WHERE platform = 'stremio' AND title = ? AND is_manual = 0
  `)
  db.transaction(() => {
    for (const [title, episodes] of exactEpisodes) {
      if (episodes.size === 0) continue
      result.removedWrong += removeWrong.run(title, JSON.stringify(Array.from(episodes))).changes
      result.removedDuplicates += removeDuplicates.run(title, title).changes
    }
    for (const title of nonSeriesTitles) result.removedNonSeries += removeTitle.run(title).changes
  })()
  return result
}

/** Login dell'account Stremio (API ufficiale di stremio-core: `POST /api/login`). */
export const STREMIO_LOGIN_URL = 'https://api.strem.io/api/login'

/** Login fallito: stato HTTP per l'endpoint e messaggio per l'utente (mai la password). */
export class StremioLoginError extends UserMessageError {
  constructor(public statusCode: number, msg: UserMessage) {
    super(msg)
  }
}

/**
 * Accede a Stremio con email e password e restituisce la authKey della sessione.
 * Risposta dell'API: `{ result: { authKey, user } }` se va bene, `{ error: { message, code } }`
 * (anche con HTTP 200) se le credenziali sono sbagliate. La password serve solo per questa
 * richiesta: non si salva, non si registra e non compare nei messaggi d'errore.
 */
export async function stremioLogin(email: string, password: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(STREMIO_LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'Login', email, password, facebook: false }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err: any) {
    throw new StremioLoginError(502, userMessage('sync.stremio.loginUnreachable', {
      detail: String(err?.cause?.code || err?.name || 'network error'),
    }))
  }
  const data: any = await res.json().catch(() => null)
  if (data?.error) {
    const detail = typeof data.error === 'object' ? data.error.message : data.error
    throw new StremioLoginError(401, userMessage('sync.stremio.loginRejected', {
      detail: typeof detail === 'string' && detail ? detail : `HTTP ${res.status}`,
    }))
  }
  if (!res.ok) {
    throw new StremioLoginError(502, userMessage('sync.stremio.loginHttp', { status: res.status }))
  }
  const authKey = data?.result?.authKey
  if (typeof authKey !== 'string' || !authKey.trim()) {
    throw new StremioLoginError(502, userMessage('sync.stremio.loginUnexpected'))
  }
  return authKey.trim()
}
