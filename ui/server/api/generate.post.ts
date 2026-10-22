import { getDb } from '../utils/db'
import { searchTmdbByTitle, type MediaType } from '../utils/sync-helpers'
import { chatCompletion, extractJsonArray, LlmError } from '../utils/llm'
import { errorDetail, userError, userMessage, UserMessageError } from '../utils/user-message'
import { anySeriesRows, profileSeriesRows, seriesRows } from '../utils/series-filter'
import { getLocaleConfig } from '../utils/locale'
import { localizeGenre, normalizeGenre, parseStoredGenres, storedGenres } from '../utils/genres'
import { buildRecommendationsPrompt } from '../utils/llm-prompts'

export default defineEventHandler(async (event) => {
  const db = getDb()
  const body = await readBody(event).catch(() => ({}))
  const genreFilter = typeof body.genre === 'string' ? body.genre.trim() : ''
  const { appLocale, tmdbRegion } = getLocaleConfig(db)

  // Solo serie (media_type 'tv') in tutto il prompt: i film registrati non si usano.
  // Gusti (serie in evidenza, 👍, 👎): profileSeriesRows, senza le serie ignorate o escluse dal
  // profilo; elenco delle già viste: seriesRows (le escluse dal profilo restano viste).
  // Get top shows for the prompt (weighted by feedback)
  const topShows = db.prepare(`
    SELECT s.title, s.tmdb_genres, s.tmdb_vote_avg, s.tmdb_keywords,
           COALESCE(sf.feedback, 0) as user_feedback
    FROM shows s
    LEFT JOIN show_feedback sf ON sf.tmdb_id = s.tmdb_id AND sf.media_type = s.media_type
    WHERE s.tmdb_id IS NOT NULL AND s.tmdb_genres IS NOT NULL AND ${profileSeriesRows('s')}
    GROUP BY s.tmdb_id, s.media_type
    ORDER BY
      CASE WHEN COALESCE(sf.feedback, 0) = 1 THEN 3
           WHEN COALESCE(sf.feedback, 0) = 0 THEN 2
           ELSE 1 END DESC,
      COUNT(*) DESC
    LIMIT 30
  `).all() as any[]

  // Build weighted genre profile
  const genreWeights: Record<string, number> = {}
  const likedShows: string[] = []
  const dislikedShows: string[] = []

  for (const s of topShows) {
    try {
      const genres = parseStoredGenres(s.tmdb_genres)
      const weight = s.user_feedback === 1 ? 3 : s.user_feedback === -1 ? -1 : 1
      for (const g of genres) {
        genreWeights[g] = (genreWeights[g] || 0) + weight
      }
      if (s.user_feedback === 1) likedShows.push(s.title)
      if (s.user_feedback === -1) dislikedShows.push(s.title)
    } catch {}
  }

  const topGenres = Object.entries(genreWeights)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g]) => g)

  const avoidGenres = Object.entries(genreWeights)
    .filter(([, w]) => w < 0)
    .map(([g]) => g)

  // Get already recommended titles to exclude
  const existingRecs = db.prepare(
    "SELECT title FROM recommendations WHERE dismissed = 0 AND already_watched = 0 AND bookmarked = 0 AND media_type = 'tv'"
  ).all() as any[]
  const existingTitles = existingRecs.map(r => r.title)

  // Get all watched show titles (including Italian tmdb_name)
  const watchedRows = db.prepare(
    `SELECT DISTINCT title, tmdb_name FROM shows WHERE ${seriesRows()}`
  ).all() as any[]
  const watched = watchedRows.flatMap(r => [r.title, r.tmdb_name].filter(Boolean))

  // 1. Get user's anchor shows (Thumbs Up 👍)
  const anchorShowsRows = db.prepare(`
    SELECT s.tmdb_name, s.title, s.tmdb_genres, s.tmdb_overview
    FROM show_feedback sf
    JOIN shows s ON s.tmdb_id = sf.tmdb_id AND s.media_type = sf.media_type
    WHERE sf.feedback = 1 AND ${profileSeriesRows('s')}
    GROUP BY sf.tmdb_id, sf.media_type
  `).all() as any[]

  // 2. Get user's rejected shows (Thumbs Down 👎 or dismissed from recommendations)
  const dislikedShowsRows = db.prepare(`
    SELECT DISTINCT COALESCE(s.tmdb_name, s.title) as name
    FROM show_feedback sf
    JOIN shows s ON s.tmdb_id = sf.tmdb_id AND s.media_type = sf.media_type
    WHERE sf.feedback = -1 AND ${profileSeriesRows('s')}
  `).all() as any[]
  const dismissedRows = db.prepare(`
    SELECT DISTINCT title FROM recommendations WHERE dismissed = 1 AND media_type = 'tv'
  `).all() as any[]
  const rejectedTitles = [
    ...dislikedShowsRows.map(r => r.name),
    ...dismissedRows.map(r => r.title),
  ].filter(Boolean)

  const showList = topShows.slice(0, 25).map(s => s.tmdb_name || s.title).join(', ')

  // Note personali dell'utente, se configurate
  const tasteNotesRow = db.prepare("SELECT value FROM config WHERE key = 'taste_custom_notes'").get() as { value: string } | undefined

  // Build prompt (lingua dell'app, mercato della regione TMDB)
  const prompt = buildRecommendationsPrompt({
    anchors: anchorShowsRows.map(s => ({
      name: s.tmdb_name || s.title,
      genres: storedGenres(s.tmdb_genres, appLocale).join(', '),
      overview: s.tmdb_overview,
    })),
    rejectedTitles,
    tasteNotes: tasteNotesRow?.value?.trim() || '',
    genre: genreFilter ? localizeGenre(genreFilter, appLocale) : '',
    excludeList: [...new Set([...watched, ...existingTitles])].slice(0, 250).join(', '),
  }, { appLocale, tmdbRegion })

  const tasteSnapshot = JSON.stringify({
    topGenres,
    avoidGenres,
    likedShows,
    dislikedShows,
    feedbackCount: likedShows.length + dislikedShows.length,
  })

  // Call LLM — config dal DB oppure fallback su variabili d'ambiente
  try {
    let content = ''
    try {
      ({ content } = await chatCompletion({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        maxTokens: 2000,
      }))
    } catch (e: any) {
      if (e instanceof LlmError && e.status !== 400) {
        throw new UserMessageError(userMessage('errors.llm.checkKey', { detail: errorDetail(e) }))
      }
      throw e
    }

    // Parse JSON from response
    const recs = extractJsonArray(content)
    if (!recs) {
      throw new UserMessageError(userMessage('errors.llm.invalidJson'))
    }

    // Enrich with TMDB ID and poster (async, outside the DB transaction)
    const rows: Array<[string, number | null, MediaType, string, string, number, string | null]> = []
    for (const rec of recs) {
      if (rec.title && rec.reason) {
        let tmdbId: number | null = null
        let mediaType: MediaType = 'tv' // il prompt chiede serie: ricerca serie-prima, poi il tipo abbinato
        let posterPath: string | null = null
        let finalTitle = rec.title

        try {
          const match = await searchTmdbByTitle(rec.title)
          if (match?.mediaType === 'movie') {
            // WatchSense consiglia solo serie: un abbinamento a un film non si salva
            console.log(`Discarded recommendation matched to a film: ${rec.title} (TMDB movie ${match.tmdbId})`)
            continue
          }
          if (match) {
            tmdbId = match.tmdbId
            mediaType = match.mediaType
            posterPath = match.posterPath || null
            if (match.name) finalTitle = match.name
          }
        } catch {}

        // Discard recommendations if ALREADY in watched shows (anche ignorate: già viste in casa)
        if (tmdbId) {
          const alreadyWatched = db.prepare(`
            SELECT 1 FROM shows
            WHERE ${anySeriesRows()} AND (
                  (tmdb_id IS NOT NULL AND tmdb_id = ? AND media_type = ?)
               OR LOWER(title) = LOWER(?)
               OR (tmdb_name IS NOT NULL AND LOWER(tmdb_name) = LOWER(?)))
            LIMIT 1
          `).get(tmdbId, mediaType, rec.title, finalTitle)

          if (alreadyWatched) {
            console.log(`Discarded recommendation already watched: ${rec.title} (TMDB: ${tmdbId})`)
            continue
          }
        }

        rows.push([finalTitle, tmdbId, mediaType, rec.reason, rec.where_to_watch || '', rec.score || 0.5, posterPath])
      }
    }

    // Nothing usable: don't leave an empty batch behind
    if (rows.length === 0) {
      return { ok: true, count: 0, batchId: null, genre: genreFilter || null }
    }

    // Batch + recommendations together: either both are stored or neither
    const insertBatch = db.prepare(`
      INSERT INTO recommendation_batches (created_at, genre_filter, taste_snapshot, prompt_snapshot)
      VALUES (datetime('now'), ?, ?, ?)
    `)
    const insertRec = db.prepare(`
      INSERT INTO recommendations (title, tmdb_id, media_type, reason, where_to_watch, score, poster_path, batch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const batchId = db.transaction(() => {
      // Genere e profilo con i nomi canonici: la cronologia li traduce in uscita
      const id = insertBatch.run(genreFilter ? normalizeGenre(genreFilter) : null, tasteSnapshot, prompt).lastInsertRowid
      for (const row of rows) insertRec.run(...row, id)
      return id
    })()

    return { ok: true, count: rows.length, batchId: Number(batchId), genre: genreFilter || null }
  } catch (e: any) {
    throw userError(500, userMessage('errors.llm.generateFailed', { detail: errorDetail(e) }))
  }
})
