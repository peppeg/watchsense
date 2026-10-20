import { getDb } from '../../utils/db'
import { moviesNoteParts, runIngest, type IngestRow } from '../../utils/ingest'
import { userError, userMessage } from '../../utils/user-message'
import { getExportsDir } from '../../utils/paths'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

interface TraktShow {
  ids: { tmdb?: number; imdb?: string; trakt?: number; slug?: string }
  title: string
  year?: number
  aired_episodes?: number
}

interface TraktHistoryEntry {
  id: number
  watched_at: string
  action: string
  type: 'episode' | 'movie'
  episode?: {
    ids: { tmdb?: number }
    title: string
    number: number
    season: number
  }
  show?: TraktShow
  movie?: TraktShow
}

export default defineEventHandler(async (event) => {
  const db = getDb()
  // La cartella è risolta solo lato server (nessun path dal client):
  // prima exports/trakt, poi altre sottocartelle trakt* in ordine alfabetico.
  const exportsDir = getExportsDir()
  const candidateDirs = [join(exportsDir, 'trakt')]
  if (existsSync(exportsDir)) {
    const others = readdirSync(exportsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('trakt') && d.name !== 'trakt')
      .map(d => d.name)
      .sort()
    candidateDirs.push(...others.map(name => join(exportsDir, name)))
  }
  const exportDir = candidateDirs.find(d => existsSync(d))

  if (!exportDir) {
    throw userError(400, userMessage('imports.trakt.noFolder', { dir: exportsDir }))
  }

  // Read Trakt export files (all watched-history-*.json chunks)
  const history: TraktHistoryEntry[] = []
  const historyFiles = readdirSync(exportDir)
    .filter(f => f.startsWith('watched-history-') && f.endsWith('.json'))
    .sort()

  if (historyFiles.length === 0) {
    const singlePath = join(exportDir, 'watched-history.json')
    if (existsSync(singlePath)) {
      history.push(...JSON.parse(readFileSync(singlePath, 'utf8')))
    } else {
      throw userError(400, userMessage('imports.trakt.noFiles', { dir: exportDir }))
    }
  } else {
    for (const file of historyFiles) {
      const p = join(exportDir, file)
      try {
        const entries = JSON.parse(readFileSync(p, 'utf8'))
        history.push(...entries)
      } catch {}
    }
  }

  // Serie già presenti (per la statistica newShowsFound)
  const knownShows = new Set((db.prepare(
    "SELECT DISTINCT tmdb_id FROM shows WHERE platform = 'trakt' AND media_type = 'tv' AND tmdb_id IS NOT NULL",
  ).all() as { tmdb_id: number }[]).map(r => r.tmdb_id))

  // Gli id Trakt sono già TMDB: /tv per gli episodi, /movie per i film (nessuna ricerca).
  // watched_at mancante resta '' come negli import precedenti (fa parte della chiave UNIQUE).
  const rows: IngestRow[] = []
  let skipped = 0
  const newTmdbIds = new Set<number>()
  for (const entry of history) {
    const watchedAt = entry.watched_at?.split('T')[0] || ''
    if (entry.type === 'episode' && entry.show && entry.episode) {
      const tmdbId = entry.show.ids.tmdb
      if (!tmdbId) { skipped++; continue }
      if (!knownShows.has(tmdbId)) newTmdbIds.add(tmdbId)
      rows.push({
        title: entry.show.title,
        platform: 'trakt',
        watchedAt,
        episodeTitle: `S${entry.episode.season}E${entry.episode.number} - ${entry.episode.title}`,
        mediaType: 'tv',
        tmdbId,
      })
    } else if (entry.type === 'movie' && entry.movie) {
      const tmdbId = entry.movie.ids.tmdb
      if (!tmdbId) { skipped++; continue }
      rows.push({ title: entry.movie.title, platform: 'trakt', watchedAt, episodeTitle: '(film)', mediaType: 'movie', tmdbId })
    }
  }

  // Inserimento in transazione, arricchimento dei titoli nuovi o rimasti senza metadati
  const result = await runIngest(rows)
  const inserted = result.inserted
  const enriched = result.enriched
  const enrichmentFailed = result.enrichFailed
  const enrichmentResults = result.enrichLog.map(e => e.name ? `✅ ${e.name} (${e.tmdbId})` : `❌ TMDB ${e.tmdbId}`)

  // Final stats
  const totalTrakt = db.prepare("SELECT COUNT(*) as c FROM shows WHERE platform = 'trakt' AND media_type = 'tv'").get() as any
  const uniqueTrakt = db.prepare("SELECT COUNT(*) as c FROM (SELECT DISTINCT tmdb_id, media_type FROM shows WHERE platform = 'trakt' AND media_type = 'tv' AND tmdb_id IS NOT NULL)").get() as any

  const episodesInserted = inserted - result.moviesInserted
  const msg = userMessage('imports.trakt.done', {
    entries: history.length,
    episodes: episodesInserted,
    newShows: newTmdbIds.size,
    archived: uniqueTrakt.c,
  }, moviesNoteParts(result))

  return {
    ok: true,
    ...msg,
    summary: {
      historyEntries: history.length,
      episodesProcessed: history.filter(h => h.type === 'episode').length,
      moviesProcessed: history.filter(h => h.type === 'movie').length,
      rowsInserted: inserted,
      // Film registrati (media_type 'movie') ma non mostrati: WatchSense è per le serie TV
      moviesInserted: result.moviesInserted,
      skipped,
      newShowsFound: newTmdbIds.size,
      enriched,
      enrichmentFailed,
    },
    totals: {
      traktRows: totalTrakt.c,
      uniqueTraktShows: uniqueTrakt.c,
    },
    enrichmentLog: enrichmentResults,
  }
})
