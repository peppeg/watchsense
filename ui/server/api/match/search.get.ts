import { getTmdbKey } from '../../utils/tmdb'
import { searchTmdbTvCandidates } from '../../utils/sync-helpers'
import { userError, userMessage } from '../../utils/user-message'

// Ricerca tra le serie TMDB (/search/tv, lingua TMDB configurata) per l'abbinamento manuale. ?query=
export default defineEventHandler(async (event) => {
  const raw = getQuery(event).query
  const query = typeof raw === 'string' ? raw.trim() : ''
  if (!query || query.length > 200) {
    throw userError(400, userMessage('match.searchQueryInvalid'))
  }
  if (!getTmdbKey()) {
    throw userError(400, userMessage('errors.tmdbKeyMissingSearch'))
  }
  try {
    return { results: await searchTmdbTvCandidates(query) }
  } catch {
    throw userError(502, userMessage('match.tmdbUnavailable'))
  }
})
