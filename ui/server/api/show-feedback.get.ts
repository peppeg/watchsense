import { getDb } from '../utils/db'
import { requireMediaType } from '../utils/sync-helpers'

// GET: retrieve feedback for a show or all shows
// ?tmdb_id=…&media_type=tv|movie (default tv): lo stesso id indica una serie e un film diversi
export default defineEventHandler((event) => {
  const db = getDb()
  const query = getQuery(event)

  if (query.tmdb_id) {
    const mediaType = requireMediaType(query.media_type ?? query.type)
    const row = db.prepare('SELECT * FROM show_feedback WHERE tmdb_id = ? AND media_type = ?').get(query.tmdb_id, mediaType)
    return { feedback: row || { tmdb_id: Number(query.tmdb_id), media_type: mediaType, feedback: 0 } }
  }

  // Return all feedback as maps: feedbackMap (serie, compatibilità) e per tipo
  const rows = db.prepare('SELECT tmdb_id, media_type, feedback FROM show_feedback').all() as any[]
  const byType: Record<'tv' | 'movie', Record<number, number>> = { tv: {}, movie: {} }
  for (const r of rows) {
    if (r.media_type === 'movie') byType.movie[r.tmdb_id] = r.feedback
    else byType.tv[r.tmdb_id] = r.feedback
  }
  return { feedbackMap: byType.tv, feedbackByType: byType }
})
