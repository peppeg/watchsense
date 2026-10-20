import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'

// Segreti cifrati a riposo (AES-256-GCM): chiave master, lettori/scrittori, migrazione v13

const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')

vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('readBody', async (event: any) => event.body)
vi.stubGlobal('createError', createError)
vi.stubGlobal('fetch', vi.fn())

const { getDb } = await import('../server/utils/db')
const sk = await import('../server/utils/secret-key')
const secrets = await import('../server/utils/secrets')
const ingestToken = await import('../server/utils/ingest-token')
const llm = await import('../server/utils/llm')
const tmdb = await import('../server/utils/tmdb')
const { memoryDb } = await import('./helpers')
const { runMigrations } = await import('../server/db/migrate')
const { migrations } = await import('../server/db/migrations')
const getConfig = (await import('../server/api/config.get')).default as any
const postConfig = (await import('../server/api/config.post')).default as any
const stremioLogin = (await import('../server/api/sync/stremio-login.post')).default as any
const syncNetflix = (await import('../server/api/sync/netflix.post')).default as any
const syncStremio = (await import('../server/api/sync/stremio.post')).default as any
const regenerate = (await import('../server/api/sync/ingest-token/regenerate.post')).default as any

const TEST_ENV_KEY = process.env.WATCHSENSE_SECRET_KEY!
const OTHER_KEY = randomBytes(32)
const TMDB = 'c'.repeat(28) + '9abc'
const LLM_KEY = 'sk-test-llm-key-0123456789'
const STREMIO = 'stremio-auth-key-abcdef012345'
const COOKIES = 'NetflixId=nfid-secret-value; SecureNetflixId=snfid-secret-value'
const SECRET_ROWS = ['tmdb_api_key', 'stremio_auth_key', 'netflix_cookies', 'ingest_token']

const raw = (key: string) => (getDb().prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined)?.value
const putRaw = (key: string, value: string) => getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, value)
const fetchMock = () => vi.mocked(fetch)

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
  getDb().prepare(`DELETE FROM config WHERE key IN (${[...SECRET_ROWS, 'llm_config'].map(() => '?').join(', ')})`).run(...SECRET_ROWS, 'llm_config')
  fetchMock().mockReset()
})

describe('cifratura AES-256-GCM', () => {
  it('andata e ritorno, IV diverso a ogni cifratura, prefisso enc:v1:', () => {
    const a = sk.encryptSecret(COOKIES)
    const b = sk.encryptSecret(COOKIES)
    expect(a.startsWith('enc:v1:')).toBe(true)
    expect(a).not.toBe(b)
    expect(a).not.toContain('nfid-secret-value')
    expect(sk.decryptSecret(a)).toEqual({ ok: true, value: COOKIES, legacy: false })
    expect(sk.decryptSecret(sk.encryptSecret('àèì 🔑'))).toMatchObject({ ok: true, value: 'àèì 🔑' })
    expect(sk.encryptSecret('')).toBe('')
  })

  it('valore alterato (testo cifrato, tag o IV) o troncato: non decifrabile, nessuna eccezione', () => {
    const enc = sk.encryptSecret(STREMIO)
    const bytes = Buffer.from(enc.slice(7), 'base64')
    for (const pos of [0, 12, 28, bytes.length - 1]) { // IV, tag, testo cifrato
      const t = Buffer.from(bytes)
      t[pos]! ^= 0x01
      expect(sk.decryptSecret('enc:v1:' + t.toString('base64'))).toEqual({ ok: false })
    }
    expect(sk.decryptSecret('enc:v1:' + bytes.subarray(0, 20).toString('base64'))).toEqual({ ok: false })
    expect(sk.decryptSecret('enc:v1:@@@')).toEqual({ ok: false })
  })

  it('chiave sbagliata: non decifrabile', () => {
    expect(sk.decryptSecret(sk.encryptSecret(STREMIO, OTHER_KEY))).toEqual({ ok: false })
  })

  it('valore in chiaro di prima della cifratura: letto così com\'è', () => {
    expect(sk.decryptSecret(STREMIO)).toEqual({ ok: true, value: STREMIO, legacy: true })
    putRaw('stremio_auth_key', STREMIO)
    expect(secrets.getSecretConfig('stremio_auth_key')).toEqual({ value: STREMIO, unreadable: false })
  })
})

