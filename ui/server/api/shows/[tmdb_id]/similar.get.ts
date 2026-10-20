import { getDb } from '../../../utils/db'
import { fetchSimilarShows } from '../../../utils/tmdb'
import { requireMediaType } from '../../../utils/sync-helpers'
import { isLikedShow, readCachedAiSimilar } from '../../../utils/ai-similar'
import { seriesRows } from '../../../utils/series-filter'
import { getLocaleConfig } from '../../../utils/locale'
import { localizeGenres, parseStoredGenres } from '../../../utils/genres'

// Sola lettura: cache dei consigli AI, simili TMDB, sovrapposizione di generi nel DB locale.
// Nessuna chiamata LLM e nessuna scrittura (la generazione è in similar/generate.post.ts).

export default defineEventHandler(async (event) => {
  const db = getDb()
  const tmdbId = parseInt(event.context.params?.tmdb_id as string)

  if (!tmdbId) {
    throw createError({ statusCode: 400, message: 'Invalid tmdb_id' })
  }
  // ?type=tv|movie (default tv): feedback, cache e dati locali sono per (tmdb_id, media_type)
  const mediaType = requireMediaType(getQuery(event).type)

  // 1. Titolo con 👍: consigli AI dalla cache. Qui non si generano (chiamata LLM + scrittura
  //    sul DB): se mancano, `canGenerateAi` dice al client di chiederli con
  //    POST /api/shows/[tmdb_id]/similar/generate.
  const isLiked = isLikedShow(tmdbId, mediaType)
  if (isLiked) {
    const cached = readCachedAiSimilar(tmdbId, mediaType)
    if (cached) return { similar: cached, isAiTailored: true, canGenerateAi: false }
  }
  const canGenerateAi = isLiked

  // 2. Baseline: Try TMDB API first for standard similar shows (zero token cost)
  const tmdbSimilar = await fetchSimilarShows(tmdbId, mediaType)
  if (tmdbSimilar && tmdbSimilar.length > 0) {
    return { similar: tmdbSimilar, isAiTailored: false, canGenerateAi }
  }

  // 3. Fallback: local DB genre overlap (solo serie: i film registrati non si propongono)
  const show = db.prepare(`
    SELECT tmdb_genres, tmdb_vote_avg FROM shows WHERE tmdb_id = ? AND media_type = ? LIMIT 1
  `).get(tmdbId, mediaType) as any

  if (!show) {
    return { similar: [], isAiTailored: false, canGenerateAi }
  }

  const genres = parseStoredGenres(show.tmdb_genres)
  const { appLocale } = getLocaleConfig(db)

  const allShows = db.prepare(`
    SELECT DISTINCT tmdb_id, media_type, tmdb_name, tmdb_genres, tmdb_vote_avg, poster_path, tmdb_overview
    FROM shows
    WHERE tmdb_id IS NOT NULL AND ${seriesRows()} AND NOT (tmdb_id = ? AND media_type = ?) AND poster_path IS NOT NULL AND poster_path != ''
    GROUP BY tmdb_id, media_type
  `).all(tmdbId, mediaType) as any[]

  const scored = allShows
    .map((s: any) => {
      const sGenres = parseStoredGenres(s.tmdb_genres)
      const overlap = genres.filter(g => sGenres.includes(g)).length
      return { ...s, genres: localizeGenres(sGenres, appLocale), similarity: overlap }
    })
    .filter((s: any) => s.similarity > 0)
    .sort((a: any, b: any) => b.similarity - a.similarity || b.tmdb_vote_avg - a.tmdb_vote_avg)
    .slice(0, 12)

  return { similar: scored, isAiTailored: false, canGenerateAi }
})
