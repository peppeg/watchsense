import { getDb } from '../utils/db'
import { CHART_SIZE, fetchStreamingCharts, fetchTrendingShows, fetchNetworkCharts } from '../utils/tmdb'
import { chartSources, dedupeChartRows, getHiddenHomeSections, homeSectionsForRegion, type ChartSource } from '../utils/home-layout'
import { seriesRows } from '../utils/series-filter'
import { getLocaleConfig } from '../utils/locale'
import { localizeGenre, parseStoredGenres, storedGenres } from '../utils/genres'

export default defineEventHandler(async () => {
  const db = getDb()
  const { appLocale, tmdbRegion } = getLocaleConfig(db)

  // Solo serie (seriesRows): i film e le righe senza titolo della serie sono esclusi da ogni statistica
  const total = db.prepare(`SELECT COUNT(*) as c FROM shows WHERE ${seriesRows()}`).get() as any
  const unique = db.prepare(`SELECT COUNT(DISTINCT title) as c FROM shows WHERE ${seriesRows()}`).get() as any
  const enriched = db.prepare(`SELECT COUNT(DISTINCT title) as c FROM shows WHERE tmdb_id IS NOT NULL AND ${seriesRows()}`).get() as any

  const platforms = db.prepare(`
    SELECT platform, COUNT(*) as episodes, COUNT(DISTINCT title) as shows
    FROM shows WHERE ${seriesRows()} GROUP BY platform ORDER BY episodes DESC
  `).all() as any[]

  const topGenres = db.prepare(`
    SELECT tmdb_genres FROM shows WHERE tmdb_genres IS NOT NULL AND ${seriesRows()}
  `).all() as any[]

  // Conteggi sui nomi canonici (inglesi), tradotti solo in uscita
  const genreCounts: Record<string, number> = {}
  for (const row of topGenres) {
    for (const g of parseStoredGenres(row.tmdb_genres)) {
      genreCounts[g] = (genreCounts[g] || 0) + 1
    }
  }

  const genres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => ({ name: localizeGenre(name, appLocale), count }))

  // Sezioni della Home: le classifiche nascoste dalle Impostazioni o non disponibili nella
  // regione TMDB (utils/home-layout.ts) non si scaricano
  const hidden = getHiddenHomeSections()
  const sections = homeSectionsForRegion(tmdbRegion).filter(s => !hidden.has(s.key))
  const home = sections.map(s => s.key)
  const visible = (key: string) => home.includes(key)

  // Classifiche live della regione (TMDB Trending & Discover), nell'ordine della Home
  const sources = chartSources(tmdbRegion)
  const load = (src: ChartSource) =>
    src.kind === 'trending' ? fetchTrendingShows()
      : src.kind === 'network' ? fetchNetworkCharts(src.networkIds, src.platform)
        : fetchStreamingCharts(src.providerId, src.platform)
  const charts: Array<[string, any[]]> = []
  for (const s of sections) {
    const src = sources.get(s.key)
    if (s.chart && src) charts.push([s.key, await load(src)])
  }
  // Ogni serie in una sola fila: le piattaforme con cataloghi simili non ripetono gli stessi titoli
  const topByPlatform: Record<string, any[]> = dedupeChartRows(charts, CHART_SIZE)

  // Le serie più viste nella cronologia Trakt dell'utente
  if (visible('trakt')) {
    topByPlatform['trakt'] = db.prepare(`
      SELECT title, tmdb_id, media_type, tmdb_name, tmdb_vote_avg, poster_path, backdrop_path, tmdb_overview, tmdb_genres,
             COUNT(*) as episode_count, MAX(watched_at) as last_watched
      FROM shows
      WHERE platform = 'trakt' AND tmdb_id IS NOT NULL AND ${seriesRows()}
      GROUP BY tmdb_id, media_type
      ORDER BY episode_count DESC, tmdb_vote_avg DESC
      LIMIT 12
    `).all().map((s: any) => ({
      ...s,
      genres: storedGenres(s.tmdb_genres, appLocale),
      platforms: 'trakt',
    }))
  }

  // Consigli attivi più recenti, senza le serie che nel frattempo risultano già viste
  const recommendations = visible('recommendations')
    ? db.prepare(`
        SELECT r.id, r.title, r.title AS tmdb_name, r.tmdb_id, r.media_type, r.poster_path, r.score
        FROM recommendations r
        WHERE r.media_type = 'tv' AND r.bookmarked = 0 AND r.already_watched = 0 AND r.dismissed = 0
          AND (r.tmdb_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM shows s WHERE s.tmdb_id = r.tmdb_id AND s.media_type = 'tv'
          ))
        ORDER BY r.created_at DESC, r.score DESC
        LIMIT 12
      `).all()
    : []

  // All-time top shows in user's library (for Hero fallback or stats)
  const topShows = db.prepare(`
    SELECT title, tmdb_id, media_type, tmdb_name, tmdb_vote_avg, poster_path, backdrop_path, tmdb_overview, tmdb_genres,
           COUNT(*) as episode_count, GROUP_CONCAT(DISTINCT platform) as platforms,
           MAX(watched_at) as last_watched
    FROM shows
    WHERE tmdb_id IS NOT NULL AND ${seriesRows()}
    GROUP BY tmdb_id, media_type
    ORDER BY episode_count DESC
    LIMIT 12
  `).all().map((s: any) => ({
    ...s,
    genres: storedGenres(s.tmdb_genres, appLocale),
  }))

  return {
    totalEpisodes: total.c,
    uniqueShows: unique.c,
    enrichedShows: enriched.c,
    platforms,
    genres,
    topByPlatform,
    topShows,
    recommendations,
    /** Sezioni visibili della Home, in ordine. */
    home,
  }
})
