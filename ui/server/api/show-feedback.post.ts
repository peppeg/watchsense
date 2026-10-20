import { getDb } from '../utils/db'
import { requireMediaType } from '../utils/sync-helpers'

// POST: set feedback for a show
export default defineEventHandler(async (event) => {
  const db = getDb()
  const body = await readBody(event)

  if (!body.tmdb_id || ![-1, 0, 1].includes(body.feedback)) {
    throw createError({ statusCode: 400, message: 'Invalid: need tmdb_id and feedback (-1, 0, 1)' })
  }

  // Tipo dell'id ('tv' salvo diversa indicazione del client)
  const mediaType = requireMediaType(body.media_type)

  // Upsert: insert or update
  db.prepare(`
    INSERT INTO show_feedback (tmdb_id, media_type, feedback, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(tmdb_id, media_type) DO UPDATE SET feedback = ?, updated_at = datetime('now')
  `).run(body.tmdb_id, mediaType, body.feedback, body.feedback)

  return { ok: true, tmdb_id: body.tmdb_id, media_type: mediaType, feedback: body.feedback }
})
