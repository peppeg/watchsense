import { buildLlmHeaders, buildModelsUrl, getLlmConfig, networkCause, sameBaseUrl } from '../../utils/llm'
import { userError, userMessage } from '../../utils/user-message'

// Elenco modelli del provider (GET {base}/models), per popolare la tendina in Impostazioni
export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({})) || {}
  const current = getLlmConfig()

  const baseUrl = String(body.base_url || current.base_url || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw userError(400, userMessage('errors.llm.invalidBaseUrl'))
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
    throw userError(502, userMessage('errors.llm.modelsUnreachable', { url: baseUrl, detail: networkCause(err) }))
  }

  if (!resp.ok) {
    throw userError(502, userMessage('errors.llm.modelsHttp', { status: resp.status }))
  }

  const data: any = await resp.json().catch(() => null)
  const list: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : []
  const models = [...new Set(
    list.map(m => (typeof m === 'string' ? m : m?.id || m?.name)).filter((id): id is string => typeof id === 'string' && id.length > 0),
  )].sort((a, b) => a.localeCompare(b))

  return { ok: true, models }
})
