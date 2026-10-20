import { chatCompletion, getLlmConfig, isLocalBaseUrl, LlmError, sameBaseUrl } from '../../utils/llm'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({})) || {}

  // Config attuale come base, sovrascritta dai valori del form
  const currentLlm = getLlmConfig()
  const baseUrl = String(body.base_url || currentLlm.base_url || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw createError({ statusCode: 400, message: 'Base URL non valido: deve iniziare con http:// o https://' })
  }

  // La chiave salvata (DB o env) si riusa solo se il base_url richiesto è quello della config effettiva
  let apiKey = String(body.api_key || '').trim()
  if (!apiKey || apiKey.includes('••••••••')) {
    apiKey = sameBaseUrl(baseUrl, currentLlm.base_url) ? currentLlm.api_key : ''
    if (!apiKey && !isLocalBaseUrl(baseUrl)) {
      throw createError({
        statusCode: 400,
        message: 'API Key obbligatoria per testare un provider diverso da quello salvato.',
      })
    }
  }
  const model = String(body.model || '').trim() || currentLlm.model

  const startTime = Date.now()
  try {
    const { content } = await chatCompletion({
      messages: [{ role: 'user', content: 'Rispondi con una sola parola: PONG' }],
      maxTokens: 15,
      temperature: 0.1,
      config: { base_url: baseUrl, api_key: apiKey, model },
    })
    const latencyMs = Date.now() - startTime
    const reply = content.trim() || 'OK'

    return {
      ok: true,
      model,
      latencyMs,
      reply,
      message: `Connessione riuscita in ${latencyMs}ms con il modello ${model}!`,
    }
  } catch (err: any) {
    throw createError({
      statusCode: err instanceof LlmError ? err.status : 500,
      message: err instanceof LlmError ? err.message : 'Errore interno durante il test LLM.',
    })
  }
})
