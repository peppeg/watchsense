import { getDb } from '../../utils/db'
import { getLocaleConfig } from '../../utils/locale'
import { localizeGenre, localizeGenres } from '../../utils/genres'

// GET: recommendation batch history with details
export default defineEventHandler(() => {
  const db = getDb()
  const { appLocale } = getLocaleConfig(db)

  const batches = db.prepare(`
    SELECT
      rb.id,
      rb.created_at,
      rb.genre_filter,
      rb.taste_snapshot,
      COUNT(r.id) as total_recs,
      SUM(CASE WHEN r.feedback = 1 THEN 1 ELSE 0 END) as liked,
      SUM(CASE WHEN r.feedback = -1 THEN 1 ELSE 0 END) as disliked,
      SUM(CASE WHEN r.bookmarked = 1 THEN 1 ELSE 0 END) as bookmarked,
      SUM(CASE WHEN r.already_watched = 1 THEN 1 ELSE 0 END) as watched,
      SUM(CASE WHEN r.dismissed = 1 THEN 1 ELSE 0 END) as dismissed
    FROM recommendation_batches rb
    LEFT JOIN recommendations r ON r.batch_id = rb.id AND r.media_type = 'tv'
    GROUP BY rb.id
    ORDER BY rb.created_at DESC
  `).all() as any[]

  // Get recommendations for each batch
  const recsStmt = db.prepare(`
    SELECT id, title, tmdb_id, media_type, reason, where_to_watch, score, feedback, bookmarked, already_watched, dismissed, poster_path
    FROM recommendations WHERE batch_id = ? AND media_type = 'tv'
    ORDER BY score DESC
  `)

  // Generi nella lingua dell'app (i batch vecchi li hanno salvati in italiano, i nuovi in inglese)
  const parsed = batches.map(b => {
    const taste = b.taste_snapshot ? JSON.parse(b.taste_snapshot) : null
    if (taste) {
      if (Array.isArray(taste.topGenres)) taste.topGenres = localizeGenres(taste.topGenres, appLocale)
      if (Array.isArray(taste.avoidGenres)) taste.avoidGenres = localizeGenres(taste.avoidGenres, appLocale)
    }
    return {
      ...b,
      genre_filter: b.genre_filter ? localizeGenre(b.genre_filter, appLocale) : b.genre_filter,
      taste,
      recommendations: recsStmt.all(b.id),
    }
  })

  return { batches: parsed }
})
