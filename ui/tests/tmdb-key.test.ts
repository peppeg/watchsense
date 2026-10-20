import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'

// Chiave TMDB dalle Impostazioni: priorità DB → env → '', GET mascherato, POST, prova chiave

const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')

vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('readBody', async (event: any) => event.body)
vi.stubGlobal('createError', createError)
vi.stubGlobal('fetch', vi.fn())

const { getDb } = await import('../server/utils/db')
const { decryptSecret } = await import('../server/utils/secret-key')
const tmdb = await import('../server/utils/tmdb')
const getConfig = (await import('../server/api/config.get')).default as any
const postConfig = (await import('../server/api/config.post')).default as any
const testKey = (await import('../server/api/tmdb/test.post')).default as any

const DB_KEY = 'a'.repeat(28) + '1234'
const ENV_KEY = 'b'.repeat(28) + '5678'

const storedRaw = () => (getDb().prepare("SELECT value FROM config WHERE key = 'tmdb_api_key'").get() as { value: string } | undefined)?.value
/** Valore salvato, decifrato; il valore grezzo deve essere cifrato (o vuoto). */
const storedKey = () => {
  const raw = storedRaw()
  if (raw === undefined || raw === '') return raw
  expect(raw.startsWith('enc:v1:')).toBe(true)
  const res = decryptSecret(raw)
  return res.ok ? res.value : '<unreadable>'
}
const fetchMock = () => vi.mocked(fetch)

/** Errore h3 lanciato da `fn` (fallisce se non lancia). */
async function thrown(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn()
  } catch (err) {
    return err
  }
  throw new Error('nessun errore')
}

afterAll(() => {
  vi.unstubAllGlobals()
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  delete process.env.TMDB_API_KEY
  getDb().prepare("DELETE FROM config WHERE key = 'tmdb_api_key'").run()
  fetchMock().mockReset()
})

describe('getTmdbKey: DB → env → vuota', () => {
  it('senza DB né env è vuota', () => {
    expect(tmdb.getTmdbKey()).toBe('')
    expect(tmdb.getTmdbKeySource()).toBe('none')
  })

  it('solo env', () => {
    process.env.TMDB_API_KEY = ` ${ENV_KEY} `
    expect(tmdb.getTmdbKey()).toBe(ENV_KEY)
    expect(tmdb.getTmdbKeySource()).toBe('env')
  })

  it('il DB ha la precedenza sull\'env', () => {
    process.env.TMDB_API_KEY = ENV_KEY
    getDb().prepare("INSERT INTO config (key, value) VALUES ('tmdb_api_key', ?)").run(DB_KEY)
    expect(tmdb.getTmdbKey()).toBe(DB_KEY)
    expect(tmdb.getTmdbKeySource()).toBe('db')
  })

  it('valore vuoto in DB: si usa l\'env', () => {
    process.env.TMDB_API_KEY = ENV_KEY
    getDb().prepare("INSERT INTO config (key, value) VALUES ('tmdb_api_key', '')").run()
    expect(tmdb.getTmdbKey()).toBe(ENV_KEY)
    expect(tmdb.getTmdbKeySource()).toBe('env')
  })

  it('formato: solo chiavi v3 di 32 caratteri esadecimali', () => {
    expect(tmdb.isValidTmdbKey(DB_KEY)).toBe(true)
    expect(tmdb.isValidTmdbKey(DB_KEY.toUpperCase())).toBe(true)
    expect(tmdb.isValidTmdbKey(DB_KEY.slice(1))).toBe(false)
    expect(tmdb.isValidTmdbKey('g'.repeat(32))).toBe(false)
    expect(tmdb.isValidTmdbKey('eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.sig')).toBe(false)
  })
})

describe('GET /api/config: stato della chiave TMDB', () => {
  it('mascherata, mai in chiaro', async () => {
    getDb().prepare("INSERT INTO config (key, value) VALUES ('tmdb_api_key', ?)").run(DB_KEY)
    const res = await getConfig({})
    expect(res.tmdb).toEqual({ has_api_key: true, masked_api_key: 'aaaa••••••••1234', source: 'db', secret_unreadable: false })
    expect(JSON.stringify(res)).not.toContain(DB_KEY)
  })

  it('da env', async () => {
    process.env.TMDB_API_KEY = ENV_KEY
    const res = await getConfig({})
    expect(res.tmdb).toEqual({ has_api_key: true, masked_api_key: 'bbbb••••••••5678', source: 'env', secret_unreadable: false })
    expect(JSON.stringify(res)).not.toContain(ENV_KEY)
  })

  it('mancante', async () => {
    expect((await getConfig({})).tmdb).toEqual({ has_api_key: false, masked_api_key: '', source: 'none', secret_unreadable: false })
  })
})

