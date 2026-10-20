import { rematchUnmatchedSeries } from '../../utils/ingest'
import { getTmdbKey } from '../../utils/tmdb'
import { userError, userMessage } from '../../utils/user-message'

// Riabbina su TMDB le serie rimaste senza tmdb_id (es. titoli ripuliti dalla migrazione v5
// o righe corrette a mano). Solo ricerca tra le serie; idempotente.
export default defineEventHandler(async () => {
  if (!getTmdbKey()) {
    throw userError(400, userMessage('errors.tmdbKeyMissingSearch'))
  }
  const result = await rematchUnmatchedSeries()
  const msg = result.titlesTried === 0
    ? userMessage('maintenance.rematch.none')
    : userMessage('maintenance.rematch.done', {
        tried: result.titlesTried,
        matched: result.matched,
        rows: result.rowsMatched,
        unmatched: result.stillUnmatched,
      })
  return { success: true, ...msg, ...result }
})
