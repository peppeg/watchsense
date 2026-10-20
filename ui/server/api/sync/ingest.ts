import { getDb } from '../../utils/db'
import { parseMediaType, setSyncStatus, type MediaType } from '../../utils/sync-helpers'
import { isValidIngestToken } from '../../utils/ingest-token'
import { cleanTitle, unnamedEpisodeTitle } from '../../utils/ingest-normalize'
import { moviesNoteParts, runIngest } from '../../utils/ingest'
import { getLocaleConfig, LOCALE_DEFAULTS, type AppLocale } from '../../utils/locale'
import { userError, userMessage, userMessageIn, type MessageParam } from '../../utils/user-message'
import { translate } from '../../../app/locales/i18n'

// Origini consentite per il bookmarklet (eco dell'Origin, mai '*')
const ALLOWED_ORIGIN_RE = /^https:\/\/(?:(?:www\.)?netflix\.com|(?:www\.)?primevideo\.com|www\.amazon\.(?:it|com|de|fr|es|co\.uk))$/
const MAX_BODY_BYTES = 5 * 1024 * 1024
const MAX_ITEMS = 5000
const MAX_STRING_LENGTH = 300
const PLATFORMS = new Set(['netflix', 'prime'])

/** Lingua dell'app; se il DB non risponde, quella predefinita (serve anche alla pagina d'errore). */
function appLocale(): AppLocale {
  try {
    return getLocaleConfig().appLocale
  } catch {
    return LOCALE_DEFAULTS.appLocale
  }
}

/** Errore con codice e testo nella lingua dell'app: il bookmarklet mostra `message` così com'è. */
function ingestError(locale: AppLocale, statusCode: number, code: string, params?: Record<string, MessageParam>) {
  return userError(statusCode, userMessageIn(locale, code, params))
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** Pagina d'errore minimale per il fallback form POST (scheda aperta dal bookmarklet). */
function errorPage(locale: AppLocale, statusCode: number, message: string): string {
  const t = (key: 'lang' | 'title' | 'heading' | 'openApp') => escapeHtml(translate(locale, `sync.bookmarklet.errorPage.${key}`, { status: statusCode }))
  return `<!doctype html><html lang="${t('lang')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t('title')}</title>`
    + `<style>body{font-family:system-ui,sans-serif;background:#18181b;color:#e4e4e7;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5}h1{font-size:1.25rem;color:#f87171}a{color:#22d3ee}</style></head>`
    + `<body><h1>${t('heading')}</h1><p>${escapeHtml(message)}</p><p><a href="/">${t('openApp')}</a></p></body></html>`
}

/** Data YYYY-MM-DD valida, altrimenti null. */
function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? value : null
}

interface IngestItem {
  title: string
  platform: string
  episodeTitle: string
  watchedAt: string
  tmdbId: number | null
  /** Tipo noto dal bookmarklet ('(film)' = film), altrimenti 'tv' (ricerca serie-prima). */
  mediaType: MediaType
  /** Vecchi segnaposto dello stesso episodio senza nome (vedi unnamedEpisodeTitle). */
  legacyEpisodeTitles?: string[]
}

/** Stringa opzionale entro MAX_STRING_LENGTH; undefined se assente, false se non valida. */
function optionalString(value: unknown): string | undefined | false {
  if (value == null || value === '') return undefined
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  if (typeof value !== 'string' || value.length > MAX_STRING_LENGTH) return false
  return value.trim() || undefined
}

/** Normalizza un elemento del bookmarklet; null se non valido. */
function normalizeItem(item: any, defaultPlatform: string): IngestItem | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null

  const rawTitle = item.title || item.titleName
  if (typeof rawTitle !== 'string' || rawTitle.length > MAX_STRING_LENGTH) return null
  // Titolo della serie vuoto dopo la pulizia: elemento valido, runIngest lo ignora e lo conta
  const title = cleanTitle(rawTitle, 'bookmarklet')

  const rawEpisode = item.episodeTitle ?? item.episode_title
  if (rawEpisode != null && (typeof rawEpisode !== 'string' || rawEpisode.length > MAX_STRING_LENGTH)) return null
  // Episodio senza nome: il bookmarklet manda i dati reali disponibili (titolo completo,
  // seasonDescriptor, id dell'episodio) e qui si sceglie un episode_title stabile e distinto
  const fullTitle = optionalString(item.fullTitle)
  const seasonDescriptor = optionalString(item.seasonDescriptor)
  const episodeId = optionalString(item.episodeId)
  if (fullTitle === false || seasonDescriptor === false || episodeId === false) return null
  let episodeTitle = (rawEpisode as string | undefined)?.trim() || ''
  let legacyEpisodeTitles: string[] | undefined
  if (!episodeTitle) {
    const unnamed = unnamedEpisodeTitle({ seriesTitle: rawTitle, fullTitle, seasonDescriptor, episodeId })
    episodeTitle = unnamed.episodeTitle
    legacyEpisodeTitles = unnamed.legacy
  }

  let platform = defaultPlatform
  if (item.platform != null && item.platform !== '') {
    if (typeof item.platform !== 'string') return null
    platform = item.platform.toLowerCase()
    if (!PLATFORMS.has(platform)) return null
  }

  // Data malformata = data mancante -> fallback alla data odierna (comportamento esistente)
  const watchedAt = validDate(item.watchedAt ?? item.watched_at ?? item.date) || new Date().toISOString().split('T')[0]!

  const rawTmdb = Number(item.tmdbId ?? item.tmdb_id)
  const tmdbId = Number.isSafeInteger(rawTmdb) && rawTmdb > 0 ? rawTmdb : null

  // Un tmdbId esplicito vale solo con il suo tipo; senza tipo si deduce dal marcatore '(film)'
  const mediaType = parseMediaType(item.mediaType ?? item.media_type)
    ?? (episodeTitle === '(film)' ? 'movie' : 'tv')

  return { title, platform, episodeTitle, watchedAt, tmdbId, mediaType, legacyEpisodeTitles }
}