describe('POST /api/config: salva e cancella la chiave TMDB', () => {
  it('salva una chiave valida (spazi tolti)', async () => {
    const res = await postConfig({ body: { tmdb: { api_key: `  ${DB_KEY}\n` } } })
    expect(res.ok).toBe(true)
    expect(storedKey()).toBe(DB_KEY)
  })

  it('cambio chiave: le classifiche vuote della chiave errata non restano in cache', async () => {
    process.env.TMDB_API_KEY = ENV_KEY
    fetchMock().mockResolvedValueOnce(new Response('', { status: 401 }))
    expect(await tmdb.fetchStreamingCharts(8, 'netflix')).toEqual([])
    // Senza cambi la classifica vuota resta in cache (nessuna nuova chiamata)
    expect(await tmdb.fetchStreamingCharts(8, 'netflix')).toEqual([])
    expect(fetchMock()).toHaveBeenCalledTimes(1)

    await postConfig({ body: { tmdb: { api_key: DB_KEY } } })
    fetchMock().mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ id: 1, name: 'Dark' }], total_pages: 1 }), { status: 200 }))
    const rows = await tmdb.fetchStreamingCharts(8, 'netflix')
    expect(rows.map(r => r.tmdb_id)).toEqual([1])
    expect(String(fetchMock().mock.calls[1]![0])).toContain(DB_KEY)
  })

  it('vuota o mascherata: invariata', async () => {
    await postConfig({ body: { tmdb: { api_key: DB_KEY } } })
    await postConfig({ body: { tmdb: { api_key: '' } } })
    await postConfig({ body: { tmdb: { api_key: 'aaaa••••••••1234' } } })
    await postConfig({ body: { tmdb: {} } })
    expect(storedKey()).toBe(DB_KEY)
  })

  it('clear_api_key cancella la riga e torna valida la chiave dell\'env', async () => {
    process.env.TMDB_API_KEY = ENV_KEY
    await postConfig({ body: { tmdb: { api_key: DB_KEY } } })
    await postConfig({ body: { tmdb: { api_key: '', clear_api_key: true } } })
    expect(storedKey()).toBeUndefined()
    expect(tmdb.getTmdbKey()).toBe(ENV_KEY)
  })

  it('chiave non valida: 400 con codice, nulla salvato (nemmeno il resto)', async () => {
    const err = await thrown(() => postConfig({ body: { tmdb: { api_key: 'eyJ.token.v4' }, taste: { custom_notes: 'x' } } }))
    expect(err.statusCode).toBe(400)
    expect(err.data.code).toBe('errors.config.invalidTmdbKey')
    expect(storedKey()).toBeUndefined()
  })
})

describe('POST /api/tmdb/test', () => {
  it('ok con la chiave del form: chiama /3/configuration con un timeout', async () => {
    fetchMock().mockResolvedValueOnce(new Response('{}', { status: 200 }))
    const res = await testKey({ body: { api_key: DB_KEY } })
    expect(res).toMatchObject({ ok: true, code: 'settings.tmdb.testOk' })
    const [url, init] = fetchMock().mock.calls[0]! as [string, RequestInit]
    expect(url).toBe(`https://api.themoviedb.org/3/configuration?api_key=${DB_KEY}`)
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(storedKey()).toBeUndefined()
  })

  it('senza chiave nel form usa quella effettiva', async () => {
    process.env.TMDB_API_KEY = ENV_KEY
    fetchMock().mockResolvedValueOnce(new Response('{}', { status: 200 }))
    await testKey({ body: { api_key: '' } })
    expect(String(fetchMock().mock.calls[0]![0])).toContain(ENV_KEY)
  })

  it('401: chiave rifiutata', async () => {
    fetchMock().mockResolvedValueOnce(new Response('{"status_code":7}', { status: 401 }))
    const err = await thrown(() => testKey({ body: { api_key: DB_KEY } }))
    expect(err.statusCode).toBe(400)
    expect(err.data).toMatchObject({ code: 'settings.tmdb.testRejected', params: { status: 401 }, reason: 'rejected' })
  })

  it('500: TMDB non disponibile, non la chiave', async () => {
    fetchMock().mockResolvedValueOnce(new Response('', { status: 503 }))
    const err = await thrown(() => testKey({ body: { api_key: DB_KEY } }))
    expect(err.statusCode).toBe(502)
    expect(err.data).toMatchObject({ code: 'settings.tmdb.testHttp', params: { status: 503 } })
  })

  it('errore di rete: 502, il dettaglio non contiene la chiave', async () => {
    fetchMock().mockRejectedValueOnce(new TypeError('fetch failed', { cause: new Error(`connect ECONNREFUSED ?api_key=${DB_KEY}`) }))
    const err = await thrown(() => testKey({ body: { api_key: DB_KEY } }))
    expect(err.statusCode).toBe(502)
    expect(err.data.code).toBe('settings.tmdb.testUnreachable')
    expect(JSON.stringify(err.data)).not.toContain(DB_KEY)
    expect(err.message).not.toContain(DB_KEY)
  })

  it('nessuna chiave: 400 senza chiamare TMDB', async () => {
    const err = await thrown(() => testKey({ body: {} }))
    expect(err.statusCode).toBe(400)
    expect(err.data.code).toBe('settings.tmdb.testNoKey')
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it('formato non valido: 400 senza chiamare TMDB', async () => {
    const err = await thrown(() => testKey({ body: { api_key: 'not-a-key' } }))
    expect(err.data.code).toBe('errors.config.invalidTmdbKey')
    expect(fetchMock()).not.toHaveBeenCalled()
  })
})
