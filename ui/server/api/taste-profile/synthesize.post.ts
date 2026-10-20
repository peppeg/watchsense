import { getDb } from '../../utils/db'
import { chatCompletion, LlmError } from '../../utils/llm'
import { profileSeriesRows } from '../../utils/series-filter'
import { getLocaleConfig } from '../../utils/locale'
import { localizeGenre, parseStoredGenres } from '../../utils/genres'
import { buildTasteSummaryPrompt } from '../../utils/llm-prompts'

export default defineEventHandler(async () => {
  const db = getDb()
  const { appLocale } = getLocaleConfig(db)

  // 1. Fetch shows and feedback (profileSeriesRows: senza le serie ignorate o escluse dal profilo)
  const shows = db.prepare(`
    SELECT s.title, s.tmdb_genres, COALESCE(sf.feedback, 0) as user_feedback, COUNT(*) as ep_count
    FROM shows s
    LEFT JOIN show_feedback sf ON sf.tmdb_id = s.tmdb_id AND sf.media_type = s.media_type
    WHERE s.tmdb_id IS NOT NULL AND s.tmdb_genres IS NOT NULL AND ${profileSeriesRows('s')}
    GROUP BY s.tmdb_id, s.media_type
    ORDER BY ep_count DESC
  `).all() as any[]

  const liked: string[] = []
  const disliked: string[] = []
  const mostWatched: string[] = []
  const genreCounts: Record<string, number> = {}

  for (const s of shows) {
    if (s.user_feedback === 1) liked.push(s.title)
    if (s.user_feedback === -1) disliked.push(s.title)
    if (mostWatched.length < 15) mostWatched.push(`${s.title} (${s.ep_count} ep)`)

    for (const g of parseStoredGenres(s.tmdb_genres)) {
      genreCounts[g] = (genreCounts[g] || 0) + (s.user_feedback === 1 ? 3 : s.user_feedback === -1 ? -1 : 1)
    }
  }

  const topGenres = Object.entries(genreCounts)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    // Nel prompt i generi vanno nella lingua dell'app
    .map(([g]) => localizeGenre(g, appLocale))

  // 2. Build Prompt (nella lingua dell'app)
  const prompt = buildTasteSummaryPrompt({ liked, disliked, topGenres, mostWatched }, appLocale)

  // 3. Call LLM (config DB → env)
  try {
    const { content } = await chatCompletion({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      maxTokens: 600,
    })
    // Rimuove eventuali blocchi di ragionamento dei modelli "thinking"
    const summary = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()

    if (!summary) throw new Error('Nessuna risposta generata dal modello LLM.')

    const setConfig = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
    setConfig.run('taste_ai_summary', summary)
    setConfig.run('taste_ai_summary_updated_at', new Date().toISOString())

    return {
      ok: true,
      summary,
      updated_at: new Date().toISOString(),
    }
  } catch (e: any) {
    throw createError({
      statusCode: e instanceof LlmError && e.status === 400 ? 400 : 500,
      message: `Impossibile generare la sintesi del profilo: ${e.message}`,
    })
  }
})
