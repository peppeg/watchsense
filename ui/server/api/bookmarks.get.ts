import { getDb } from '../utils/db'
import { seriesRows } from '../utils/series-filter'
import { getLocaleConfig } from '../utils/locale'
import { storedGenres } from '../utils/genres'

export default defineEventHandler(() => {
  const db = getDb()
  const { appLocale } = getLocaleConfig(db)

  const bookmarks = db.prepare(`
    SELECT 
      r.id, 
      r.title, 
      COALESCE(r.tmdb_id, s.tmdb_id) as tmdb_id,
      CASE WHEN r.tmdb_id IS NOT NULL THEN r.media_type ELSE COALESCE(s.media_type, r.media_type) END as media_type,
      COALESCE(r.reason, s.tmdb_overview, 'Aggiunta ai salvati') as reason, 
      COALESCE(r.where_to_watch, s.platform) as where_to_watch, 
      r.score, 
      1 as bookmarked,
      r.already_watched,
      r.dismissed,
      COALESCE(r.poster_path, s.poster_path) as poster_path, 
      s.tmdb_genres,
      r.created_at 
    FROM recommendations r
    LEFT JOIN shows s ON ${seriesRows('s')}
      AND ((r.tmdb_id IS NOT NULL AND s.tmdb_id = r.tmdb_id AND s.media_type = r.media_type) OR s.title = r.title)
    -- Solo serie: i film non compaiono tra i salvati
    WHERE r.bookmarked = 1 AND r.media_type = 'tv'
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `).all() as any[]

  const parsed = bookmarks.map(r => ({
    ...r,
    genres: storedGenres(r.tmdb_genres, appLocale),
  }))

  return { bookmarks: parsed }
})
