import { getDb } from '../../../utils/db'
import { enrichShowRecord, requireMediaType } from '../../../utils/sync-helpers'
import { fetchShowDetails } from '../../../utils/tmdb'
import { platformFromProvider } from '../../../utils/ingest-normalize'
import { deriveWatchStatus, episodeWatchStatus, nextWatchStatus, parseWatchStatus } from '../../../utils/watch-status'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const tmdbId = parseInt(event.context.params?.tmdb_id as string)
  const body = (await readBody(event).catch(() => null)) || {}

  if (!tmdbId) {
    throw createError({ statusCode: 400, message: 'Invalid tmdb_id' })
  }
  // Tipo dell'id: ?type= (come GET /api/shows/[tmdb_id]) o media_type nel body; default tv
  const mediaType = requireMediaType(getQuery(event).type ?? body?.media_type)
  const isMovie = mediaType === 'movie'

  // Current status from show_user_status or derived from shows
  const userStatusRow = db.prepare('SELECT status FROM show_user_status WHERE tmdb_id = ? AND media_type = ?').get(tmdbId, mediaType) as any
  const showRow = db.prepare(`
    SELECT title, tmdb_name, platform, COUNT(DISTINCT COALESCE(episode_title, id)) as ep_count, tmdb_number_of_episodes,
           MAX(tmdb_aired_episodes) as tmdb_aired_episodes, SUM(is_manual = 0) as imported_rows
    FROM shows WHERE tmdb_id = ? AND media_type = ? GROUP BY tmdb_id, media_type
  `).get(tmdbId, mediaType) as any

  // Stato attuale: esplicito (show_user_status) o dedotto dagli episodi (utils/watch-status)
  const facts = {
    mediaType,
    episodeCount: showRow?.ep_count || 0,
    totalEpisodes: showRow?.tmdb_number_of_episodes,
    airedEpisodes: showRow?.tmdb_aired_episodes,
    platforms: showRow?.platform,
  }
  const currentStatus = deriveWatchStatus({ ...facts, explicit: userStatusRow?.status })
  const episodeStatus = episodeWatchStatus(facts)
  const importedRows = showRow?.imported_rows || 0

  // Stato richiesto (body.status) o il successivo del ciclo:
  // in_progress -> completed -> unwatched -> in_progress (o completed: film, serie in pari)
  let nextStatus = parseWatchStatus(body.status)
  if (body.status !== undefined && !nextStatus) {
    throw createError({ statusCode: 400, message: "Stato non valido: atteso 'unwatched', 'in_progress' o 'completed'" })
  }
  nextStatus ??= nextWatchStatus(currentStatus, { mediaType, importedRows, episodeStatus })

  if (importedRows > 0 && nextStatus === episodeStatus) {
    // Lo stato scelto coincide con quello degli episodi importati: nessuno stato esplicito,
    // così i prossimi import continuano a guidarlo
    db.prepare('DELETE FROM show_user_status WHERE tmdb_id = ? AND media_type = ?').run(tmdbId, mediaType)
  } else {
    db.prepare(`
      INSERT INTO show_user_status (tmdb_id, media_type, status, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(tmdb_id, media_type) DO UPDATE SET status = ?, updated_at = datetime('now')
    `).run(tmdbId, mediaType, nextStatus, nextStatus)
  }

  // Sync with shows table and recommendations
  if (nextStatus === 'unwatched') {
    // Solo le righe aggiunte a mano: la cronologia importata non si tocca
    // (lo stato esplicito 'unwatched' in show_user_status prevale su quella)
    db.prepare('DELETE FROM shows WHERE tmdb_id = ? AND media_type = ? AND is_manual = 1').run(tmdbId, mediaType)
    db.prepare('UPDATE recommendations SET already_watched = 0 WHERE tmdb_id = ? AND media_type = ?').run(tmdbId, mediaType)
  } else {
    // in_progress or completed: ensure show is present in shows table
    if (!showRow) {
      const tmdbShow = await fetchShowDetails(tmdbId, mediaType)
      const title = tmdbShow?.tmdb_name || tmdbShow?.title || body.title || (isMovie ? 'Film' : 'Serie TV')
      // Piattaforma dal primo provider IT, altrimenti 'manual'
      const platform = platformFromProvider(tmdbShow?.providers?.[0]) || 'manual'

      db.prepare(
        "INSERT INTO shows (title, platform, watched_at, tmdb_id, media_type, is_manual) VALUES (?, ?, datetime('now'), ?, ?, 1)"
      ).run(title, platform, tmdbId, mediaType)

      await enrichShowRecord(tmdbId, mediaType, platform)
    }

    if (nextStatus === 'completed') {
      db.prepare('UPDATE recommendations SET already_watched = 1 WHERE tmdb_id = ? AND media_type = ?').run(tmdbId, mediaType)
    }
  }

  return { ok: true, status: nextStatus, is_watched: nextStatus !== 'unwatched' }
})