describe('chiave master', () => {
  const saved = { ...process.env }
  let keyDir: string
  beforeEach(() => {
    keyDir = mkdtempSync(join(tmpdir(), 'watchsense-key-'))
    delete process.env.WATCHSENSE_SECRET_KEY
    delete process.env.WATCHSENSE_SECRET_KEY_FILE
    sk.resetSecretKeyCache()
  })
  afterEach(() => {
    process.env.WATCHSENSE_SECRET_KEY = saved.WATCHSENSE_SECRET_KEY
    if (saved.WATCHSENSE_SECRET_KEY_FILE === undefined) delete process.env.WATCHSENSE_SECRET_KEY_FILE
    process.env.DATABASE_PATH = saved.DATABASE_PATH
    sk.resetSecretKeyCache()
    rmSync(keyDir, { recursive: true, force: true })
  })

  it('formati dell\'env: 64 hex, base64 (anche url-safe, senza padding); altrimenti errore', () => {
    const key = randomBytes(32)
    expect(sk.parseSecretKey(key.toString('hex'))).toEqual(key)
    expect(sk.parseSecretKey(key.toString('hex').toUpperCase())).toEqual(key)
    expect(sk.parseSecretKey(` ${key.toString('base64')}\n`)).toEqual(key)
    expect(sk.parseSecretKey(key.toString('base64url'))).toEqual(key)
    expect(sk.parseSecretKey('correct horse battery staple')).toBeNull()
    expect(sk.parseSecretKey(randomBytes(16).toString('base64'))).toBeNull()
    expect(sk.parseSecretKey(randomBytes(31).toString('hex') + 'ab0')).toBeNull()

    process.env.WATCHSENSE_SECRET_KEY = key.toString('base64')
    expect(sk.loadSecretKey()).toMatchObject({ key, source: 'env', path: null })
    sk.resetSecretKeyCache()
    process.env.WATCHSENSE_SECRET_KEY = 'passphrase'
    expect(() => sk.loadSecretKey()).toThrow(/WATCHSENSE_SECRET_KEY is not valid/)
  })

  it('l\'env ha la precedenza sul file', () => {
    const file = join(keyDir, 'secret.key')
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 })
    process.env.WATCHSENSE_SECRET_KEY_FILE = file
    process.env.WATCHSENSE_SECRET_KEY = TEST_ENV_KEY
    expect(sk.loadSecretKey().source).toBe('env')
  })

  it('file generato accanto al DB con permessi 0600, poi riletto senza rigenerarlo', () => {
    process.env.DATABASE_PATH = join(keyDir, 'sub', 'watchsense.db')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const first = sk.loadSecretKey()
    const file = join(keyDir, 'sub', 'secret.key')
    expect(first).toMatchObject({ source: 'generated', path: file })
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readdirSync(join(keyDir, 'sub'))).toEqual(['secret.key']) // nessun file temporaneo rimasto
    const content = readFileSync(file, 'utf8')
    expect(sk.parseSecretKey(content)).toEqual(first.key)

    sk.resetSecretKeyCache()
    const second = sk.loadSecretKey()
    expect(second).toMatchObject({ source: 'file', path: file })
    expect(second.key).toEqual(first.key)
    expect(readFileSync(file, 'utf8')).toBe(content)
    vi.restoreAllMocks()
  })

  it('WATCHSENSE_SECRET_KEY_FILE; permessi larghi riportati a 0600', () => {
    const file = join(keyDir, 'custom.key')
    const key = randomBytes(32)
    writeFileSync(file, key.toString('hex'), { mode: 0o644 })
    process.env.WATCHSENSE_SECRET_KEY_FILE = file
    expect(sk.loadSecretKey()).toMatchObject({ key, source: 'file', path: file })
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('file corrotto o vuoto: errore chiaro, il file non si sovrascrive', () => {
    const file = join(keyDir, 'secret.key')
    process.env.WATCHSENSE_SECRET_KEY_FILE = file
    for (const bad of ['not-a-key', '']) {
      writeFileSync(file, bad, { mode: 0o600 })
      sk.resetSecretKeyCache()
      expect(() => sk.loadSecretKey()).toThrow(/is not valid/)
      expect(readFileSync(file, 'utf8')).toBe(bad)
    }
  })
})

