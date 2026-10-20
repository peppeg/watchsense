import { requireMediaType } from '../../../../utils/sync-helpers'
import { generateAiSimilar, isLikedShow, readCachedAiSimilar } from '../../../../utils/ai-similar'

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
    throw createError({ statusCode: 409, message: 'I consigli AI sono disponibili solo per i titoli con 👍 che contano per il profilo dei gusti.' })
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
    throw createError({ statusCode: 502, message: `Generazione dei consigli AI non riuscita: ${err?.message || err}` })
  }
  if (!similar) {
    throw createError({ statusCode: 502, message: 'Il modello non ha restituito consigli utilizzabili.' })
  }
  return { similar, isAiTailored: true, cached: false }
})
