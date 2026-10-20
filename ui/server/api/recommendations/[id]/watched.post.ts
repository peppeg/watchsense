import { getDb } from '../../../utils/db'
import { enrichShowRecord, searchTmdbByTitle, parseMediaType, type MediaType } from '../../../utils/sync-helpers'
import { platformFromProvider } from '../../../utils/ingest-normalize'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const id = parseInt(event.context.params.id)
  const body = await readBody(event).catch(() => ({}))

  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid id' })
  }

  const rec = db.prepare('SELECT * FROM recommendations WHERE id = ?').get(id) as any
  if (!rec) {
    throw createError({ statusCode: 404, message: 'Recommendation not found' })
  }

  // Toggle watched state
  const newVal = rec.already_watched ? 0 : 1
  db.prepare('UPDATE recommendations SET already_watched = ? WHERE id = ?').run(newVal, id)

  // Determine platform from recommendation where_to_watch tag
  const platform = platformFromProvider(rec.where_to_watch) || 'manual'

  let tmdbId = rec.tmdb_id
  // Tipo dell'id della raccomandazione (le raccomandazioni sono serie salvo diversa indicazione)
  let mediaType: MediaType = parseMediaType(rec.media_type) ?? 'tv'

  if (newVal === 0) {
    // "Non visto": si tolgono solo le righe aggiunte a mano, mai la cronologia importata
    if (tmdbId) {
      db.prepare('DELETE FROM shows WHERE tmdb_id = ? AND media_type = ? AND is_manual = 1').run(tmdbId, mediaType)
    } else {
      db.prepare('DELETE FROM shows WHERE tmdb_id IS NULL AND media_type = ? AND LOWER(title) = LOWER(?) AND is_manual = 1')
        .run(mediaType, rec.title)
    }
  }

  // If marking as watched, also add to shows table and enrich
  if (newVal === 1) {
    if (!tmdbId) {
      const match = await searchTmdbByTitle(rec.title, mediaType)
      if (match) {
        tmdbId = match.tmdbId
        mediaType = match.mediaType
        db.prepare('UPDATE recommendations SET tmdb_id = ?, media_type = ?, poster_path = ? WHERE id = ?')
          .run(tmdbId, mediaType, match.posterPath || null, id)
      }
    }

    const existing = db.prepare(
      'SELECT id FROM shows WHERE media_type = ? AND ((tmdb_id IS NOT NULL AND tmdb_id = ?) OR LOWER(title) = LOWER(?))'
    ).get(mediaType, tmdbId || -1, rec.title)

    if (!existing) {
      db.prepare(
        "INSERT INTO shows (title, platform, watched_at, tmdb_id, media_type, is_manual) VALUES (?, ?, datetime('now'), ?, ?, 1)"
      ).run(rec.title, platform, tmdbId || null, mediaType)

      if (tmdbId) {
        await enrichShowRecord(tmdbId, mediaType, platform)
      }
    }

    // If feedback provided, save it to show_feedback
    if (body.feedback && [-1, 1].includes(body.feedback) && tmdbId) {
      db.prepare(`
        INSERT INTO show_feedback (tmdb_id, media_type, feedback, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(tmdb_id, media_type) DO UPDATE SET feedback = ?, updated_at = datetime('now')
      `).run(tmdbId, mediaType, body.feedback, body.feedback)
    }
  }

  if (tmdbId) {
    // Uno stato esplicito già salvato dal dettaglio serie segue il nuovo valore
    db.prepare("UPDATE show_user_status SET status = ?, updated_at = datetime('now') WHERE tmdb_id = ? AND media_type = ?")
      .run(newVal ? 'completed' : 'unwatched', tmdbId, mediaType)
  }

  return { ok: true, already_watched: !!newVal }
})
