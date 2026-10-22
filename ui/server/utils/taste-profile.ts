import type Database from 'better-sqlite3'
import { profileSeriesRows } from './series-filter'
import { parseStoredGenres } from './genres'

// Profilo dei gusti calcolato da visioni + 👍/👎 (serie che alimentano il profilo:
// profileSeriesRows, senza ignorate ed escluse). Generi con i nomi canonici (inglesi):
// chi lo mostra li traduce (taste-profile.get.ts), l'export li lascia così.

export interface TasteGenre { name: string, weight: number, liked: number, disliked: number, neutral: number }

export interface TasteProfile {
  topGenres: TasteGenre[]
  avoidGenres: TasteGenre[]
  topKeywords: { name: string, weight: number }[]
  likedShows: string[]
  dislikedShows: string[]
  neutralShows: string[]
  totalShows: number
  feedbackCount: number
}

export function computeTasteProfile(db: Database.Database): TasteProfile {
  const shows = db.prepare(`
    SELECT s.tmdb_id, s.title, s.tmdb_genres, s.tmdb_keywords, s.tmdb_vote_avg,
           COUNT(*) as episode_count,
           COALESCE(sf.feedback, 0) as user_feedback
    FROM shows s
    LEFT JOIN show_feedback sf ON sf.tmdb_id = s.tmdb_id AND sf.media_type = s.media_type
    WHERE s.tmdb_id IS NOT NULL AND s.tmdb_genres IS NOT NULL AND ${profileSeriesRows('s')}
    GROUP BY s.tmdb_id, s.media_type
    ORDER BY episode_count DESC
  `).all() as any[]

  // Weighted genre profile
  const genreWeights: Record<string, { weight: number, liked: number, disliked: number, neutral: number }> = {}
  const keywordWeights: Record<string, number> = {}
  const likedShows: string[] = []
  const dislikedShows: string[] = []
  const neutralShows: string[] = []

  for (const s of shows) {
    try {
      const genres = parseStoredGenres(s.tmdb_genres)
      const keywords = JSON.parse(s.tmdb_keywords || '[]')
      const feedback = s.user_feedback
      const epWeight = Math.min(s.episode_count / 10, 5) // Cap at 5x for very long shows

      for (const g of genres) {
        if (!genreWeights[g]) genreWeights[g] = { weight: 0, liked: 0, disliked: 0, neutral: 0 }
        const contribution = feedback === 1 ? epWeight * 3 : feedback === -1 ? -epWeight : epWeight
        genreWeights[g].weight += contribution
        if (feedback === 1) genreWeights[g].liked++
        else if (feedback === -1) genreWeights[g].disliked++
        else genreWeights[g].neutral++
      }

      // Keywords get less weight
      for (const k of keywords.slice(0, 5)) {
        const contribution = feedback === 1 ? 2 : feedback === -1 ? -1 : 0.5
        keywordWeights[k] = (keywordWeights[k] || 0) + contribution
      }

      if (feedback === 1) likedShows.push(s.title)
      else if (feedback === -1) dislikedShows.push(s.title)
      else if (s.episode_count >= 10) neutralShows.push(s.title)
    } catch {}
  }

  const sortedGenres = Object.entries(genreWeights)
    .sort((a, b) => b[1].weight - a[1].weight)
    .map(([name, data]) => ({
      name,
      weight: Math.round(data.weight * 10) / 10,
      liked: data.liked,
      disliked: data.disliked,
      neutral: data.neutral,
    }))

  const topKeywords = Object.entries(keywordWeights)
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, weight]) => ({ name, weight: Math.round(weight * 10) / 10 }))

  return {
    topGenres: sortedGenres.filter(g => g.weight > 0).slice(0, 8),
    avoidGenres: sortedGenres.filter(g => g.weight < 0),
    topKeywords,
    likedShows,
    dislikedShows,
    neutralShows: neutralShows.slice(0, 10),
    totalShows: shows.length,
    feedbackCount: likedShows.length + dislikedShows.length,
  }
}

/** Righe di `config` del profilo dei gusti (testo libero e sintesi AI): non sono segreti. */
export function tasteTexts(db: Database.Database): { custom_notes: string, ai_summary: string, ai_summary_updated_at: string | null } {
  const get = (key: string) => (db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined)?.value
  return {
    custom_notes: get('taste_custom_notes') || '',
    ai_summary: get('taste_ai_summary') || '',
    ai_summary_updated_at: get('taste_ai_summary_updated_at') || null,
  }
}
