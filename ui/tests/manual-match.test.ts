import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedShow } from './helpers'

// DB su file temporaneo: getDb() lo apre (e lo migra) al primo uso
const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')
process.env.TMDB_API_KEY = 'test-key'

const { getDb } = await import('../server/utils/db')
const { applyManualMatch, listUnmatchedSeries, MatchError, parseMatchRequest } = await import('../server/utils/manual-match')
const { runIngest, rematchUnmatchedSeries } = await import('../server/utils/ingest')
const { searchTmdbTvCandidates } = await import('../server/utils/sync-helpers')

/** Serie TMDB finte: id → dettagli /tv/{id}. */
const SERIES: Record<number, { name: string; genres: string[] }> = {
  790: { name: "Poirot", genres: ['Crime'] },
  1000: { name: 'Serie Sbagliata', genres: ['Commedia'] },
}

const calls: string[] = []
let searchResults: any[] = []
let tmdbDown = false

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const fakeFetch = vi.fn(async (input: string | URL) => {
  const url = new URL(String(input))
  calls.push(url.pathname)
  if (tmdbDown) return json({ status_message: 'down' }, 503)
  if (url.pathname.startsWith('/3/search/')) return json({ results: searchResults })
  const m = /^\/3\/tv\/(\d+)(\/keywords|\/watch\/providers)?$/.exec(url.pathname)
  if (!m) return json({}, 404)
  const s = SERIES[Number(m[1])]
  if (!s) return json({ status_message: 'not found' }, 404)
  if (m[2] === '/keywords') return json({ results: [{ name: 'detective' }] })
  if (m[2] === '/watch/providers') return json({ results: { IT: { flatrate: [{ provider_name: 'Prime Video' }] } } })
  return json({
    id: Number(m[1]), name: s.name, genres: s.genres.map(name => ({ name })), overview: `Trama di ${s.name}`,
    vote_average: 8, status: 'Ended', poster_path: `/p${m[1]}.jpg`, number_of_episodes: 70, number_of_seasons: 13,
    first_air_date: '1989-01-08',
  })
})

beforeAll(() => { vi.stubGlobal('fetch', fakeFetch) })
afterAll(() => {
  vi.unstubAllGlobals()
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  getDb().exec('DELETE FROM shows')
  calls.length = 0
  searchResults = []
  tmdbDown = false
})

const rows = (where = '1 = 1') =>
  getDb().prepare(`SELECT title, platform, tmdb_id, media_type, tmdb_name, tmdb_genres FROM shows WHERE ${where} ORDER BY id`).all() as any[]

describe('parseMatchRequest', () => {
  it('accetta serie non abbinate e serie da correggere', () => {
    expect(parseMatchRequest({ tmdb_id: 790, title: 'Poirot', platform: 'prime' }))
      .toEqual({ tmdbId: 790, target: { kind: 'unmatched', title: 'Poirot', platform: 'prime' } })
    expect(parseMatchRequest({ tmdb_id: '790', from_tmdb_id: 1000 }))
      .toEqual({ tmdbId: 790, target: { kind: 'matched', fromTmdbId: 1000 } })
  })

  it('rifiuta input non validi con 400', () => {
    for (const body of [null, [], {}, { tmdb_id: -1, title: 'x', platform: 'p' }, { tmdb_id: 1.5, title: 'x', platform: 'p' },
      { tmdb_id: 1, title: '  ', platform: 'prime' }, { tmdb_id: 1, title: 'x' }, { tmdb_id: 1, from_tmdb_id: 'abc' },
      { tmdb_id: 7, from_tmdb_id: 7 }]) {
      expect(() => parseMatchRequest(body), JSON.stringify(body)).toThrow(MatchError)
      try { parseMatchRequest(body) } catch (e: any) { expect(e.statusCode).toBe(400) }
    }
  })
})

describe('titoli solo "Stagione N"', () => {
  it('restano non abbinati: esclusi dalla lista e rifiutati con 400', () => {
    const db = getDb()
    seedShow(db, { title: 'Stagione 1', episode_title: 'A' })
    seedShow(db, { title: 'Stagione 01', episode_title: 'B' })
    seedShow(db, { title: 'Season 01', episode_title: 'C', platform: 'netflix' })
    seedShow(db, { title: 'Poirot', episode_title: 'E1' })
    expect(listUnmatchedSeries().map(s => s.title)).toEqual(['Poirot'])
    for (const title of ['Stagione 1', 'Stagione 01', ' season  01 ']) {
      try {
        parseMatchRequest({ tmdb_id: 790, title, platform: 'prime' })
        expect.unreachable(title)
      } catch (e: any) {
        expect(e).toBeInstanceOf(MatchError)
        expect(e.statusCode).toBe(400)
        expect(e.message).toMatch(/stagione/i)
      }
    }
    // la correzione di una serie già abbinata non dipende dal titolo
    expect(parseMatchRequest({ tmdb_id: 790, from_tmdb_id: 1000 }).target.kind).toBe('matched')
  })
})

