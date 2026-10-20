import { buildLlmHeaders, buildModelsUrl, getLlmConfig, sameBaseUrl, truncateMessage } from '../../utils/llm'

// Elenco modelli del provider (GET {base}/models), per popolare la tendina in Impostazioni
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({})) || {}
  const current = getLlmConfig()

  const baseUrl = String(body.base_url || current.base_url || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw createError({ statusCode: 400, message: 'Base URL non valido: deve iniziare con http:// o https://' })
  }

  // La chiave salvata si riusa solo se il base_url richiesto è quello salvato
  let apiKey = String(body.api_key || '').trim()
  if (!apiKey || apiKey.includes('••••••••')) {
    apiKey = sameBaseUrl(baseUrl, current.base_url) ? current.api_key : ''
  }

  let resp: Response
  try {
    resp = await fetch(buildModelsUrl(baseUrl), {
      method: 'GET',
      headers: buildLlmHeaders({ base_url: baseUrl, api_key: apiKey }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err: any) {
    throw createError({
      statusCode: 502,
      message: truncateMessage(`Impossibile raggiungere il provider (${baseUrl}): ${err?.cause?.message || err?.message || 'errore di rete'}`),
    })
  }

  if (!resp.ok) {
    throw createError({
      statusCode: 502,
      message: `Il provider ha risposto ${resp.status} alla richiesta dei modelli.`,
    })
  }

  const data: any = await resp.json().catch(() => null)
  const list: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : []
  const models = [...new Set(
    list.map(m => (typeof m === 'string' ? m : m?.id || m?.name)).filter((id): id is string => typeof id === 'string' && id.length > 0),
  )].sort((a, b) => a.localeCompare(b))

  return { ok: true, models }
})
