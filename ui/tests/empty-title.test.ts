import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedShow } from './helpers'

const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')
process.env.TMDB_API_KEY = 'test-key'

const { getDb } = await import('../server/utils/db')
const { cleanTitle } = await import('../server/utils/ingest-normalize')
const { parseNetflix } = await import('../server/utils/csv-import')
const { moviesNote, rematchUnmatchedSeries, runIngest } = await import('../server/utils/ingest')
const { listUnmatchedSeries } = await import('../server/utils/manual-match')
const { seriesRows } = await import('../server/utils/series-filter')

// Nessuna chiamata TMDB deve partire per le righe senza titolo
const fakeFetch = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }))
vi.stubGlobal('fetch', fakeFetch)

afterAll(() => {
  vi.unstubAllGlobals()
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  getDb().exec('DELETE FROM shows')
  fakeFetch.mockClear()
})

describe('visioni senza titolo della serie', () => {
  it('Netflix " : Episodio 6": titolo vuoto', () => {
    expect(cleanTitle(' : Episodio 6', 'netflix')).toBe('')
    expect(cleanTitle(': Episodio 6', 'netflix')).toBe('')
    expect(cleanTitle('Dark: Stagione 1: Segreti', 'netflix')).toBe('Dark')
    const { records } = parseNetflix([['Title', 'Date'], [' : Episodio 6', '10/20/18'], ['Dark: Stagione 1: Segreti', '10/21/18']])
    expect(records.map(r => r.title)).toEqual(['', 'Dark'])
  })

  it('gli import le ignorano e le contano, senza errori né ricerche TMDB', async () => {
    const res = await runIngest([
      { title: '', platform: 'netflix', watchedAt: '2018-10-20', episodeTitle: ': Episodio 6', mediaType: 'tv' },
      { title: '   ', platform: 'prime', watchedAt: '2018-10-20', episodeTitle: 'E1', mediaType: 'tv' },
    ])
    expect(res).toMatchObject({ received: 2, inserted: 0, emptyTitle: 2, lookups: 0 })
    expect(fakeFetch).not.toHaveBeenCalled()
    expect((getDb().prepare('SELECT COUNT(*) c FROM shows').get() as any).c).toBe(0)
    expect(moviesNote(res)).toBe(' 2 visioni senza titolo della serie ignorate.')
  })

  it('le righe già salvate restano nel DB ma sono escluse dalle letture', async () => {
    const db = getDb()
    seedShow(db, { title: '', platform: 'netflix', episode_title: ': Episodio 6' })
    seedShow(db, { title: ' ', platform: 'netflix', episode_title: ': Episodio 7' })
    seedShow(db, { title: 'Dark', platform: 'netflix', episode_title: 'E1' })
    seedShow(db, { title: 'Film', platform: 'netflix', episode_title: '(film)', media_type: 'movie' })

    const visible = db.prepare(`SELECT title FROM shows s WHERE ${seriesRows('s')}`).all()
    expect(visible).toEqual([{ title: 'Dark' }])
    expect(listUnmatchedSeries().map(s => s.title)).toEqual(['Dark'])
    const rematch = await rematchUnmatchedSeries()
    expect(rematch.titlesTried).toBe(1)
    expect((db.prepare('SELECT COUNT(*) c FROM shows').get() as any).c).toBe(4)
  })
})