describe('applyManualMatch', () => {
  it('abbina tutte le righe tv senza id con stesso titolo e piattaforma, con i metadati', async () => {
    const db = getDb()
    seedShow(db, { title: "Agatha Christie's Poirot", episode_title: 'E1' })
    seedShow(db, { title: "Agatha Christie's Poirot", episode_title: 'E2' })
    seedShow(db, { title: "Agatha Christie's Poirot", episode_title: 'E1', platform: 'netflix' })
    seedShow(db, { title: "Agatha Christie's Poirot", episode_title: '(film)', media_type: 'movie' })

    expect(listUnmatchedSeries().map(s => [s.title, s.platform, s.episode_count]))
      .toEqual(expect.arrayContaining([["Agatha Christie's Poirot", 'prime', 2], ["Agatha Christie's Poirot", 'netflix', 1]]))

    const res = await applyManualMatch(790, { kind: 'unmatched', title: "Agatha Christie's Poirot", platform: 'prime' })
    expect(res).toEqual({ tmdbId: 790, name: 'Poirot', rows: 2 })
    expect(rows("platform = 'prime' AND media_type = 'tv'")).toEqual([
      expect.objectContaining({ tmdb_id: 790, tmdb_name: 'Poirot', tmdb_genres: '["Crime"]' }),
      expect.objectContaining({ tmdb_id: 790, tmdb_name: 'Poirot', tmdb_genres: '["Crime"]' }),
    ])
    // altra piattaforma e film non toccati
    expect(rows("platform = 'netflix'")[0].tmdb_id).toBeNull()
    expect(rows("media_type = 'movie'")[0].tmdb_id).toBeNull()
    expect(calls.some(p => p.startsWith('/3/search/'))).toBe(false)
  })

  it('corregge un abbinamento sbagliato: righe e metadati passano al nuovo id', async () => {
    const db = getDb()
    seedShow(db, { title: 'Poirot', episode_title: 'E1', tmdb_id: 1000, tmdb_name: 'Serie Sbagliata', tmdb_genres: '["Commedia"]' })
    seedShow(db, { title: 'Poirot', episode_title: 'E2', platform: 'netflix', tmdb_id: 1000, tmdb_name: 'Serie Sbagliata', tmdb_genres: '["Commedia"]' })
    seedShow(db, { title: 'Altro film', episode_title: '(film)', tmdb_id: 1000, media_type: 'movie' })

    const res = await applyManualMatch(790, { kind: 'matched', fromTmdbId: 1000 })
    expect(res.rows).toBe(2)
    expect(rows("media_type = 'tv'")).toEqual([
      expect.objectContaining({ platform: 'prime', tmdb_id: 790, tmdb_name: 'Poirot', tmdb_genres: '["Crime"]' }),
      expect.objectContaining({ platform: 'netflix', tmdb_id: 790, tmdb_name: 'Poirot', tmdb_genres: '["Crime"]' }),
    ])
    expect(rows("media_type = 'movie'")[0].tmdb_id).toBe(1000)
  })

  it('TMDB non raggiungibile o gruppo vuoto: errore e nessuna modifica', async () => {
    const db = getDb()
    seedShow(db, { title: 'Poirot', episode_title: 'E1' })
    tmdbDown = true
    await expect(applyManualMatch(790, { kind: 'unmatched', title: 'Poirot', platform: 'prime' }))
      .rejects.toMatchObject({ statusCode: 502 })
    expect(rows()[0].tmdb_id).toBeNull()
    tmdbDown = false
    await expect(applyManualMatch(12345, { kind: 'unmatched', title: 'Poirot', platform: 'prime' }))
      .rejects.toMatchObject({ statusCode: 502 })
    await expect(applyManualMatch(790, { kind: 'unmatched', title: 'Nessuna', platform: 'prime' }))
      .rejects.toMatchObject({ statusCode: 404 })
    expect(rows()[0].tmdb_id).toBeNull()
  })
})

