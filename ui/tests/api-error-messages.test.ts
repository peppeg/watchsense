import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { renderServerMessage } from '../app/locales/i18n'

// Errori delle API LLM, dei middleware e di watch: codice + parametri in `data`, testo
// italiano invariato in `message`, testo inglese dal dizionario (ADR-001 §2).

const realFetch = globalThis.fetch
const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')

vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('readBody', async (event: any) => event.body)
vi.stubGlobal('createError', createError)
vi.stubGlobal('getQuery', (event: any) => event.query || {})
vi.stubGlobal('getCookie', () => undefined)
vi.stubGlobal('getRequestHeader', (event: any, name: string) => event.headers?.[name])
vi.stubGlobal('setResponseHeader', () => {})
vi.stubGlobal('setResponseStatus', () => {})

const { getDb } = await import('../server/utils/db')
const { chatCompletion, LlmError } = await import('../server/utils/llm')
const llmModels = (await import('../server/api/llm/models.post')).default as any
const llmTest = (await import('../server/api/llm/test.post')).default as any
const watch = (await import('../server/api/shows/[tmdb_id]/watch.post')).default as any
const csrf = (await import('../server/middleware/csrf')).default as any
const auth = (await import('../server/middleware/auth')).default as any
const notFound = (await import('../server/api/[...]')).default as any

afterEach(() => {
  vi.unstubAllEnvs()
  vi.stubGlobal('fetch', realFetch)
})
afterAll(() => {
  vi.unstubAllGlobals()
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})

/** Errore lanciato da un handler (sincrono o asincrono). */
async function thrown(fn: () => unknown): Promise<any> {
  try {
    await fn()
  } catch (e) {
    return e
  }
  throw new Error('nessun errore')
}

/** Testo inglese che la UI ricava da un errore di createError (come fetchErrorMessage). */
const en = (err: any) => renderServerMessage('en', { ...err.data, message: err.message })

describe('API LLM', () => {
  it('base URL non valido: 400 con codice, testo it invariato, en dal dizionario', async () => {
    for (const handler of [llmModels, llmTest]) {
      const err = await thrown(() => handler({ body: { base_url: 'ftp://x' } }))
      expect(err.statusCode).toBe(400)
      expect(err.message).toBe('Base URL non valido: deve iniziare con http:// o https://')
      expect(err.data).toEqual({ code: 'errors.llm.invalidBaseUrl' })
      expect(en(err)).toBe('Invalid base URL: it must start with http:// or https://')
    }
  })

  it('test di un provider remoto diverso senza chiave: 400', async () => {
    const err = await thrown(() => llmTest({ body: { base_url: 'https://other.example/v1' } }))
    expect(err.statusCode).toBe(400)
    expect(err.data.code).toBe('errors.llm.testKeyRequired')
    expect(en(err)).toBe('An API key is required to test a provider other than the saved one.')
  })

  it('modelli: provider irraggiungibile (dettaglio di rete come parametro) e risposta HTTP', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND x.invalid') }) })
    let err = await thrown(() => llmModels({ body: { base_url: 'https://x.invalid/v1' } }))
    expect(err.statusCode).toBe(502)
    expect(err.message).toBe('Impossibile raggiungere il provider (https://x.invalid/v1): getaddrinfo ENOTFOUND x.invalid')
    expect(err.data.params).toEqual({ url: 'https://x.invalid/v1', detail: 'getaddrinfo ENOTFOUND x.invalid' })
    expect(en(err)).toBe('Could not reach the provider (https://x.invalid/v1): getaddrinfo ENOTFOUND x.invalid')

    vi.stubGlobal('fetch', async () => { throw new Error('') })
    err = await thrown(() => llmModels({ body: { base_url: 'https://x.invalid/v1' } }))
    expect(err.message).toBe('Impossibile raggiungere il provider (https://x.invalid/v1): errore di rete')
    expect(en(err)).toBe('Could not reach the provider (https://x.invalid/v1): network error')

    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }))
    err = await thrown(() => llmModels({ body: { base_url: 'https://x.invalid/v1' } }))
    expect(err.statusCode).toBe(502)
    expect(err.message).toBe('Il provider ha risposto 404 alla richiesta dei modelli.')
    expect(en(err)).toBe('The provider answered 404 to the models request.')
  })

  it('test riuscito: esito con codice, latenza e modello come parametri', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ choices: [{ message: { content: 'PONG' } }] }))
    const res = await llmTest({ body: { base_url: 'http://localhost:11434/v1', model: 'm1' } })
    expect(res).toMatchObject({ ok: true, model: 'm1', reply: 'PONG', code: 'settings.llm.testDone', params: { ms: res.latencyMs, model: 'm1' } })
    expect(res.message).toBe(`Connessione riuscita in ${res.latencyMs}ms con il modello m1!`)
    expect(renderServerMessage('en', res)).toBe(`Connected in ${res.latencyMs} ms with model m1!`)
  })

  it('test: errore del provider con status e testo remoto non tradotto', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ error: { message: 'Invalid API key' } }, { status: 401 }))
    const err = await thrown(() => llmTest({ body: { base_url: 'http://localhost:11434/v1' } }))
    expect(err.statusCode).toBe(401)
    expect(err.message).toBe('Errore dal provider LLM (401): Invalid API key')
    expect(err.data).toEqual({ code: 'errors.llm.providerError', params: { status: 401, detail: 'Invalid API key' } })
    expect(en(err)).toBe('Error from the LLM provider (401): Invalid API key')
  })

  it('chatCompletion: config mancante, timeout e risposta non JSON hanno un codice', async () => {
    const missing = await thrown(() => chatCompletion({ messages: [], config: { base_url: '', api_key: '', model: '' } }))
    expect(missing).toBeInstanceOf(LlmError)
    expect(missing.status).toBe(400)
    expect(missing.message).toBe('Base URL del provider LLM mancante. Configuralo nelle Impostazioni.')

    vi.stubGlobal('fetch', async () => { throw new DOMException('timed out', 'TimeoutError') })
    const timeout = await thrown(() => chatCompletion({ messages: [], config: { base_url: 'http://localhost:1/v1', api_key: '', model: 'm' } }))
    expect(timeout.message).toBe('Impossibile raggiungere il provider LLM (http://localhost:1/v1): timeout dopo 60s')
    expect(renderServerMessage('en', timeout.userMessage)).toBe('Could not reach the LLM provider (http://localhost:1/v1): timeout after 60s')

    vi.stubGlobal('fetch', async () => new Response('<html>', { status: 200 }))
    const notJson = await thrown(() => chatCompletion({ messages: [], config: { base_url: 'http://localhost:1/v1', api_key: '', model: 'm' } }))
    expect(renderServerMessage('en', notJson.userMessage)).toBe('The LLM provider response is not JSON.')
  })
})

