import { getDb } from '../../utils/db'
import { getSecretConfig } from '../../utils/secrets'
import { setSyncStatus } from '../../utils/sync-helpers'
import { moviesNoteParts, runIngest, type IngestResult, type IngestRow } from '../../utils/ingest'
import { userError, userMessage, type UserMessage } from '../../utils/user-message'
import {
  extractStremioWatchedEpisodes,
  fetchCinemetaVideoLists,
  hasStremioWatchHistory,
  reconcileStremioRows,
  type StremioLibraryItem,
  type StremioReconcileResult,
} from '../../utils/stremio'

/** Salva l'esito fallito (lo vedono sia la sync manuale sia lo scheduler) e interrompe. */
function fail(statusCode: number, message: UserMessage): never {
  setSyncStatus('stremio', false, message)
  throw userError(statusCode, message)
}

export default defineEventHandler(async (event) => {
  const db = getDb()
  const body = await readBody(event).catch(() => ({}))

  // Retrieve authKey from request or DB
  let authKey = body.authKey?.trim()
  if (!authKey) {
    authKey = getSecretConfig('stremio_auth_key', db).value
  }

  if (!authKey) {
    throw userError(400, userMessage('sync.stremio.noAuthKey'))
  }

  // Request library datastore from Stremio
  let libraryItems: StremioLibraryItem[] = []
  try {
    const res = await fetch('https://api.strem.io/api/datastoreGet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        authKey,
        collection: 'libraryItem',
        all: true,
      }),
    })

    if (!res.ok) {
      throw new Error(`Stremio API returned HTTP ${res.status}`)
    }

    const data: any = await res.json()
    if (data.error) {
      const errMsg = typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : data.error
      throw new Error(`Stremio error: ${errMsg}`)
    }

    libraryItems = data.result || []
  } catch (err: any) {
    fail(502, userMessage('sync.stremio.unreachable', { detail: String(err.message) }))
  }

  // Titoli con uno storico di visione, anche se tolti dalla libreria o mai aggiunti
  // (removed/temp: Stremio li tiene per "Continua a guardare"). Solo serie e film:
  // canali TV ed eventi non sono visioni di una serie.
  const isTitle = (item: StremioLibraryItem) => item.type === 'series' || item.type === 'movie'
  const watchedItems = libraryItems.filter(item => isTitle(item) && hasStremioWatchHistory(item))
  const titleNames = new Set(libraryItems.filter(isTitle).map(item => item.name))
  const nonSeriesTitles = Array.from(new Set(libraryItems
    .filter(item => !isTitle(item) && item.name && !titleNames.has(item.name))
    .map(item => item.name)))

  // Lista episodi Cinemeta per leggere il bitfield (un bit per episodio di tutte le stagioni)
  const videoLists = await fetchCinemetaVideoLists(watchedItems
    .filter(item => item.type === 'series' && item._id?.startsWith('tt') && item.state?.watched)
    .map(item => item._id))

  // Stremio dichiara il tipo ('movie' | 'series'): i film si cercano prima tra i film.
  // Abbinamento: id IMDb (/find), poi titolo; una sola ricerca per titolo anche con più episodi.
  const rows: IngestRow[] = []
  // Titolo → episodi visti, per riallineare le righe salvate. Un titolo si riallinea solo
  // se tutti i suoi elementi (stesso nome, es. id IMDb + id Kitsu) sono stati letti per intero.
  const episodesByTitle = new Map<string, Set<string>>()
  const partialTitles = new Set<string>()
  for (const item of watchedItems) {
    const title = item.name || 'Senza Titolo'
    const { episodes, exact } = extractStremioWatchedEpisodes(item, videoLists.get(item._id))
    if (item.type === 'series') {
      const set = episodesByTitle.get(title) || new Set<string>()
      for (const ep of episodes) set.add(ep.episodeTitle)
      episodesByTitle.set(title, set)
      if (!exact) partialTitles.add(title)
    }
    for (const ep of episodes) {
      rows.push({
        title,
        platform: 'stremio',
        watchedAt: ep.watchedAt || null,
        episodeTitle: ep.episodeTitle || null,
        mediaType: item.type === 'movie' ? 'movie' : 'tv',
        imdbId: item._id && item._id.startsWith('tt') ? item._id : null,
      })
    }
  }
  for (const title of partialTitles) episodesByTitle.delete(title)

  let reconcile: StremioReconcileResult
  let result: IngestResult
  try {
    reconcile = reconcileStremioRows(db, episodesByTitle, nonSeriesTitles)
    result = await runIngest(rows)
  } catch (err: any) {
    fail(500, userMessage('sync.stremio.failed', { detail: String(err.message) }))
  }
  const episodesInserted = result.inserted - result.moviesInserted
  const moviesInserted = result.moviesInserted
  const enrichedCount = result.enriched
  const rowsRemoved = reconcile.removedWrong + reconcile.removedDuplicates + reconcile.removedNonSeries

  const resultSummary = {
    service: 'stremio',
    syncedAt: new Date().toISOString(),
    libraryItemsTotal: libraryItems.length,
    watchedItemsFound: watchedItems.length,
    episodeListsFound: videoLists.size,
    episodesInserted,
    moviesInserted,
    rowsRemoved,
    ...reconcile,
    showsEnriched: enrichedCount,
  }

  // Save sync state
  const setConfig = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
  setConfig.run('last_sync_timestamp', new Date().toISOString())
  setConfig.run('last_sync_result', JSON.stringify(resultSummary))

  const msg = userMessage('sync.stremio.done', { titles: watchedItems.length, episodes: episodesInserted }, [
    rowsRemoved > 0 ? { code: 'sync.note.rowsRemoved', params: { count: rowsRemoved } } : null,
    ...moviesNoteParts(result),
  ])
  setSyncStatus('stremio', true, msg)

  return {
    ok: true,
    ...resultSummary,
    ...msg,
  }
})
