import { getDb } from '../../utils/db'
import { requireMediaType } from '../../utils/sync-helpers'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const body = await readBody(event)

  const tmdbId = body?.tmdb_id ? parseInt(body.tmdb_id) : null
  const title = body?.title || ''
  const posterPath = body?.poster_path || null
  const reason = body?.reason || body?.overview || 'Salvata dalla scheda serie'
  const whereToWatch = body?.where_to_watch || body?.platforms || ''
  // Tipo della scheda da cui si salva (default tv; valore non valido → 400)
  const mediaType = requireMediaType(body?.media_type)

  if (!tmdbId && !title) {
    throw createError({ statusCode: 400, message: 'tmdb_id or title required' })
  }

  // Check if recommendation/bookmark record exists
  let existing: any = null
  if (tmdbId) {
    existing = db.prepare('SELECT id, bookmarked FROM recommendations WHERE tmdb_id = ? AND media_type = ? LIMIT 1').get(tmdbId, mediaType)
  }
  if (!existing && title) {
    // Fallback per titolo nello stesso tipo: un film omonimo non è la stessa scheda
    existing = db.prepare('SELECT id, bookmarked FROM recommendations WHERE title = ? AND media_type = ? LIMIT 1').get(title, mediaType)
  }

  if (existing) {
    const newVal = existing.bookmarked ? 0 : 1
    db.prepare('UPDATE recommendations SET bookmarked = ? WHERE id = ?').run(newVal, existing.id)
    return { ok: true, bookmarked: !!newVal }
  } else {
    // Insert new bookmark entry
    db.prepare(`
      INSERT INTO recommendations (title, tmdb_id, media_type, reason, where_to_watch, poster_path, bookmarked, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
    `).run(title, tmdbId, mediaType, reason, whereToWatch, posterPath)
    return { ok: true, bookmarked: true }
  }
})