describe('middleware e watch', () => {
  it('CSRF: Content-Type non ammesso (415) e origine diversa (403)', () => {
    const type = (() => { try { csrf({ method: 'POST', path: '/api/config', headers: { 'content-type': 'text/plain', 'content-length': '2' } }) } catch (e) { return e } })() as any
    expect(type.statusCode).toBe(415)
    expect(type.message).toBe('Content-Type non supportato: usa application/json.')
    expect(en(type)).toBe('Unsupported Content-Type: use application/json.')

    const origin = (() => { try { csrf({ method: 'POST', path: '/api/config', headers: { host: 'a.local', origin: 'http://b.local' } }) } catch (e) { return e } })() as any
    expect(origin.statusCode).toBe(403)
    expect(en(origin)).toBe('Cross-origin request not allowed.')
  })

  it('autenticazione richiesta: 401 con codice', () => {
    vi.stubEnv('WATCHSENSE_TOKEN', 'segreto')
    const err = (() => { try { auth({ path: '/api/config', headers: {} }) } catch (e) { return e } })() as any
    expect(err.statusCode).toBe(401)
    expect(err.message).toBe('Autenticazione richiesta.')
    expect(en(err)).toBe('Authentication required.')
  })

  it('watch con stato non valido: 400 con codice', async () => {
    const err = await thrown(() => watch({ context: { params: { tmdb_id: '1' } }, body: { status: 'boh' } }))
    expect(err.statusCode).toBe(400)
    expect(err.message).toBe("Stato non valido: atteso 'unwatched', 'in_progress' o 'completed'")
    expect(en(err)).toBe("Invalid status: expected 'unwatched', 'in_progress' or 'completed'")
  })

  it('endpoint API inesistente: 404 JSON con codice', () => {
    const res = notFound({ method: 'GET', path: '/api/nope?x=1' })
    expect(res).toMatchObject({ statusCode: 404, message: 'Endpoint API non trovato: GET /api/nope', data: { code: 'errors.api.notFound' } })
    expect(renderServerMessage('en', { ...res.data, message: res.message })).toBe('API endpoint not found: GET /api/nope')
  })
})
