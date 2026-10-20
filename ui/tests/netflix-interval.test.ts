import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'

// Intervallo della sync Netflix: DB (Impostazioni) → env SYNC_INTERVAL_HOURS → 12

const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')

vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('readBody', async (event: any) => event.body)
vi.stubGlobal('createError', createError)

const { getDb } = await import('../server/utils/db')
const helpers = await import('../server/utils/sync-helpers')
const getConfig = (await import('../server/api/config.get')).default as any
const postConfig = (await import('../server/api/config.post')).default as any

const stored = () => (getDb().prepare("SELECT value FROM config WHERE key = 'netflix_sync_interval_hours'").get() as { value: string } | undefined)?.value

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
  delete process.env.SYNC_INTERVAL_HOURS
  getDb().prepare("DELETE FROM config WHERE key IN ('netflix_sync_interval_hours', 'last_cron_netflix', 'netflix_cookies')").run()
})

describe('getNetflixSyncIntervalHours', () => {
  it('default 12, poi env, poi DB', () => {
    expect(helpers.getNetflixSyncInterval()).toEqual({ hours: 12, source: 'default' })
    process.env.SYNC_INTERVAL_HOURS = '3'
    expect(helpers.getNetflixSyncInterval()).toEqual({ hours: 3, source: 'env' })
    getDb().prepare("INSERT INTO config (key, value) VALUES ('netflix_sync_interval_hours', '24')").run()
    expect(helpers.getNetflixSyncInterval()).toEqual({ hours: 24, source: 'db' })
    expect(helpers.getNetflixSyncIntervalHours()).toBe(24)
  })

  it('valori non validi in env o DB si ignorano', () => {
    process.env.SYNC_INTERVAL_HOURS = 'abc'
    getDb().prepare("INSERT INTO config (key, value) VALUES ('netflix_sync_interval_hours', '-5')").run()
    expect(helpers.getNetflixSyncInterval()).toEqual({ hours: 12, source: 'default' })
  })

  it('scelte: 6/12/24 più l\'env se diverso', () => {
    expect(helpers.netflixSyncIntervalChoices()).toEqual([6, 12, 24])
    process.env.SYNC_INTERVAL_HOURS = '12'
    expect(helpers.netflixSyncIntervalChoices()).toEqual([6, 12, 24])
    process.env.SYNC_INTERVAL_HOURS = '3'
    expect(helpers.netflixSyncIntervalChoices()).toEqual([3, 6, 12, 24])
  })

  it('prossima esecuzione: ultima + intervallo', () => {
    expect(helpers.nextScheduledRun('2026-10-20T06:00:00.000Z', 12)).toBe('2026-10-20T18:00:00.000Z')
    expect(helpers.nextScheduledRun(null, 12)).toBeNull()
    expect(helpers.nextScheduledRun('not a date', 12)).toBeNull()
  })
})

describe('POST /api/config: netflix.sync_interval_hours', () => {
  it('salva 6, 12 o 24 (anche come stringa) e GET lo riporta', async () => {
    await postConfig({ body: { netflix: { sync_interval_hours: 6 } } })
    expect(stored()).toBe('6')
    await postConfig({ body: { netflix: { sync_interval_hours: '24' } } })
    expect(stored()).toBe('24')
    const netflix = getConfig().sync.netflix
    expect(netflix).toMatchObject({ interval_hours: 24, interval_source: 'db', interval_choices: [6, 12, 24], env_interval_hours: null })
  })

  it('valori fuori elenco: 400 e nulla salvato (nemmeno il resto del body)', async () => {
    for (const value of [0, 1, 7, 48, -6, 'abc', true]) {
      const err = await thrown(() => postConfig({ body: { netflix: { sync_interval_hours: value, cookies: 'NetflixId=x' } } }))
      expect(err.statusCode).toBe(400)
      expect(err.data.code).toBe('errors.config.invalidSyncInterval')
    }
    expect(stored()).toBeUndefined()
    expect(getDb().prepare("SELECT value FROM config WHERE key = 'netflix_cookies'").get()).toBeUndefined()
  })

  it('il valore dell\'env è una scelta valida; null torna all\'env', async () => {
    process.env.SYNC_INTERVAL_HOURS = '3'
    await postConfig({ body: { netflix: { sync_interval_hours: 3 } } })
    expect(stored()).toBe('3')
    await postConfig({ body: { netflix: { sync_interval_hours: 24 } } })
    await postConfig({ body: { netflix: { sync_interval_hours: null } } })
    expect(stored()).toBeUndefined()
    expect(getConfig().sync.netflix).toMatchObject({ interval_hours: 3, interval_source: 'env', env_interval_hours: 3 })
  })

  it('lo scheduler legge il nuovo intervallo senza riavvio (stessa funzione, riletta dal DB)', async () => {
    await postConfig({ body: { netflix: { sync_interval_hours: 6 } } })
    expect(helpers.getNetflixSyncIntervalHours()).toBe(6)
    await postConfig({ body: { netflix: { sync_interval_hours: 12 } } })
    expect(helpers.getNetflixSyncIntervalHours()).toBe(12)
  })

  it('GET: prossima sync solo con i cookie salvati', async () => {
    getDb().prepare("INSERT INTO config (key, value) VALUES ('last_cron_netflix', '2026-10-20T06:00:00.000Z')").run()
    await postConfig({ body: { netflix: { sync_interval_hours: 6 } } })
    expect(getConfig().sync.netflix.next_run_at).toBeNull()
    await postConfig({ body: { netflix: { cookies: 'NetflixId=a; SecureNetflixId=b' } } })
    expect(getConfig().sync.netflix.next_run_at).toBe('2026-10-20T12:00:00.000Z')
  })
})
