import { getDb } from './db'
import { LLM_CONFIG_KEY, readSecretValue } from './secrets'
import { encryptSecret } from './secret-key'

// Configurazione LLM condivisa: qualsiasi provider OpenAI-compatibile

export const DEFAULT_LLM_MODEL = 'kilo-auto/free'
export const KILO_DEFAULT_BASE_URL = 'https://api.kilo.ai/api/gateway'
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

const LLM_TIMEOUT_MS = 60_000
const MAX_ERROR_LENGTH = 300

export interface LlmConfig {
  base_url: string
  api_key: string
  model: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function normalizeBaseUrl(url: string): string {
  return (url || '').trim().replace(/\/+$/, '')
}

/** Config da variabili d'ambiente: LLM_* → KILO_* → OPENROUTER_API_KEY. */
export function getEnvLlmConfig(): LlmConfig {
  const env = process.env
  const model = env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL

  if (env.LLM_BASE_URL?.trim() || env.LLM_API_KEY?.trim()) {
    return {
      base_url: normalizeBaseUrl(env.LLM_BASE_URL || KILO_DEFAULT_BASE_URL),
      api_key: env.LLM_API_KEY?.trim() || '',
      model,
    }
  }
  // KILO_BASE_URL da solo (senza chiave) non deve oscurare OPENROUTER_API_KEY
  if (env.KILO_API_KEY?.trim() || (env.KILO_BASE_URL?.trim() && !env.OPENROUTER_API_KEY?.trim())) {
    return {
      base_url: normalizeBaseUrl(env.KILO_BASE_URL || KILO_DEFAULT_BASE_URL),
      api_key: env.KILO_API_KEY?.trim() || '',
      model,
    }
  }
  // La chiave OpenRouter va sempre e solo verso OpenRouter
  if (env.OPENROUTER_API_KEY?.trim()) {
    return {
      base_url: OPENROUTER_BASE_URL,
      api_key: env.OPENROUTER_API_KEY.trim(),
      model,
    }
  }
  return { base_url: KILO_DEFAULT_BASE_URL, api_key: '', model }
}

export interface StoredLlmState {
  /** Config salvata, con api_key già decifrata ('' se non decifrabile). */
  config: Partial<LlmConfig> | null
  /** api_key salvata ma non decifrabile (chiave dei segreti cambiata o mancante). */
  apiKeyUnreadable: boolean
  /** api_key così com'è nel DB (cifrata): per conservarla se l'utente cambia solo il modello. */
  rawApiKey: string
}

/** Config salvata in DB (`config.llm_config`, api_key cifrata), se presente e valida. */
export function getStoredLlmState(): StoredLlmState {
  let parsed: any
  try {
    const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(LLM_CONFIG_KEY) as { value: string } | undefined
    if (!row?.value) return { config: null, apiKeyUnreadable: false, rawApiKey: '' }
    parsed = JSON.parse(row.value)
  } catch {
    return { config: null, apiKeyUnreadable: false, rawApiKey: '' }
  }
  if (!parsed || typeof parsed !== 'object') return { config: null, apiKeyUnreadable: false, rawApiKey: '' }
  const rawApiKey = typeof parsed.api_key === 'string' ? parsed.api_key : ''
  const key = readSecretValue('llm_config.api_key', rawApiKey)
  return { config: { ...parsed, api_key: key.value }, apiKeyUnreadable: key.unreadable, rawApiKey }
}

/** Config salvata in DB (`config.llm_config`), se presente e valida, con la chiave in chiaro. */
export function getStoredLlmConfig(): Partial<LlmConfig> | null {
  return getStoredLlmState().config
}

/** Salva la config LLM: base_url e model in chiaro, api_key cifrata (`rawApiKey`: già cifrata, si conserva). */
export function saveStoredLlmConfig(config: LlmConfig, rawApiKey?: string): void {
  const value = { ...config, api_key: rawApiKey ?? encryptSecret(config.api_key) }
  getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(LLM_CONFIG_KEY, JSON.stringify(value))
}

/** Config effettiva: priorità DB → env. */
export function getLlmConfig(): LlmConfig {
  const env = getEnvLlmConfig()
  const stored = getStoredLlmConfig()
  const storedBase = normalizeBaseUrl(stored?.base_url || '')
  if (!stored || !storedBase) {
    return {
      ...env,
      api_key: stored?.api_key?.trim() || env.api_key,
      model: stored?.model?.trim() || env.model,
    }
  }
  // La chiave env si usa solo se punta allo stesso base_url salvato
  let apiKey = stored.api_key?.trim() || ''
  if (!apiKey && sameBaseUrl(storedBase, env.base_url)) apiKey = env.api_key
  return {
    base_url: storedBase,
    api_key: apiKey,
    model: stored.model?.trim() || env.model,
  }
}

export function sameBaseUrl(a: string, b: string): boolean {
  return normalizeBaseUrl(a).toLowerCase() === normalizeBaseUrl(b).toLowerCase()
}

/** Base URL "versionata": termina con /v1 (aggiunto se manca). */
function versionedBase(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl)
  return /\/v1$/i.test(base) ? base : `${base}/v1`
}

