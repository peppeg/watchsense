import { chatCompletion, getLlmConfig, isLocalBaseUrl, LlmError, sameBaseUrl } from '../../utils/llm'
import { userError, userMessage } from '../../utils/user-message'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({})) || {}

  // Config attuale come base, sovrascritta dai valori del form
  const currentLlm = getLlmConfig()
  const baseUrl = String(body.base_url || currentLlm.base_url || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw userError(400, userMessage('errors.llm.invalidBaseUrl'))
  }

  // La chiave salvata (DB o env) si riusa solo se il base_url richiesto è quello della config effettiva
  let apiKey = String(body.api_key || '').trim()
  if (!apiKey || apiKey.includes('••••••••')) {
    apiKey = sameBaseUrl(baseUrl, currentLlm.base_url) ? currentLlm.api_key : ''
    if (!apiKey && !isLocalBaseUrl(baseUrl)) {
      throw userError(400, userMessage('errors.llm.testKeyRequired'))
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
      ...userMessage('settings.llm.testDone', { ms: latencyMs, model }),
    }
  } catch (err: any) {
    if (err instanceof LlmError) throw userError(err.status, err.userMessage)
    console.error('LLM test failed:', err)
    throw userError(500, userMessage('errors.llm.testInternal'))
  }
})