export default defineEventHandler(async (event) => {
  const res = event.node.res
  const locale = appLocale()
  const origin = getRequestHeader(event, 'origin')
  const allowedOrigin = origin && ALLOWED_ORIGIN_RE.test(origin) ? origin : null

  // CORS & Private Network Access solo per le origini del bookmarklet
  res.setHeader('Vary', 'Origin')
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With')
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
  }

  // Il file non ha suffisso .post: gestisce anche la preflight OPTIONS (altrimenti finirebbe nel renderer Nuxt)
  const method = (event.method || event.node.req.method || 'GET').toUpperCase()
  if (method !== 'POST' && method !== 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS')
    throw ingestError(locale, 405, 'sync.bookmarklet.methodNotAllowed')
  }

  if (method === 'OPTIONS') {
    if (!allowedOrigin) {
      throw ingestError(locale, 403, 'sync.bookmarklet.originNotAllowed')
    }
    res.statusCode = 204
    return ''
  }

  // Form fallback (scheda aperta dal bookmarklet): risposte HTML leggibili
  const wantsHtml = (getRequestHeader(event, 'accept') || '').includes('text/html')
  try {
    return await ingest(event, locale, allowedOrigin, wantsHtml)
  } catch (err: any) {
    if (!wantsHtml) throw err
    const statusCode = Number(err?.statusCode) || 500
    const message = statusCode < 500 && err?.message ? String(err.message) : userMessageIn(locale, 'sync.bookmarklet.internalError').message
    setResponseStatus(event, statusCode)
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
    return errorPage(locale, statusCode, message)
  }
})

async function ingest(event: any, locale: AppLocale, allowedOrigin: string | null, wantsHtml: boolean) {
  const contentLength = Number(getRequestHeader(event, 'content-length') || 0)
  if (contentLength > MAX_BODY_BYTES) {
    throw ingestError(locale, 413, 'sync.bookmarklet.payloadTooLarge')
  }

  const db = getDb()
  const body = await readBody(event).catch(() => ({}))

  // Autorizzazione: token per-istanza (JSON {items, token} o campo form 'token').
  // L'Origin non è affidabile: da pagine HTTPS verso un'istanza HTTP il form invia 'Origin: null'.
  const token = body && !Array.isArray(body) ? body.token : undefined
  if (!isValidIngestToken(token)) {
    throw ingestError(locale, 403, 'sync.bookmarklet.invalidToken')
  }

  // Formati: JSON {items, token} (fetch) oppure form con 'payload' (array JSON) + 'token'
  let rawItems: unknown = null
  if (Array.isArray(body.items)) {
    rawItems = body.items
  } else if (body && typeof body.payload === 'string') {
    try {
      rawItems = JSON.parse(body.payload)
    } catch {}
  }

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw ingestError(locale, 400, 'sync.bookmarklet.noItems')
  }
  if (rawItems.length > MAX_ITEMS) {
    throw ingestError(locale, 400, 'sync.bookmarklet.tooManyItems', { max: MAX_ITEMS })
  }

  const defaultPlatform = allowedOrigin?.includes('netflix') ? 'netflix' : 'prime'
  const items: IngestItem[] = []
  for (const raw of rawItems) {
    const item = normalizeItem(raw, defaultPlatform)
    if (item) items.push(item)
  }
  const itemsRejected = rawItems.length - items.length

  if (items.length === 0) {
    throw ingestError(locale, 400, 'sync.bookmarklet.noValidItems', { rejected: itemsRejected })
  }

  // Inserimento in transazione (le visioni Prime/Netflix già arrivate da altre fonti si scartano),
  // poi ricerca TMDB solo per le righe nuove senza tmdbId (i film ('(film)') non si cercano)
  const result = await runIngest(items.map(item => ({
    title: item.title,
    platform: item.platform,
    watchedAt: item.watchedAt,
    episodeTitle: item.episodeTitle,
    mediaType: item.mediaType,
    tmdbId: item.tmdbId,
    legacyEpisodeTitles: item.legacyEpisodeTitles,
  })))
  const episodesInserted = result.inserted - result.moviesInserted
  const moviesInserted = result.moviesInserted
  const episodesSkipped = result.deduped + result.emptyTitle
  const enrichedCount = result.enriched

  const resultSummary = {
    service: 'bookmarklet',
    syncedAt: new Date().toISOString(),
    itemsReceived: rawItems.length,
    itemsRejected,
    episodesInserted,
    moviesInserted,
    episodesSkipped,
    showsEnriched: enrichedCount,
  }

  const setConfig = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
  setConfig.run('last_sync_timestamp', new Date().toISOString())
  setConfig.run('last_sync_result', JSON.stringify(resultSummary))
  // Esito per la pagina Fonti di visione (ultimo invio del bookmarklet)
  setSyncStatus('bookmarklet', true, userMessage('sync.bookmarklet.done', { received: rawItems.length, episodes: episodesInserted }, moviesNoteParts(result)))

  // If request came from a form POST redirect to app, otherwise return JSON
  if (wantsHtml) {
    return sendRedirect(event, '/?sync=success&count=' + episodesInserted)
  }

  const done = userMessageIn(locale, 'sync.bookmarklet.done', { received: rawItems.length, episodes: episodesInserted }, moviesNoteParts(result))
  return {
    ok: true,
    ...resultSummary,
    ...done,
  }
}
