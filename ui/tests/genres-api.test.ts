import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { seedShow } from './helpers'

// DB su file temporaneo: getDb() lo apre (e lo migra) al primo uso. Senza chiave TMDB le
// classifiche della Home restano vuote (nessuna chiamata di rete).
const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')
delete process.env.TMDB_API_KEY
for (const k of ['WATCHSENSE_LOCALE', 'TMDB_LANGUAGE', 'TMDB_REGION']) delete process.env[k]

// Gli handler Nitro usano gli auto-import di h3: qui bastano versioni minime
vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('getQuery', (event: any) => event.query || {})
vi.stubGlobal('readBody', async (event: any) => event.body)
vi.stubGlobal('createError', createError)

const { getDb } = await import('../server/utils/db')
const stats = (await import('../server/api/stats.get')).default as any
const showsList = (await import('../server/api/shows.get')).default as any
const showDetail = (await import('../server/api/shows/[tmdb_id].get')).default as any
const tasteProfile = (await import('../server/api/taste-profile.get')).default as any
const history = (await import('../server/api/recommendations/history.get')).default as any

afterAll(() => {
  vi.unstubAllGlobals()
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})

function setLocale(appLocale: 'it' | 'en') {
  getDb().prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('app_locale', ?)").run(appLocale)
}

beforeEach(() => {
  const db = getDb()
  db.exec('DELETE FROM shows; DELETE FROM recommendations; DELETE FROM recommendation_batches')
  // Generi canonici (inglesi), più una riga rimasta col nome italiano: conta insieme a "Drama"
  seedShow(db, { title: 'Dark', tmdb_id: 1, tmdb_name: 'Dark', tmdb_genres: '["Drama","Mystery","Sci-Fi & Fantasy"]' })
  seedShow(db, { title: 'Dark', tmdb_id: 1, tmdb_name: 'Dark', watched_at: '2024-01-02', episode_title: 'Episodio 2', tmdb_genres: '["Drama","Mystery","Sci-Fi & Fantasy"]' })
  seedShow(db, { title: 'Dexter', tmdb_id: 2, tmdb_name: 'Dexter', tmdb_genres: '["Crime","Dramma"]' })
  seedShow(db, { title: 'Bluey', tmdb_id: 3, tmdb_name: 'Bluey', tmdb_genres: '["Kids","Animation"]' })
})

describe('generi nelle risposte API, nella lingua dell\'app', () => {
  it('statistiche: nomi italiani con app_locale=it, inglesi con en, stessi conteggi', async () => {
    setLocale('it')
    const it = (await stats({})).genres
    expect(it).toContainEqual({ name: 'Dramma', count: 3 })
    expect(it).toContainEqual({ name: 'Mistero', count: 2 })
    expect(it).toContainEqual({ name: 'Bambini', count: 1 })
    expect(it.find((g: any) => g.name === 'Drama')).toBeUndefined()

    setLocale('en')
    const en = (await stats({})).genres
    expect(en).toContainEqual({ name: 'Drama', count: 3 })
    expect(en).toContainEqual({ name: 'Kids', count: 1 })
    expect(en.map((g: any) => g.count)).toEqual(it.map((g: any) => g.count))
  })

  it('libreria: generi e filtro localizzati; il filtro accetta il nome mostrato', async () => {
    setLocale('it')
    const all = await showsList({ query: {} })
    expect(all.availableGenres).toEqual(['Animazione', 'Bambini', 'Crime', 'Dramma', 'Fantascienza & Fantasy', 'Mistero'])
    expect(all.shows.find((s: any) => s.tmdb_id === 1).genres).toEqual(['Dramma', 'Mistero', 'Fantascienza & Fantasy'])

    const drama = await showsList({ query: { genre: 'Fantascienza & Fantasy' } })
    expect(drama.shows.map((s: any) => s.tmdb_id)).toEqual([1])

    setLocale('en')
    const en = await showsList({ query: { genre: 'Kids' } })
    expect(en.shows.map((s: any) => s.tmdb_id)).toEqual([3])
    expect(en.availableGenres).toContain('Sci-Fi & Fantasy')
  })

  it('scheda e profilo gusti: nomi italiani con app_locale=it', async () => {
    setLocale('it')
    const { show } = await showDetail({ context: { params: { tmdb_id: '2' } }, query: {} })
    expect(show.genres).toEqual(['Crime', 'Dramma'])

    const { profile } = tasteProfile({})
    const names = profile.topGenres.map((g: any) => g.name)
    expect(names[0]).toBe('Dramma')
    expect(names).not.toContain('Drama')

    setLocale('en')
    expect(tasteProfile({}).profile.topGenres[0].name).toBe('Drama')
  })

  it('cronologia dei consigli: generi dei batch vecchi (italiano) e nuovi (inglese) tradotti', () => {
    getDb().prepare(`INSERT INTO recommendation_batches (created_at, genre_filter, taste_snapshot, prompt_snapshot)
      VALUES (datetime('now'), ?, ?, '')`).run('Dramma', JSON.stringify({ topGenres: ['Dramma', 'Mystery'], avoidGenres: ['Kids'] }))
    setLocale('en')
    const [batch] = history({}).batches
    expect(batch.genre_filter).toBe('Drama')
    expect(batch.taste.topGenres).toEqual(['Drama', 'Mystery'])
    setLocale('it')
    const [again] = history({}).batches
    expect(again.taste.topGenres).toEqual(['Dramma', 'Mistero'])
    expect(again.taste.avoidGenres).toEqual(['Bambini'])
  })
})

describe('Home: classifiche della regione TMDB', () => {
  it('le classifiche non disponibili nella regione non compaiono né si scaricano', async () => {
    const set = getDb().prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('tmdb_region', ?)")
    set.run('ES')
    const es = await stats({})
    expect(es.home).not.toContain('nowtv')
    expect(es.home).not.toContain('paramount')
    expect(Object.keys(es.topByPlatform)).not.toContain('nowtv')
    expect(Object.keys(es.topByPlatform)).toContain('netflix')
    set.run('IT')
    expect((await stats({})).home).toContain('nowtv')
  })
})