describe('chiave sbagliata o mancante: segreto non configurato, avviso senza valore', () => {
  it('lettori: vuoto + unreadable; GET /api/config lo segnala e non manda il testo cifrato', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const foreign = (v: string) => sk.encryptSecret(v, OTHER_KEY)
    putRaw('tmdb_api_key', foreign(TMDB))
    putRaw('stremio_auth_key', foreign(STREMIO))
    putRaw('netflix_cookies', foreign(COOKIES))
    putRaw('ingest_token', foreign('ab'.repeat(32)))
    putRaw('llm_config', JSON.stringify({ base_url: 'https://api.example.com/v1', api_key: foreign(LLM_KEY), model: 'm' }))
    const before = Object.fromEntries([...SECRET_ROWS, 'llm_config'].map(k => [k, raw(k)]))

    expect(secrets.getSecretConfig('netflix_cookies')).toEqual({ value: '', unreadable: true })
    expect(tmdb.getStoredTmdbKeyState()).toEqual({ value: '', unreadable: true })
    expect(llm.getStoredLlmState()).toMatchObject({ apiKeyUnreadable: true, config: { api_key: '' } })
    expect(ingestToken.isValidIngestToken('ab'.repeat(32))).toBe(false)

    const res = await getConfig({})
    expect(res.tmdb).toMatchObject({ has_api_key: false, masked_api_key: '', secret_unreadable: true })
    expect(res.llm).toMatchObject({ has_api_key: false, masked_api_key: '', secret_unreadable: true })
    expect(res.sync.stremio).toMatchObject({ has_auth_key: false, masked_auth_key: '', secret_unreadable: true, next_run_at: null })
    expect(res.sync.netflix).toMatchObject({ has_cookies: false, masked_cookies: '', secret_unreadable: true, next_run_at: null })
    expect(res.sync.bookmarklet).toMatchObject({ ingest_token: '', secret_unreadable: true })
    expect(JSON.stringify(res)).not.toContain('enc:v1:')

    // Nessun segreto riscritto o rigenerato da solo
    for (const [k, v] of Object.entries(before)) expect(raw(k)).toBe(v)
    // Avvisi: solo il nome, mai valori o testo cifrato
    const logged = warn.mock.calls.flat().join('\n')
    expect(logged).toContain('cannot be decrypted')
    for (const s of [TMDB, STREMIO, COOKIES, LLM_KEY, 'enc:v1:']) expect(logged).not.toContain(s)
    warn.mockRestore()
  })

  it('sync senza segreto leggibile: "non configurato", nessuna chiamata esterna', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    putRaw('netflix_cookies', sk.encryptSecret(COOKIES, OTHER_KEY))
    putRaw('stremio_auth_key', sk.encryptSecret(STREMIO, OTHER_KEY))
    expect((await thrown(() => syncNetflix({ body: {} }))).data.code).toBe('sync.netflix.noCookies')
    expect((await thrown(() => syncStremio({ body: {} }))).data.code).toBe('sync.stremio.noAuthKey')
    expect(fetchMock()).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('LLM: cambiare solo il modello conserva la chiave non decifrabile; una nuova chiave la sostituisce', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const foreign = sk.encryptSecret(LLM_KEY, OTHER_KEY)
    putRaw('llm_config', JSON.stringify({ base_url: 'https://api.example.com/v1', api_key: foreign, model: 'm' }))
    await postConfig({ body: { llm: { model: 'm2' } } })
    expect(JSON.parse(raw('llm_config')!)).toEqual({ base_url: 'https://api.example.com/v1', api_key: foreign, model: 'm2' })
    expect((await getConfig({})).llm.secret_unreadable).toBe(true)

    await postConfig({ body: { llm: { api_key: 'sk-new-key-987654321' } } })
    expect(llm.getStoredLlmState()).toMatchObject({ apiKeyUnreadable: false, config: { api_key: 'sk-new-key-987654321' } })
    expect((await getConfig({})).llm.secret_unreadable).toBe(false)
    vi.restoreAllMocks()
  })

  it('token del bookmarklet non decifrabile: la rigenerazione lo sostituisce', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    putRaw('ingest_token', sk.encryptSecret('ab'.repeat(32), OTHER_KEY))
    const res = await regenerate({})
    expect(res.token).toMatch(/^[0-9a-f]{64}$/)
    expect(ingestToken.isValidIngestToken(res.token)).toBe(true)
    expect((await getConfig({})).sync.bookmarklet).toMatchObject({ ingest_token: res.token, secret_unreadable: false })
    vi.restoreAllMocks()
  })
})

