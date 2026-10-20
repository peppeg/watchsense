/**
 * Consigli "sartoriali" generati con l'LLM per una serie/film a cui l'utente ha dato 👍,
 * salvati in show_ai_similar per (tmdb_id, media_type).
 *
 * Lettura (GET /api/shows/[id]/similar) e generazione (POST .../similar/generate) sono
 * separate: la generazione costa una chiamata LLM e scrive sul DB, quindi non avviene
 * mai su una GET.
 */
import { getDb } from './db'
import { fetchShowDetails } from './tmdb'
import { searchTmdbByTitle, type MediaType } from './sync-helpers'
import { chatCompletion, extractJsonArray } from './llm'
import { getLocaleConfig } from './locale'
import { storedGenres } from './genres'
import { buildAiSimilarPrompt } from './llm-prompts'
import { exclusionState } from './show-exclusions'

/** True se l'utente ha dato 👍 al titolo e il titolo conta per i suoi gusti (non ignorato né
 *  escluso dal profilo): solo allora si propongono i consigli AI. */
export function isLikedShow(tmdbId: number, mediaType: MediaType): boolean {
  const row = getDb().prepare('SELECT feedback FROM show_feedback WHERE tmdb_id = ? AND media_type = ?')
    .get(tmdbId, mediaType) as { feedback: number } | undefined
  if (row?.feedback !== 1) return false
  const { ignored, profileExcluded } = exclusionState(tmdbId, mediaType)
  return !ignored && !profileExcluded
}

/** Consigli AI in cache, null se assenti o vuoti. */
export function readCachedAiSimilar(tmdbId: number, mediaType: MediaType): any[] | null {
  const cached = getDb().prepare('SELECT recommendations FROM show_ai_similar WHERE tmdb_id = ? AND media_type = ?')
    .get(tmdbId, mediaType) as { recommendations: string } | undefined
  if (!cached?.recommendations) return null
  try {
    const parsed = JSON.parse(cached.recommendations)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

/**
 * Genera i consigli con l'LLM, li abbina su TMDB e li salva in cache.
 * Restituisce null se non ci sono dati sul titolo o l'LLM non dà risultati utilizzabili;
 * gli errori di configurazione/provider LLM si propagano al chiamante.
 */
export async function generateAiSimilar(tmdbId: number, mediaType: MediaType): Promise<any[] | null> {
  const db = getDb()
  const isMovie = mediaType === 'movie'

  let show = db.prepare(`
    SELECT tmdb_name, title, tmdb_genres, tmdb_overview, tmdb_keywords
    FROM shows WHERE tmdb_id = ? AND media_type = ? LIMIT 1
  `).get(tmdbId, mediaType) as any

  if (!show || !show.tmdb_overview) {
    const tmdbShow = await fetchShowDetails(tmdbId, mediaType)
    if (tmdbShow) {
      show = {
        tmdb_name: tmdbShow.tmdb_name || tmdbShow.title,
        title: tmdbShow.title,
        tmdb_genres: JSON.stringify(tmdbShow.genres || []),
        tmdb_overview: tmdbShow.tmdb_overview || '',
        tmdb_keywords: JSON.stringify(tmdbShow.keywords || []),
      }
    }
  }
  if (!show) return null

  const showName = show.tmdb_name || show.title
  const { appLocale, tmdbRegion } = getLocaleConfig(db)
  // Generi nella lingua dell'app, come il resto del prompt
  const genresList = storedGenres(show.tmdb_genres, appLocale).join(', ')

  const prompt = buildAiSimilarPrompt(
    { showName, genresList, overview: show.tmdb_overview || '', isMovie },
    { appLocale, tmdbRegion },
  )

  const { content } = await chatCompletion({
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    maxTokens: 1200,
  })

  const rawRecs = extractJsonArray(content)
  if (!rawRecs) return null

  const enrichedRecs = []
  for (const r of rawRecs) {
    if (!r?.title) continue
    const match = await searchTmdbByTitle(r.title, mediaType)
    // Per una serie si propongono solo serie (un abbinamento a un film si scarta)
    if (match && (isMovie || match.mediaType === 'tv')) {
      enrichedRecs.push({
        tmdb_id: match.tmdbId,
        media_type: match.mediaType,
        tmdb_name: match.name || r.title,
        title: match.name || r.title,
        poster_path: match.posterPath || null,
        why: r.why || '',
        where_to_watch: r.where_to_watch || '',
      })
    }
  }
  if (enrichedRecs.length === 0) return null

  // Chiave: il titolo della scheda (tmdb_id, media_type)
  db.prepare("INSERT OR REPLACE INTO show_ai_similar (tmdb_id, media_type, recommendations, created_at) VALUES (?, ?, ?, datetime('now'))")
    .run(tmdbId, mediaType, JSON.stringify(enrichedRecs))
  return enrichedRecs
}