describe('abbinamento manuale e processi automatici', () => {
  it('un import successivo eredita l\'abbinamento invece di cercare su TMDB', async () => {
    const db = getDb()
    seedShow(db, { title: 'Poirot', episode_title: 'E1' })
    await applyManualMatch(790, { kind: 'unmatched', title: 'Poirot', platform: 'prime' })
    calls.length = 0
    searchResults = [{ id: 1000, name: 'Poirot' }] // la ricerca darebbe la serie sbagliata

    const res = await runIngest([
      { title: 'Poirot', platform: 'prime', watchedAt: '2024-03-01', episodeTitle: 'E2', mediaType: 'tv' },
      { title: 'Poirot', platform: 'netflix', watchedAt: '2024-03-01', episodeTitle: 'E2', mediaType: 'tv' },
    ])
    expect(res.inherited).toBe(1)
    expect(rows("platform = 'prime'").map(r => [r.tmdb_id, r.tmdb_genres])).toEqual([[790, '["Crime"]'], [790, '["Crime"]']])
    // l'altra piattaforma non ha un abbinamento: ricerca normale
    expect(rows("platform = 'netflix'")[0].tmdb_id).toBe(1000)
    expect(calls.filter(p => p.startsWith('/3/search/'))).toEqual(['/3/search/tv'])
  })

  it('titoli solo "Stagione N" o con abbinamenti diversi non ereditano', async () => {
    const db = getDb()
    seedShow(db, { title: 'Stagione 1', episode_title: 'A', tmdb_id: 790 })
    seedShow(db, { title: 'Doppia', episode_title: 'A', tmdb_id: 790 })
    seedShow(db, { title: 'Doppia', episode_title: 'B', tmdb_id: 1000 })
    const res = await runIngest([
      { title: 'Stagione 1', platform: 'prime', watchedAt: '2024-03-01', episodeTitle: 'X', mediaType: 'tv' },
      { title: 'Doppia', platform: 'prime', watchedAt: '2024-03-01', episodeTitle: 'X', mediaType: 'tv' },
    ])
    expect(res.inherited).toBe(0)
    expect(res.lookups).toBe(2)
  })

  it('il riabbinamento automatico non tocca le serie abbinate a mano', async () => {
    const db = getDb()
    seedShow(db, { title: 'Poirot', episode_title: 'E1' })
    await applyManualMatch(790, { kind: 'unmatched', title: 'Poirot', platform: 'prime' })
    searchResults = [{ id: 1000, name: 'Poirot' }]
    const res = await rematchUnmatchedSeries()
    expect(res.titlesTried).toBe(0)
    expect(rows()[0].tmdb_id).toBe(790)
  })

  it('gli import decodificano le entità HTML negli episode_title', async () => {
    await runIngest([{ title: "Poirot", platform: 'prime', watchedAt: '2024-03-01', episodeTitle: 'Agatha Christie&#39;s Poirot: Episodio 1', mediaType: 'movie' }])
    expect(getDb().prepare('SELECT episode_title FROM shows').get()).toEqual({ episode_title: "Agatha Christie's Poirot: Episodio 1" })
  })
})

describe('searchTmdbTvCandidates', () => {
  it('restituisce i campi per la scelta, trama accorciata', async () => {
    searchResults = [
      { id: 790, name: 'Poirot', original_name: "Agatha Christie's Poirot", first_air_date: '1989-01-08', poster_path: '/p.jpg', overview: 'x'.repeat(500) },
      { id: 5, name: 'Same', original_name: 'Same', first_air_date: '', poster_path: null, overview: null },
      { name: 'senza id' },
    ]
    const res = await searchTmdbTvCandidates('Poirot')
    expect(res).toHaveLength(2)
    expect(res[0]).toMatchObject({ id: 790, name: 'Poirot', original_name: "Agatha Christie's Poirot", first_air_date: '1989-01-08', poster_path: '/p.jpg' })
    expect(res[0]!.overview.length).toBeLessThanOrEqual(220)
    expect(res[1]).toEqual({ id: 5, name: 'Same', original_name: null, first_air_date: null, poster_path: null, overview: '' })
    expect(calls).toEqual(['/3/search/tv'])
  })

  it('TMDB in errore: eccezione', async () => {
    tmdbDown = true
    await expect(searchTmdbTvCandidates('Poirot')).rejects.toThrow()
  })
})
