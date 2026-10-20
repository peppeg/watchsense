import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'

// DB su file temporaneo: getDb() lo apre (e lo migra) al primo uso
const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')

// Auto-import di h3 usati dall'endpoint: versioni minime su un evento finto
vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('createError', createError)
vi.stubGlobal('readBody', async (event: any) => event.body)
vi.stubGlobal('getRequestHeader', (event: any, name: string) => event.headers[name])
vi.stubGlobal('setResponseStatus', (event: any, code: number) => { event.status = code })
vi.stubGlobal('setResponseHeader', (event: any, name: string, value: string) => { event.node.res.headers[name] = value })
vi.stubGlobal('sendRedirect', (_event: any, url: string) => `redirect:${url}`)

const { getDb } = await import('../server/utils/db')
const ingest = (await import('../server/api/sync/ingest')).default as any

function fakeEvent(opts: { method?: string, body?: any, html?: boolean } = {}) {
  const headers: Record<string, string> = { origin: 'https://www.netflix.com' }
  if (opts.html) headers.accept = 'text/html'
  return {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body ?? {},
    status: 200,
    node: { req: {}, res: { headers: {} as Record<string, string>, statusCode: 200, setHeader(n: string, v: string) { this.headers[n] = v } } },
  }
}

async function failure(event: any) {
  try {
    await ingest(event)
  } catch (err: any) {
    return err
  }
  throw new Error('nessun errore')
}

function setLocale(locale: 'it' | 'en') {
  getDb().prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('app_locale', ?)").run(locale)
}

afterAll(() => {
  vi.unstubAllGlobals()
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  delete process.env.WATCHSENSE_LOCALE
})

describe('messaggi del bookmarklet nella lingua dell\'app', () => {
  it('italiano: token non valido, stesso testo di prima, con codice', async () => {
    setLocale('it')
    const err = await failure(fakeEvent({ body: { items: [], token: 'x' } }))
    expect(err.statusCode).toBe(403)
    expect(err.message).toBe('Token bookmarklet non valido: reinstalla il bookmarklet dalle Impostazioni.')
    expect(err.data).toEqual({ code: 'sync.bookmarklet.invalidToken' })
  })

  it('inglese: token non valido', async () => {
    setLocale('en')
    const err = await failure(fakeEvent({ body: { items: [], token: 'x' } }))
    expect(err.message).toBe('Invalid bookmarklet token: reinstall the bookmarklet from Settings.')
    expect(err.data).toEqual({ code: 'sync.bookmarklet.invalidToken' })
  })

  it('metodo e origine non consentiti', async () => {
    setLocale('it')
    expect((await failure(fakeEvent({ method: 'GET' }))).message).toBe('Metodo non consentito.')
    const opt = fakeEvent({ method: 'OPTIONS' })
    opt.headers.origin = 'https://evil.example'
    expect((await failure(opt)).message).toBe('Origine non consentita.')
    setLocale('en')
    expect((await failure(fakeEvent({ method: 'GET' }))).message).toBe('Method not allowed.')
  })

  it('elementi mancanti, troppi o non validi (codici + parametri)', async () => {
    const { getIngestToken } = await import('../server/utils/ingest-token')
    const token = getIngestToken()
    setLocale('it')
    expect((await failure(fakeEvent({ body: { items: [], token } }))).message).toBe('Nessun elemento ricevuto dal Bookmarklet.')
    const many = await failure(fakeEvent({ body: { items: Array.from({ length: 5001 }, () => ({ title: 'X' })), token } }))
    expect(many.message).toBe('Troppi elementi: massimo 5000 per invio.')
    expect(many.data).toEqual({ code: 'sync.bookmarklet.tooManyItems', params: { max: 5000 } })
    const invalid = await failure(fakeEvent({ body: { items: [{ title: 42 }, null], token } }))
    expect(invalid.message).toBe('Nessun elemento valido ricevuto dal Bookmarklet (2 scartati).')
    setLocale('en')
    expect((await failure(fakeEvent({ body: { items: [{ title: 42 }], token } }))).message)
      .toBe('No valid items received from the bookmarklet (1 rejected).')
  })

  it('pagina d\'errore del form: italiano identico a prima, inglese con lang="en"', async () => {
    setLocale('it')
    const it = fakeEvent({ html: true, body: { payload: '[]', token: 'x' } })
    const html = await ingest(it)
    expect(it.status).toBe(403)
    expect(html).toBe('<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WatchSense: sync non riuscita</title>'
      + '<style>body{font-family:system-ui,sans-serif;background:#18181b;color:#e4e4e7;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5}h1{font-size:1.25rem;color:#f87171}a{color:#22d3ee}</style></head>'
      + '<body><h1>Sincronizzazione bookmarklet non riuscita (403)</h1><p>Token bookmarklet non valido: reinstalla il bookmarklet dalle Impostazioni.</p><p><a href="/">Apri WatchSense</a></p></body></html>')
    setLocale('en')
    const en = await ingest(fakeEvent({ html: true, body: { payload: '[]', token: 'x' } }))
    expect(en).toContain('<html lang="en">')
    expect(en).toContain('<title>WatchSense: sync failed</title>')
    expect(en).toContain('<h1>Bookmarklet sync failed (403)</h1><p>Invalid bookmarklet token: reinstall the bookmarklet from Settings.</p><p><a href="/">Open WatchSense</a></p>')
  })

  it('esito riuscito: testo nella lingua dell\'app, con codice e note dei film', async () => {
    const { getIngestToken } = await import('../server/utils/ingest-token')
    const token = getIngestToken()
    setLocale('it')
    const items = [{ title: 'Serie Prova', episodeTitle: 'Pilota', watchedAt: '2024-01-02', tmdbId: 1, mediaType: 'tv' },
      { title: 'Film Prova', episodeTitle: '(film)', watchedAt: '2024-01-03', tmdbId: 2, mediaType: 'movie' }]
    const res = await ingest(fakeEvent({ body: { items, token } }))
    expect(res.message).toBe('Bookmarklet sincronizzato con successo: 2 visioni ricevute, 1 nuovi episodi inseriti. 1 film registrato, non mostrato.')
    expect(res.code).toBe('sync.bookmarklet.done')
    expect(res.params).toEqual({ received: 2, episodes: 1 })
    expect(res.notes).toEqual([{ code: 'sync.note.movies', params: { count: 1 } }])
    setLocale('en')
    const again = await ingest(fakeEvent({ body: { items: items.slice(0, 1), token } }))
    expect(again.message).toBe('Bookmarklet sync complete: 1 views received, 0 new episodes added.')
  })
})
