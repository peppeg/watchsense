import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { memoryDb, seedShow } from './helpers'
import { getSchemaVersion, runMigrations } from '../server/db/migrate'
import { migrations } from '../server/db/migrations'

// DB su file temporaneo: getDb() lo apre (e lo migra) al primo uso
const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')

// Gli handler Nitro usano gli auto-import di h3: qui bastano versioni minime
vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('readBody', async (event: any) => event.body)
vi.stubGlobal('createError', createError)

const { getDb } = await import('../server/utils/db')
const { getLocaleConfig, normalizeAppLocale, normalizeTmdbLanguage, normalizeTmdbRegion, SUPPORTED_LOCALES } =
  await import('../server/utils/locale')
const getConfig = (await import('../server/api/config.get')).default as any
const postConfig = (await import('../server/api/config.post')).default as any

const ENV_KEYS = ['WATCHSENSE_LOCALE', 'TMDB_LANGUAGE', 'TMDB_REGION'] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k]
}

afterAll(() => {
  vi.unstubAllGlobals()
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(clearEnv)
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

const configValue = (db: ReturnType<typeof memoryDb>, key: string) =>
  (db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined)?.value

describe('validazione', () => {
  it('lingua dell\'app: solo en e it', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'it'])
    expect(normalizeAppLocale('it')).toBe('it')
    expect(normalizeAppLocale(' EN ')).toBe('en')
    expect(normalizeAppLocale('de')).toBeNull()
    expect(normalizeAppLocale('it-IT')).toBeNull()
    expect(normalizeAppLocale(1)).toBeNull()
  })

  it('lingua TMDB nella forma xx-YY, con maiuscole normalizzate', () => {
    expect(normalizeTmdbLanguage('it-IT')).toBe('it-IT')
    expect(normalizeTmdbLanguage('EN-gb')).toBe('en-GB')
    expect(normalizeTmdbLanguage('it')).toBeNull()
    expect(normalizeTmdbLanguage('it_IT')).toBeNull()
    expect(normalizeTmdbLanguage('ita-ITA')).toBeNull()
    expect(normalizeTmdbLanguage(null)).toBeNull()
  })

  it('regione TMDB: due lettere, in maiuscolo', () => {
    expect(normalizeTmdbRegion('IT')).toBe('IT')
    expect(normalizeTmdbRegion('gb')).toBe('GB')
    expect(normalizeTmdbRegion('ITA')).toBeNull()
    expect(normalizeTmdbRegion('1T')).toBeNull()
    expect(normalizeTmdbRegion('')).toBeNull()
  })
})

describe('getLocaleConfig', () => {
  it('senza DB né env: default inglesi', () => {
    expect(getLocaleConfig(memoryDb())).toEqual({ appLocale: 'en', tmdbLanguage: 'en-US', tmdbRegion: 'US' })
  })

  it('env come valore iniziale, normalizzato', () => {
    process.env.WATCHSENSE_LOCALE = 'it'
    process.env.TMDB_LANGUAGE = 'de-de'
    process.env.TMDB_REGION = 'de'
    expect(getLocaleConfig(memoryDb())).toEqual({ appLocale: 'it', tmdbLanguage: 'de-DE', tmdbRegion: 'DE' })
  })

  it('il valore in DB vince sull\'env', () => {
    process.env.WATCHSENSE_LOCALE = 'en'
    process.env.TMDB_LANGUAGE = 'en-GB'
    process.env.TMDB_REGION = 'GB'
    const db = memoryDb()
    const set = db.prepare('INSERT INTO config (key, value) VALUES (?, ?)')
    set.run('app_locale', 'it')
    set.run('tmdb_language', 'it-IT')
    set.run('tmdb_region', 'IT')
    expect(getLocaleConfig(db)).toEqual({ appLocale: 'it', tmdbLanguage: 'it-IT', tmdbRegion: 'IT' })
  })

  it('un valore non valido passa al successivo della catena', () => {
    process.env.WATCHSENSE_LOCALE = 'it'
    process.env.TMDB_LANGUAGE = 'francese'
    const db = memoryDb()
    const set = db.prepare('INSERT INTO config (key, value) VALUES (?, ?)')
    set.run('app_locale', 'de')
    set.run('tmdb_language', 'xx')
    set.run('tmdb_region', 'Italia')
    expect(getLocaleConfig(db)).toEqual({ appLocale: 'it', tmdbLanguage: 'en-US', tmdbRegion: 'US' })
  })
})