describe('ogni scrittore salva il testo cifrato', () => {
  /** Valore grezzo cifrato con la chiave dell'app, che si decifra in `expected`. */
  function expectEncrypted(stored: string | undefined, expected: string) {
    expect(stored?.startsWith('enc:v1:')).toBe(true)
    expect(stored).not.toContain(expected)
    expect(sk.decryptSecret(stored)).toMatchObject({ ok: true, value: expected })
  }

  it('POST /api/config: TMDB, LLM, Stremio, Netflix', async () => {
    await postConfig({ body: {
      tmdb: { api_key: TMDB },
      llm: { base_url: 'https://api.example.com/v1', api_key: LLM_KEY, model: 'm' },
      stremio: { auth_key: STREMIO },
      netflix: { cookies: COOKIES },
    } })
    expectEncrypted(raw('tmdb_api_key'), TMDB)
    expectEncrypted(raw('stremio_auth_key'), STREMIO)
    expectEncrypted(raw('netflix_cookies'), COOKIES)
    const llmRow = JSON.parse(raw('llm_config')!)
    expect(llmRow).toMatchObject({ base_url: 'https://api.example.com/v1', model: 'm' })
    expectEncrypted(llmRow.api_key, LLM_KEY)
    // E le letture li restituiscono in chiaro al server
    expect(tmdb.getTmdbKey()).toBe(TMDB)
    expect(llm.getLlmConfig().api_key).toBe(LLM_KEY)

    // Cancellazione: stringa vuota (o riga tolta per TMDB)
    await postConfig({ body: { stremio: { auth_key: '', clear_auth_key: true }, netflix: { cookies: '', clear_cookies: true }, tmdb: { api_key: '', clear_api_key: true } } })
    expect(raw('stremio_auth_key')).toBe('')
    expect(raw('netflix_cookies')).toBe('')
    expect(raw('tmdb_api_key')).toBeUndefined()
  })

  it('login Stremio', async () => {
    fetchMock().mockResolvedValue(new Response(JSON.stringify({ result: { authKey: STREMIO } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await stremioLogin({ body: { email: 'me@example.com', password: 'pw-secret' } })
    expectEncrypted(raw('stremio_auth_key'), STREMIO)
  })

  it('token del bookmarklet (generato alla prima lettura e rigenerato)', async () => {
    const token = ingestToken.getIngestToken()
    expectEncrypted(raw('ingest_token'), token)
    expect(ingestToken.isValidIngestToken(token)).toBe(true)
    expect(ingestToken.getIngestToken()).toBe(token)
    const res = await regenerate({})
    expectEncrypted(raw('ingest_token'), res.token)
    expect(ingestToken.isValidIngestToken(token)).toBe(false)
  })

  it('le sync leggono il segreto decifrato (fetch simulato)', async () => {
    secrets.setSecretConfig('netflix_cookies', COOKIES)
    secrets.setSecretConfig('stremio_auth_key', STREMIO)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock().mockResolvedValue(new Response('', { status: 401 }))
    await thrown(() => syncNetflix({ body: {} }))
    const [, nfInit] = fetchMock().mock.calls[0]! as [string, RequestInit]
    expect((nfInit.headers as Record<string, string>).Cookie).toContain('nfid-secret-value')
    fetchMock().mockClear()
    await thrown(() => syncStremio({ body: {} }))
    const [, stInit] = fetchMock().mock.calls[0]! as [string, RequestInit]
    expect(JSON.parse(String(stInit.body)).authKey).toBe(STREMIO)
    vi.restoreAllMocks()
  })

  it('nessun lettore o scrittore dei segreti fuori da utils/secrets.ts (controllo sul sorgente)', () => {
    const root = join(import.meta.dirname, '..', 'server')
    const files: string[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name))
        else if (e.name.endsWith('.ts')) files.push(join(d, e.name))
      }
    }
    walk(root)
    const allowed = new Set(['utils/secrets.ts', 'utils/llm.ts', 'db/migrations/013_encrypt_secrets.ts'])
    const secretRef = /'(tmdb_api_key|stremio_auth_key|netflix_cookies|ingest_token|llm_config)'|TMDB_KEY_CONFIG_KEY/
    const rawAccess = /prepare\(|setConfig\.run|getConfig\(/
    const offenders: string[] = []
    for (const f of files) {
      const rel = relative(root, f)
      if (allowed.has(rel)) continue
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (secretRef.test(line) && rawAccess.test(line)) offenders.push(`${rel}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

describe('GET /api/config: mai segreti in chiaro né testo cifrato', () => {
  it('solo maschere calcolate dal valore decifrato (il token del bookmarklet serve in chiaro alla UI)', async () => {
    secrets.setSecretConfig('tmdb_api_key', TMDB)
    secrets.setSecretConfig('stremio_auth_key', STREMIO)
    secrets.setSecretConfig('netflix_cookies', COOKIES)
    llm.saveStoredLlmConfig({ base_url: 'https://api.example.com/v1', api_key: LLM_KEY, model: 'm' })
    const res = await getConfig({})
    const json = JSON.stringify(res)
    for (const s of [TMDB, STREMIO, COOKIES, LLM_KEY, 'nfid-secret-value', 'enc:v1:']) expect(json).not.toContain(s)
    expect(res.tmdb.masked_api_key).toBe('cccc••••••••9abc')
    expect(res.sync.stremio.masked_auth_key).toBe('stre••••••••2345')
    expect(res.sync.netflix.masked_cookies).toBe(`${COOKIES.slice(0, 4)}••••••••${COOKIES.slice(-4)}`)
    expect(res.llm.masked_api_key).toBe('sk-t••••••••6789')
    expect(res.sync.bookmarklet.ingest_token).toMatch(/^[0-9a-f]{64}$/)
    for (const g of [res.tmdb, res.llm, res.sync.stremio, res.sync.netflix, res.sync.bookmarklet]) expect(g.secret_unreadable).toBe(false)
  })
})

describe('migrazione v13 (encrypt_secrets)', () => {
  function seedV12() {
    const db = memoryDb(12)
    const ins = db.prepare('INSERT INTO config (key, value) VALUES (?, ?)')
    ins.run('tmdb_api_key', TMDB)
    ins.run('stremio_auth_key', '')
    ins.run('netflix_cookies', COOKIES)
    ins.run('ingest_token', 'ab'.repeat(32))
    ins.run('llm_config', JSON.stringify({ base_url: 'https://api.example.com/v1', api_key: LLM_KEY, model: 'm' }))
    ins.run('app_locale', 'it')
    ins.run('last_sync_status_netflix', '{"ok":true}')
    return db
  }
  const rows = (db: any) => Object.fromEntries((db.prepare('SELECT key, value FROM config ORDER BY key').all() as { key: string, value: string }[]).map(r => [r.key, r.value]))
  const plain = (v: string) => sk.decryptSecret(v)

  it('cifra i valori in chiaro, lascia vuoti e righe non segrete; idempotente', () => {
    const db = seedV12()
    runMigrations(db, migrations)
    expect(db.pragma('user_version', { simple: true })).toBe(13)
    const after = rows(db)
    expect(after.app_locale).toBe('it')
    expect(after.last_sync_status_netflix).toBe('{"ok":true}')
    expect(after.stremio_auth_key).toBe('')
    for (const [k, v] of [['tmdb_api_key', TMDB], ['netflix_cookies', COOKIES], ['ingest_token', 'ab'.repeat(32)]] as const) {
      expect(after[k]!.startsWith('enc:v1:')).toBe(true)
      expect(plain(after[k]!)).toMatchObject({ ok: true, value: v })
    }
    const llmRow = JSON.parse(after.llm_config!)
    expect(llmRow).toMatchObject({ base_url: 'https://api.example.com/v1', model: 'm' })
    expect(plain(llmRow.api_key)).toMatchObject({ ok: true, value: LLM_KEY })

    // Riapplicata: nessun valore cambia (niente doppia cifratura)
    db.pragma('user_version = 12')
    runMigrations(db, migrations)
    expect(rows(db)).toEqual(after)
    db.close()
  })

  it('mix di valori già cifrati e in chiaro; llm_config non valido lasciato com\'è', () => {
    const db = seedV12()
    const already = sk.encryptSecret(STREMIO)
    db.prepare("UPDATE config SET value = ? WHERE key = 'stremio_auth_key'").run(already)
    db.prepare("UPDATE config SET value = 'not json' WHERE key = 'llm_config'").run()
    runMigrations(db, migrations)
    const after = rows(db)
    expect(after.stremio_auth_key).toBe(already)
    expect(after.llm_config).toBe('not json')
    expect(plain(after.tmdb_api_key!)).toMatchObject({ ok: true, value: TMDB })
    expect(Object.keys(after).length).toBe(7)
    db.close()
  })

  it('senza chiave valida la migrazione va in rollback e il DB resta alla v12', () => {
    const db = seedV12()
    const before = rows(db)
    sk.resetSecretKeyCache()
    process.env.WATCHSENSE_SECRET_KEY = 'not-a-key'
    try {
      expect(() => runMigrations(db, migrations)).toThrow(/v13 \(encrypt_secrets\) failed and was rolled back/)
    } finally {
      process.env.WATCHSENSE_SECRET_KEY = TEST_ENV_KEY
      sk.resetSecretKeyCache()
    }
    expect(db.pragma('user_version', { simple: true })).toBe(12)
    expect(rows(db)).toEqual(before)
    db.close()
  })
})

describe('permessi dei file', () => {
  it('DB, -wal e -shm a 0600', () => {
    getDb()
    for (const suffix of ['', '-wal', '-shm']) {
      const p = process.env.DATABASE_PATH! + suffix
      try {
        expect(statSync(p).mode & 0o777).toBe(0o600)
      } catch (e: any) {
        if (e?.code !== 'ENOENT') throw e
      }
    }
    expect(statSync(process.env.DATABASE_PATH!).mode & 0o777).toBe(0o600)
  })
})
