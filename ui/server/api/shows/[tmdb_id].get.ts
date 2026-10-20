import { getDb } from '../../utils/db'
import { fetchShowDetails } from '../../utils/tmdb'
import { isAiringStatus, refreshAiringInfo, requireMediaType } from '../../utils/sync-helpers'
import { deriveWatchStatus, episodeWatchStatus, nextWatchStatus, parseWatchStatus } from '../../utils/watch-status'
import { exclusionState } from '../../utils/show-exclusions'
import { getLocaleConfig } from '../../utils/locale'
import { localizeGenres, storedGenres } from '../../utils/genres'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const { appLocale } = getLocaleConfig(db)
  const tmdbId = parseInt(event.context.params?.tmdb_id as string)

  if (!tmdbId) {
    throw createError({ statusCode: 400, message: 'Invalid tmdb_id' })
  }
  // ?type=tv|movie: lo stesso numero indica una serie e un film diversi (default tv)
  const mediaType = requireMediaType(getQuery(event).type)

  // 1. Try local database first
  const show = db.prepare(`
    SELECT 
      title, tmdb_id, media_type, tmdb_name, tmdb_genres, tmdb_overview, tmdb_keywords,
      tmdb_networks, tmdb_watch_providers, tmdb_vote_avg, tmdb_status,
      poster_path, backdrop_path,
      tmdb_number_of_episodes, tmdb_number_of_seasons, tmdb_first_air_date,
      MAX(tmdb_aired_episodes) as tmdb_aired_episodes,
      COUNT(DISTINCT COALESCE(episode_title, id)) as episode_count,
      GROUP_CONCAT(DISTINCT platform) as platforms,
      SUM(is_manual = 0) as imported_rows,
      MIN(watched_at) as first_watched,
      MAX(watched_at) as last_watched
    FROM shows
    WHERE tmdb_id = ? AND media_type = ?
    GROUP BY tmdb_id, media_type
  `).get(tmdbId, mediaType) as any

  // Check if show is bookmarked
  const b = db.prepare('SELECT bookmarked FROM recommendations WHERE tmdb_id = ? AND media_type = ? AND bookmarked = 1 LIMIT 1').get(tmdbId, mediaType) as any
  const isBookmarked = !!b

  // Check feedback
  const fb = db.prepare('SELECT feedback FROM show_feedback WHERE tmdb_id = ? AND media_type = ?').get(tmdbId, mediaType) as any
  const userFeedback = fb ? fb.feedback : 0

  // Check explicit user status override
  const userStatusRow = db.prepare('SELECT status FROM show_user_status WHERE tmdb_id = ? AND media_type = ?').get(tmdbId, mediaType) as any
  const explicitStatus = userStatusRow?.status

  if (show && show.title) {
    // Serie in onda: episodi usciti e totale aggiornati da TMDB (in cache; scritti anche
    // nel DB, così la Libreria usa gli stessi numeri). Senza TMDB restano quelli salvati.
    if (mediaType === 'tv' && isAiringStatus(show.tmdb_status)) {
      const fresh = await refreshAiringInfo(tmdbId)
      if (fresh) {
        show.tmdb_status = fresh.status || show.tmdb_status
        show.tmdb_number_of_episodes = fresh.numberOfEpisodes
        show.tmdb_number_of_seasons = fresh.numberOfSeasons
        show.tmdb_aired_episodes = fresh.airedEpisodes
      }
    }
    // Lo stato esplicito vince; altrimenti si deduce dagli episodi (utils/watch-status)
    const facts = {
      mediaType,
      episodeCount: show.episode_count,
      totalEpisodes: show.tmdb_number_of_episodes,
      airedEpisodes: show.tmdb_aired_episodes,
      platforms: show.platforms,
    }
    const watchStatus = deriveWatchStatus({ ...facts, explicit: explicitStatus })
    // Prossimo stato del pulsante, per un'etichetta che dica cosa fa il clic
    show.next_watch_status = nextWatchStatus(watchStatus, {
      mediaType,
      importedRows: show.imported_rows || 0,
      episodeStatus: episodeWatchStatus(facts),
    })

    // Parse JSON fields
    show.watch_status = watchStatus
    show.is_watched = watchStatus !== 'unwatched'
    show.is_bookmarked = isBookmarked
    show.user_feedback = userFeedback
    // Esclusioni dell'utente: la scheda resta raggiungibile anche per una serie ignorata (per ripristinarla)
    const exclusions = exclusionState(tmdbId, mediaType)
    show.is_ignored = exclusions.ignored
    show.profile_excluded = exclusions.profileExcluded
    show.genres = storedGenres(show.tmdb_genres, appLocale)
    show.networks = JSON.parse(show.tmdb_networks || '[]')
    show.providers = JSON.parse(show.tmdb_watch_providers || '[]')
    show.keywords = JSON.parse(show.tmdb_keywords || '[]')
    return { show }
  }

  // 2. Fallback: Fetch directly from TMDB API for trending or newly discovered shows
  const details = await fetchShowDetails(tmdbId, mediaType)
  if (!details) {
    throw createError({ statusCode: 404, message: 'Show not found' })
  }
  // Copia: l'oggetto è in cache (con i generi canonici) e non va modificato
  const tmdbShow = { ...details, genres: localizeGenres(details.genres, appLocale) }

  tmdbShow.watch_status = parseWatchStatus(explicitStatus) || 'unwatched'
  tmdbShow.next_watch_status = nextWatchStatus(tmdbShow.watch_status, { mediaType, importedRows: 0 })
  tmdbShow.is_watched = tmdbShow.watch_status !== 'unwatched'
  tmdbShow.is_bookmarked = isBookmarked
  tmdbShow.user_feedback = userFeedback
  tmdbShow.episode_count = 0
  return { show: tmdbShow }
})
