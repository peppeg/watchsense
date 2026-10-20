import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'

// Login Stremio con email e password: si salva solo la authKey, mai la password

const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')

vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('readBody', async (event: any) => event.body)
vi.stubGlobal('createError', createError)
vi.stubGlobal('fetch', vi.fn())

const { getDb } = await import('../server/utils/db')
const login = (await import('../server/api/sync/stremio-login.post')).default as any
const getConfig = (await import('../server/api/config.get')).default as any

const PASSWORD = 'hunter2-secret-pw'
const AUTH_KEY = 'stremio-auth-key-0123456789'
const fetchMock = () => vi.mocked(fetch)
const storedKey = () => (getDb().prepare("SELECT value FROM config WHERE key = 'stremio_auth_key'").get() as { value: string } | undefined)?.value
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Errore h3 lanciato da `fn` (fallisce se non lancia). */
async function thrown(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn()
  } catch (err) {
    return err
  }
  throw new Error('nessun errore')
}

/** Nessuna traccia della password in tutto il DB. */
function dbContainsPassword(): boolean {
  const rows = getDb().prepare('SELECT key, value FROM config').all() as { key: string; value: string }[]
  return rows.some(r => r.value.includes(PASSWORD) || r.key.includes(PASSWORD))
}

afterAll(() => {
  vi.unstubAllGlobals()
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  getDb().prepare("DELETE FROM config WHERE key = 'stremio_auth_key'").run()
  fetchMock().mockReset()
})

describe('POST /api/sync/stremio-login', () => {
  it('ok: chiama /api/login con type Login e salva solo la authKey', async () => {
    fetchMock().mockResolvedValue(json({ result: { authKey: AUTH_KEY, user: { email: 'me@example.com' } } }))
    const res = await login({ body: { email: ' me@example.com ', password: PASSWORD } })

    expect(fetchMock()).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock().mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('https://api.strem.io/api/login')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toMatchObject({ type: 'Login', email: 'me@example.com', password: PASSWORD })

    expect(storedKey()).toBe(AUTH_KEY)
    expect(res).toMatchObject({ ok: true, code: 'sync.stremio.loginDone' })
    // Né la password né la authKey tornano al browser
    expect(JSON.stringify(res)).not.toContain(PASSWORD)
    expect(JSON.stringify(res)).not.toContain(AUTH_KEY)
    expect(dbContainsPassword()).toBe(false)
    // La config mostra solo lo stato e la chiave mascherata
    const config = getConfig()
    expect(config.sync.stremio.has_auth_key).toBe(true)
    expect(JSON.stringify(config)).not.toContain(AUTH_KEY)
  })

  it('credenziali sbagliate: 401 con il motivo di Stremio, nulla salvato', async () => {
    fetchMock().mockResolvedValue(json({ error: { message: 'Wrong passphrase', code: 3 } }))
    const err = await thrown(() => login({ body: { email: 'me@example.com', password: PASSWORD } }))
    expect(err.statusCode).toBe(401)
    expect(err.data.code).toBe('sync.stremio.loginRejected')
    expect(err.data.params).toEqual({ detail: 'Wrong passphrase' })
    expect(JSON.stringify({ message: err.message, data: err.data })).not.toContain(PASSWORD)
    expect(storedKey()).toBeUndefined()
    expect(dbContainsPassword()).toBe(false)
  })

  it('errore di rete: 502, nulla salvato, nessuna password nel messaggio', async () => {
    fetchMock().mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }))
    const err = await thrown(() => login({ body: { email: 'me@example.com', password: PASSWORD } }))
    expect(err.statusCode).toBe(502)
    expect(err.data.code).toBe('sync.stremio.loginUnreachable')
    expect(err.data.params).toEqual({ detail: 'ENOTFOUND' })
    expect(JSON.stringify({ message: err.message, data: err.data })).not.toContain(PASSWORD)
    expect(storedKey()).toBeUndefined()
  })

  it('HTTP di errore senza corpo e risposta senza authKey: 502', async () => {
    fetchMock().mockResolvedValue(new Response('Bad gateway', { status: 503 }))
    let err = await thrown(() => login({ body: { email: 'me@example.com', password: PASSWORD } }))
    expect(err.statusCode).toBe(502)
    expect(err.data.code).toBe('sync.stremio.loginHttp')

    fetchMock().mockResolvedValue(json({ result: {} }))
    err = await thrown(() => login({ body: { email: 'me@example.com', password: PASSWORD } }))
    expect(err.statusCode).toBe(502)
    expect(err.data.code).toBe('sync.stremio.loginUnexpected')
    expect(storedKey()).toBeUndefined()
  })

  it('email o password mancanti: 400 senza chiamare Stremio', async () => {
    for (const body of [{}, { email: 'me@example.com' }, { password: PASSWORD }, { email: '  ', password: PASSWORD }]) {
      const err = await thrown(() => login({ body }))
      expect(err.statusCode).toBe(400)
      expect(err.data.code).toBe('sync.stremio.loginMissing')
    }
    expect(fetchMock()).not.toHaveBeenCalled()
  })

  it('un nuovo login sostituisce la authKey precedente', async () => {
    getDb().prepare("INSERT INTO config (key, value) VALUES ('stremio_auth_key', 'old-key')").run()
    fetchMock().mockResolvedValue(json({ result: { authKey: AUTH_KEY } }))
    await login({ body: { email: 'me@example.com', password: PASSWORD } })
    expect(storedKey()).toBe(AUTH_KEY)
  })
})
