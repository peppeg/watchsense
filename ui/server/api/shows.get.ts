import { getDb } from '../utils/db'
import { seriesRows } from '../utils/series-filter'
import { deriveWatchStatus, watchProgress } from '../utils/watch-status'
import { getLocaleConfig } from '../utils/locale'
import { localizeGenre, normalizeGenre, parseStoredGenres, storedGenres } from '../utils/genres'

export default defineEventHandler((event) => {
  const db = getDb()
  const query = getQuery(event)
  const { appLocale } = getLocaleConfig(db)

  const platform = query.platform as string || ''
  const genre = query.genre as string || ''
  const search = query.search as string || ''
  const page = parseInt(query.page as string) || 1
  const limit = Math.min(parseInt(query.limit as string) || 50, 200)
  const offset = (page - 1) * limit

  // Solo serie: i film sono registrati ma non mostrati (WatchSense è per le serie TV)
  let where = `WHERE s.tmdb_id IS NOT NULL AND ${seriesRows('s')}`
  const params: any[] = []

  if (platform && platform !== 'all') {
    where += ' AND s.platform = ?'
    params.push(platform)
  }

  if (genre && genre !== 'all') {
    // Il filtro arriva col nome mostrato (availableGenres): nel DB c'è quello canonico
    where += ' AND s.tmdb_genres LIKE ?'
    params.push(`%${JSON.stringify(normalizeGenre(genre))}%`)
  }

  if (search) {
    // Escape LIKE wildcards so `%`, `_` and `\` in the query match literally
    const escaped = search.replace(/[\\%_]/g, c => `\\${c}`)
    where += " AND (s.title LIKE ? ESCAPE '\\' OR s.tmdb_name LIKE ? ESCAPE '\\')"
    params.push(`%${escaped}%`, `%${escaped}%`)
  }

  // Count the same (tmdb_id, media_type) groups the list query returns,
  // so total/totalPages match the paginated results.
  const countRow = db.prepare(`
    SELECT COUNT(*) as c FROM (
      SELECT 1 FROM shows s ${where} GROUP BY s.tmdb_id, s.media_type
    )
  `).get(...params) as any

  const shows = db.prepare(`
    SELECT
      s.title,
      s.tmdb_id,
      s.media_type,
      s.tmdb_name,
      s.tmdb_genres,
      s.tmdb_overview,
      s.tmdb_networks,
      s.tmdb_watch_providers,
      s.tmdb_vote_avg,
      s.tmdb_status,
      s.poster_path,
      s.backdrop_path,
      s.tmdb_number_of_episodes,
      s.tmdb_number_of_seasons,
      s.tmdb_aired_episodes,
      s.tmdb_first_air_date,
      COUNT(DISTINCT COALESCE(s.episode_title, s.id)) as episode_count,
      GROUP_CONCAT(DISTINCT s.platform) as platforms,
      MAX(s.watched_at) as last_watched,
      COALESCE(sf.feedback, 0) as user_feedback,
      us.status as user_status
    FROM shows s
    LEFT JOIN show_feedback sf ON sf.tmdb_id = s.tmdb_id AND sf.media_type = s.media_type
    LEFT JOIN show_user_status us ON us.tmdb_id = s.tmdb_id AND us.media_type = s.media_type
    ${where}
    GROUP BY s.tmdb_id, s.media_type
    ORDER BY episode_count DESC, last_watched DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as any[]

  // Get available genres for filter
  const allGenres = db.prepare(`
    SELECT DISTINCT tmdb_genres FROM shows WHERE tmdb_genres IS NOT NULL AND ${seriesRows()}
  `).all() as any[]
  const genreSet = new Set<string>()
  for (const row of allGenres) {
    for (const g of parseStoredGenres(row.tmdb_genres)) genreSet.add(localizeGenre(g, appLocale))
  }
  const availableGenres = Array.from(genreSet).sort()

  const parsed = shows.map(s => {
    // Stato esplicito (show_user_status) se c'è, altrimenti dedotto dagli episodi: una serie
    // segnata come completata è al 100% anche se ne è registrato un solo episodio
    const watchStatus = deriveWatchStatus({
      explicit: s.user_status,
      mediaType: s.media_type,
      episodeCount: s.episode_count,
      totalEpisodes: s.tmdb_number_of_episodes,
      airedEpisodes: s.tmdb_aired_episodes,
      platforms: s.platforms,
    })
    return {
      ...s,
      watch_status: watchStatus,
      progress: watchProgress(watchStatus, s.episode_count, s.tmdb_number_of_episodes),
      genres: storedGenres(s.tmdb_genres, appLocale),
      networks: JSON.parse(s.tmdb_networks || '[]'),
      providers: JSON.parse(s.tmdb_watch_providers || '[]'),
    }
  })

  return {
    shows: parsed,
    total: countRow.c,
    page,
    limit,
    totalPages: Math.ceil(countRow.c / limit),
    availableGenres,
  }
})