export function buildChatUrl(baseUrl: string): string {
  return `${versionedBase(baseUrl)}/chat/completions`
}

export function buildModelsUrl(baseUrl: string): string {
  return `${versionedBase(baseUrl)}/models`
}

/** Provider locale (Ollama, LM Studio, ...): la chiave è facoltativa. */
export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(normalizeBaseUrl(baseUrl)).hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return host === 'localhost'
      || host === '::1'
      || host.endsWith('.local')
      || /^127\./.test(host)
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) // Tailscale CGNAT
      || host === 'host.docker.internal'
  } catch {
    return false
  }
}

export function buildLlmHeaders(config: Pick<LlmConfig, 'base_url' | 'api_key'>): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.api_key) headers.Authorization = `Bearer ${config.api_key}`
  // Header facoltativi di attribuzione per OpenRouter
  if (/openrouter\.ai/i.test(config.base_url)) {
    headers['X-Title'] = 'WatchSense'
  }
  return headers
}

export function truncateMessage(msg: string, max = MAX_ERROR_LENGTH): string {
  const clean = (msg || '').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/** Errore LLM normalizzato (status HTTP del provider, messaggio troncato). */
export class LlmError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(truncateMessage(message))
    this.name = 'LlmError'
    this.status = status
  }
}

/**
 * Config utilizzabile: base URL presente e chiave salvata, oppure provider locale (chiave
 * facoltativa). Stesse condizioni di assertLlmConfig; lo usa la lista "Per iniziare".
 */
export function isLlmConfigured(config: Pick<LlmConfig, 'base_url' | 'api_key'>): boolean {
  return Boolean(config.base_url) && (Boolean(config.api_key) || isLocalBaseUrl(config.base_url))
}

/** Verifica minima della config prima di chiamare il provider. */
export function assertLlmConfig(config: LlmConfig): void {
  if (!config.base_url) throw new LlmError('Base URL del provider LLM mancante. Configuralo nelle Impostazioni.', 400)
  if (!config.api_key && !isLocalBaseUrl(config.base_url)) {
    throw new LlmError('API Key LLM mancante per un provider remoto. Configurala nelle Impostazioni.', 400)
  }
}

async function readProviderError(resp: Response): Promise<string> {
  const text = await resp.text().catch(() => '')
  try {
    const json = JSON.parse(text)
    const msg = json?.error?.message || json?.message || (typeof json?.error === 'string' ? json.error : '')
    if (msg) return String(msg)
  } catch {}
  // Mai il corpo grezzo (es. pagine HTML): solo lo status testuale
  return resp.statusText || 'risposta non valida'
}

export async function chatCompletion(opts: {
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
  config?: LlmConfig
}): Promise<{ content: string; model: string; raw: any }> {
  const config = opts.config || getLlmConfig()
  assertLlmConfig(config)
  const model = config.model || DEFAULT_LLM_MODEL
  const url = buildChatUrl(config.base_url)

  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: buildLlmHeaders(config),
      body: JSON.stringify({
        model,
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 1000,
        temperature: opts.temperature ?? 0.7,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    })
  } catch (err: any) {
    const reason = err?.name === 'TimeoutError' ? `timeout dopo ${LLM_TIMEOUT_MS / 1000}s` : (err?.cause?.message || err?.message || 'errore di rete')
    throw new LlmError(`Impossibile raggiungere il provider LLM (${normalizeBaseUrl(config.base_url)}): ${reason}`, 502)
  }

  if (!resp.ok) {
    const msg = await readProviderError(resp)
    throw new LlmError(`Errore dal provider LLM (${resp.status}): ${msg}`, resp.status)
  }

  let data: any = {}
  try {
    data = await resp.json()
  } catch {
    throw new LlmError('Risposta del provider LLM non in formato JSON.', 502)
  }
  const content = data?.choices?.[0]?.message?.content
  return { content: typeof content === 'string' ? content : '', model, raw: data }
}

/** Estrae il primo array JSON di oggetti dalla risposta del modello. */
export function extractJsonArray(content: string): any[] | null {
  const cleaned = (content || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
  const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}
