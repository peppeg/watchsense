import { getTmdbKey } from '../../utils/tmdb'
import { applyManualMatch, MatchError, parseMatchRequest } from '../../utils/manual-match'
import { userError, userMessage } from '../../utils/user-message'

// Abbina a mano una serie a un id TMDB (vedi utils/manual-match.ts).
// Body: { tmdb_id, title, platform } (serie senza abbinamento) o { tmdb_id, from_tmdb_id }.
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => null)
  try {
    const { tmdbId, target } = parseMatchRequest(body)
    if (!getTmdbKey()) {
      throw new MatchError(400, userMessage('errors.tmdbKeyMissingMatch'))
    }
    const result = await applyManualMatch(tmdbId, target)
    return {
      success: true,
      tmdb_id: result.tmdbId,
      media_type: 'tv',
      name: result.name,
      rows: result.rows,
      ...userMessage('match.applied', { name: result.name, count: result.rows }),
    }
  } catch (e) {
    if (e instanceof MatchError) throw userError(e.statusCode, e.userMessage)
    throw e
  }
})
