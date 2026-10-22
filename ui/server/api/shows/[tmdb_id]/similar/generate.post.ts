import { requireMediaType } from '../../../../utils/sync-helpers'
import { generateAiSimilar, isLikedShow, readCachedAiSimilar } from '../../../../utils/ai-similar'
import { errorDetail, userError, userMessage } from '../../../../utils/user-message'

// Genera (chiamata LLM) e salva in show_ai_similar i consigli AI per un titolo con 👍.
// Se sono già in cache li restituisce senza rigenerarli, salvo `force: true` nel body.
export default defineEventHandler(async (event) => {
  const tmdbId = parseInt(event.context.params?.tmdb_id as string)
  const body = (await readBody(event).catch(() => null)) || {}

  if (!tmdbId) {
    throw createError({ statusCode: 400, message: 'Invalid tmdb_id' })
  }
  // Tipo dell'id: ?type= (come la GET) o media_type nel body; default tv
  const mediaType = requireMediaType(getQuery(event).type ?? body?.media_type)

  if (!isLikedShow(tmdbId, mediaType)) {
    throw userError(409, userMessage('errors.similar.notLiked'))
  }

  if (body?.force !== true) {
    const cached = readCachedAiSimilar(tmdbId, mediaType)
    if (cached) return { similar: cached, isAiTailored: true, cached: true }
  }

  let similar: any[] | null
  try {
    similar = await generateAiSimilar(tmdbId, mediaType)
  } catch (err: any) {
    console.error('Error generating AI tailored similar shows:', err)
    throw userError(502, userMessage('errors.similar.failed', { detail: errorDetail(err) }))
  }
  if (!similar) {
    throw userError(502, userMessage('errors.similar.empty'))
  }
  return { similar, isAiTailored: true, cached: false }
})