describe('migrazione v10 (locale_defaults)', () => {
  it('DB con cronologia: scrive it / it-IT / IT e porta user_version a 10', () => {
    const db = memoryDb(9)
    seedShow(db, { title: 'Dark' })
    runMigrations(db, migrations.slice(0, 10))
    expect(getSchemaVersion(db)).toBe(10)
    expect(configValue(db, 'app_locale')).toBe('it')
    expect(configValue(db, 'tmdb_language')).toBe('it-IT')
    expect(configValue(db, 'tmdb_region')).toBe('IT')
    expect(getLocaleConfig(db)).toEqual({ appLocale: 'it', tmdbLanguage: 'it-IT', tmdbRegion: 'IT' })
  })

  it('DB vuoto (installazione nuova): nessuna scrittura, default inglesi', () => {
    const db = memoryDb(9)
    runMigrations(db, migrations.slice(0, 10))
    expect(getSchemaVersion(db)).toBe(10)
    expect(db.prepare("SELECT COUNT(*) AS n FROM config WHERE key IN ('app_locale', 'tmdb_language', 'tmdb_region')").get())
      .toEqual({ n: 0 })
    expect(getLocaleConfig(db).appLocale).toBe('en')
  })

  it('non sovrascrive valori già presenti ed è idempotente', () => {
    const db = memoryDb(9)
    seedShow(db, { title: 'Dark' })
    db.prepare("INSERT INTO config (key, value) VALUES ('app_locale', 'en')").run()
    const v10 = migrations[9]!
    v10.up(db)
    v10.up(db)
    expect(configValue(db, 'app_locale')).toBe('en')
    expect(configValue(db, 'tmdb_language')).toBe('it-IT')
    expect(configValue(db, 'tmdb_region')).toBe('IT')
    expect(db.prepare("SELECT COUNT(*) AS n FROM config WHERE key IN ('app_locale', 'tmdb_language', 'tmdb_region')").get())
      .toEqual({ n: 3 })
  })
})

describe('API config', () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM config WHERE key IN ('app_locale', 'tmdb_language', 'tmdb_region')")
  })

  it('GET espone i valori effettivi e le lingue supportate', () => {
    expect(getConfig().locale).toEqual({
      app_locale: 'en', tmdb_language: 'en-US', tmdb_region: 'US', configured: false, supported_locales: ['en', 'it'],
      chart_regions: expect.arrayContaining(['IT', 'US', 'GB']),
    })
  })

  it('POST salva i valori normalizzati', async () => {
    await postConfig({ body: { locale: { app_locale: 'it', tmdb_language: 'it-it', tmdb_region: 'it' } } })
    expect(getConfig().locale).toMatchObject({ app_locale: 'it', tmdb_language: 'it-IT', tmdb_region: 'IT' })
  })

  it('POST rifiuta un valore non valido con 400 senza salvare nulla', async () => {
    await expect(postConfig({ body: { locale: { app_locale: 'it', tmdb_region: 'Italia' } } }))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(postConfig({ body: { locale: { app_locale: 'fr' } } })).rejects.toMatchObject({ statusCode: 400 })
    await expect(postConfig({ body: { locale: { tmdb_language: 'it' } } })).rejects.toMatchObject({ statusCode: 400 })
    expect(getConfig().locale.app_locale).toBe('en')
  })
})
