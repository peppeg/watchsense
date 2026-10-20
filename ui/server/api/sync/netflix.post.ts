import { getDb } from '../../utils/db'
import { setSyncStatus, type SyncFailureReason } from '../../utils/sync-helpers'
import { netflixAcceptLanguage, netflixCookieHeader, parseNetflixViewingActivity } from '../../utils/netflix'
import { getLocaleConfig } from '../../utils/locale'
import { getSecretConfig } from '../../utils/secrets'
import { cleanTitle, unnamedEpisodeTitle } from '../../utils/ingest-normalize'
import { moviesNoteParts, runIngest, type IngestRow } from '../../utils/ingest'
import { userError, userMessage, UserMessageError, type MessagePart } from '../../utils/user-message'

const NETFLIX_VIEWING_ACTIVITY_URL = 'https://www.netflix.com/viewingactivity'

/** Netflix rifiuta i cookie: 401/403, oppure redirect verso la pagina di login. */
function isNetflixAuthFailure(res: Response): boolean {
  if (res.status === 401 || res.status === 403) return true
  if (res.status >= 300 && res.status < 400) {
    return /\/login\b/i.test(res.headers.get('location') || '')
  }
  return false
}

export default defineEventHandler(async (event) => {
  const db = getDb()
  const body = await readBody(event).catch(() => ({}))

  let cookieString = body.cookies?.trim()
  if (!cookieString) {
    cookieString = getSecretConfig('netflix_cookies', db).value
  }

  if (!cookieString) {
    throw userError(400, userMessage('sync.netflix.noCookies'))
  }

  const cookieHeader = netflixCookieHeader(cookieString)

  // Interrogate Netflix official viewing activity page
  let viewedItems: any[] = []
  // Solo il rifiuto esplicito dei cookie (401/403 o redirect al login) è 'auth':
  // errori di rete, risposte inattese e pagine non interpretabili restano 'error'.
  let reason: SyncFailureReason = 'error'
  try {
    let res: Response
    try {
      res = await fetch(NETFLIX_VIEWING_ACTIVITY_URL, {
        headers: {
          'Cookie': cookieHeader,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          // Lingua della pagina dalla lingua TMDB (it-IT: intestazione storica)
          'Accept-Language': netflixAcceptLanguage(getLocaleConfig(db).tmdbLanguage),
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      })
    } catch (err: any) {
      throw new UserMessageError(userMessage('sync.netflix.unreachable', {
        cause: String(err?.cause?.code || err?.name || err?.message || 'errore di rete'),
      }))
    }

    if (isNetflixAuthFailure(res)) {
      reason = 'auth'
      throw new UserMessageError(userMessage('sync.netflix.cookiesExpired'))
    }

    if (!res.ok) {
      throw new UserMessageError(userMessage('sync.netflix.http', { status: res.status }))
    }

    const html = await res.text()
    viewedItems = parseNetflixViewingActivity(html)
  } catch (err: any) {
    // Dettaglio con codice (errori noti, anche del parser) o testo grezzo dell'eccezione
    const detail: MessagePart | string = err instanceof UserMessageError
      ? { code: err.userMessage.code, ...(err.userMessage.params ? { params: err.userMessage.params } : {}) }
      : String(err?.message)
    const msg = userMessage('sync.netflix.failed', { detail })
    setSyncStatus('netflix', false, msg, reason)
    throw userError(reason === 'auth' ? 401 : 502, msg, { reason })
  }

  const rows: IngestRow[] = viewedItems.map((item) => {
    const rawTitle = item.seriesTitle || item.title || ''
    // Episodio senza nome: identificativo stabile (titolo completo o movieID) invece di un
    // segnaposto fisso, così due episodi della stessa serie nello stesso giorno restano distinti
    const unnamed = !item.episodeTitle && item.seriesTitle
      ? unnamedEpisodeTitle({
        seriesTitle: item.seriesTitle,
        fullTitle: item.title,
        seasonDescriptor: item.seasonDescriptor,
        episodeId: item.movieID,
      })
      : null
    const episodeTitle = item.episodeTitle || unnamed?.episodeTitle || item.seasonDescriptor || '(film)'
    return {
      title: cleanTitle(rawTitle, 'netflix'),
      platform: 'netflix',
      watchedAt: item.date ? new Date(item.date).toISOString().split('T')[0]! : null,
      episodeTitle,
      legacyEpisodeTitles: unnamed?.legacy,
      // Senza seriesTitle è un film ('(film)'): registrato come 'movie', nessuna ricerca TMDB
      mediaType: episodeTitle === '(film)' ? 'movie' : 'tv',
    }
  })
  const result = await runIngest(rows)
  const episodesInserted = result.inserted - result.moviesInserted
  const moviesInserted = result.moviesInserted
  const enrichedCount = result.enriched

  const resultSummary = {
    service: 'netflix',
    syncedAt: new Date().toISOString(),
    viewedItemsRetrieved: viewedItems.length,
    episodesInserted,
    moviesInserted,
    showsEnriched: enrichedCount,
  }

  const setConfig = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
  setConfig.run('last_sync_timestamp', new Date().toISOString())
  setConfig.run('last_sync_result', JSON.stringify(resultSummary))

  const msg = userMessage('sync.netflix.done', { viewed: viewedItems.length, episodes: episodesInserted }, moviesNoteParts(result))
  setSyncStatus('netflix', true, msg)

  return {
    ok: true,
    ...resultSummary,
    ...msg,
  }
})
