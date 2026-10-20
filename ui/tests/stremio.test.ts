import zlib from 'node:zlib'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedShow } from './helpers'

const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')
process.env.TMDB_API_KEY = 'test-key'

const { getDb } = await import('../server/utils/db')
const { runIngest } = await import('../server/utils/ingest')
const {
  extractStremioWatchedEpisodes,
  hasStremioWatchHistory,
  reconcileStremioRows,
  stremioEpisodeTitle,
  watchedVideoIds,
} = await import('../server/utils/stremio')

// Nessuna chiamata di rete reale: TMDB risponde "nessun risultato"
const fakeFetch = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 }))
vi.stubGlobal('fetch', fakeFetch)

afterAll(() => {
  vi.unstubAllGlobals()
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  getDb().exec('DELETE FROM shows')
})

/** Bitfield serializzato come stremio-core: "<àncora>:<lunghezza>:<base64 zlib>". */
function bitfield(anchor: string, length: number, bits: number[]): string {
  const buf = Buffer.alloc(Math.ceil(length / 8))
  for (const b of bits) buf[b >> 3]! |= 1 << (b & 7)
  return `${anchor}:${length}:${zlib.deflateSync(buf).toString('base64')}`
}

/** Episodi "tt1:S:E" per stagioni di `perSeason` episodi, speciali (stagione 0) in testa. */
function videoList(id: string, seasons: number[], specials = 0): string[] {
  const list: string[] = []
  for (let e = 1; e <= specials; e++) list.push(`${id}:0:${e}`)
  seasons.forEach((count, s) => {
    for (let e = 1; e <= count; e++) list.push(`${id}:${s + 1}:${e}`)
  })
  return list
}

const BARRY = 'tt5348176'
// Valore reale di Barry: S1–S3 complete + S4E1 (25 bit), S4E2 in corso
const BARRY_WATCHED = 'tt5348176:4:1:25:eJz7//8/IwAI/AL/'

describe('watchedVideoIds', () => {
  it('Barry: i 25 bit coprono tutte le stagioni, non solo la stagione dell\'àncora', () => {
    const ids = watchedVideoIds(BARRY_WATCHED, videoList(BARRY, [8, 8, 8, 8]))!
    expect(ids).toHaveLength(25)
    expect(ids[0]).toBe(`${BARRY}:1:1`)
    expect(ids).toContain(`${BARRY}:3:8`)
    expect(ids[24]).toBe(`${BARRY}:4:1`)
  })

  it('riallinea con l\'àncora se la lista è cambiata (speciali aggiunti dopo)', () => {
    // Salvato quando c'erano solo gli 8 episodi; ora 16 speciali in testa
    const watched = bitfield('tt1:1:8', 8, [0, 1, 2, 3, 4, 5, 6, 7])
    const ids = watchedVideoIds(watched, videoList('tt1', [8], 16))!
    expect(ids).toEqual(videoList('tt1', [8]))
  })

  it('null se l\'àncora non è nella lista', () => {
    expect(watchedVideoIds(bitfield('tt1:9:1', 1, [0]), videoList('tt1', [3]))).toBeNull()
  })
})

describe('stremioEpisodeTitle', () => {
  it('id IMDb e Kitsu', () => {
    expect(stremioEpisodeTitle('tt1:2:5')).toBe('S2E5')
    expect(stremioEpisodeTitle('kitsu:10766:3')).toBe('S1E3')
    expect(stremioEpisodeTitle('tt1')).toBeNull()
  })
})

describe('extractStremioWatchedEpisodes', () => {
  const barry = {
    _id: BARRY,
    name: 'Barry',
    type: 'series',
    removed: true,
    temp: true,
    _ctime: '2026-10-06T19:35:06Z',
    state: { lastWatched: '2026-10-14T22:11:13Z', video_id: `${BARRY}:4:2`, timeOffset: 1, watched: BARRY_WATCHED },
  }

  it('Barry tolto dalla libreria ha comunque uno storico', () => {
    expect(hasStremioWatchHistory(barry)).toBe(true)
  })

  it('con la lista episodi: elenco completo, ultimo episodio con la data di lastWatched', () => {
    const { episodes, exact } = extractStremioWatchedEpisodes(barry, videoList(BARRY, [8, 8, 8, 8]))
    expect(exact).toBe(true)
    expect(episodes).toHaveLength(25) // S4E2 a 1 ms non conta
    expect(episodes[0]).toEqual({ episodeTitle: 'S1E1', watchedAt: '2026-10-06' })
    expect(episodes[24]).toEqual({ episodeTitle: 'S4E1', watchedAt: '2026-10-14' })
  })

  it('senza lista episodi: solo l\'àncora, lettura parziale', () => {
    const { episodes, exact } = extractStremioWatchedEpisodes(barry, null)
    expect(exact).toBe(false)
    expect(episodes).toEqual([{ episodeTitle: 'S4E1', watchedAt: '2026-10-14' }])
  })

  it('episodio in corso: conta solo da 1 minuto (timeOffset in ms)', () => {
    const item = (timeOffset: number) => ({
      _id: 'tt2', name: 'Black Mirror', type: 'series',
      state: { video_id: 'tt2:7:1', timeOffset, lastWatched: '2026-05-01T10:00:00Z' },
    })
    expect(hasStremioWatchHistory(item(14_484))).toBe(false)
    const { episodes, exact } = extractStremioWatchedEpisodes(item(114_376))
    expect(exact).toBe(true)
    expect(episodes).toEqual([{ episodeTitle: 'S7E1', watchedAt: '2026-05-01' }])
  })
})

describe('sync Stremio: deduplica e riallineamento', () => {
  it('lo stesso episodio con un\'altra data non si reinserisce', async () => {
    const row = { title: 'Lanterns', platform: 'stremio', episodeTitle: 'S1E3', mediaType: 'tv' as const }
    await runIngest([{ ...row, watchedAt: '2026-10-05' }])
    const res = await runIngest([{ ...row, watchedAt: '2026-09-02' }])
    expect(res.inserted).toBe(0)
    expect((getDb().prepare("SELECT COUNT(*) c FROM shows WHERE title = 'Lanterns'").get() as any).c).toBe(1)
  })

  it('toglie episodi numerati male e doppioni, non le righe manuali né altre piattaforme', () => {
    const db = getDb()
    seedShow(db, { title: 'Severance', platform: 'stremio', episode_title: 'S2E1', watched_at: '2025-04-15' })
    seedShow(db, { title: 'Severance', platform: 'stremio', episode_title: 'S2E1', watched_at: '2025-05-01' })
    seedShow(db, { title: 'Severance', platform: 'stremio', episode_title: 'S2E40', watched_at: '2025-04-15' })
    seedShow(db, { title: 'Severance', platform: 'stremio', episode_title: null, watched_at: '2025-04-15', is_manual: 1 })
    seedShow(db, { title: 'Severance', platform: 'netflix', episode_title: 'S2E40', watched_at: '2025-04-15' })
    seedShow(db, { title: '8Sky Cinema Comedy Italy', platform: 'stremio', episode_title: 'Episodio guardato' })

    const res = reconcileStremioRows(db, new Map([['Severance', new Set(['S2E1', 'S2E2'])]]), ['8Sky Cinema Comedy Italy'])
    expect(res).toEqual({ removedWrong: 1, removedDuplicates: 1, removedNonSeries: 1 })
    const left = db.prepare('SELECT platform, episode_title, watched_at, is_manual FROM shows ORDER BY id').all()
    expect(left).toEqual([
      { platform: 'stremio', episode_title: 'S2E1', watched_at: '2025-04-15', is_manual: 0 },
      { platform: 'stremio', episode_title: null, watched_at: '2025-04-15', is_manual: 1 },
      { platform: 'netflix', episode_title: 'S2E40', watched_at: '2025-04-15', is_manual: 0 },
    ])
    // Idempotente
    expect(reconcileStremioRows(db, new Map([['Severance', new Set(['S2E1', 'S2E2'])]]), [])).toEqual(
      { removedWrong: 0, removedDuplicates: 0, removedNonSeries: 0 })
  })

  it('un titolo senza episodi noti non viene svuotato', () => {
    const db = getDb()
    seedShow(db, { title: 'Silo', platform: 'stremio', episode_title: 'S1E1' })
    reconcileStremioRows(db, new Map([['Silo', new Set()]]), [])
    expect((db.prepare("SELECT COUNT(*) c FROM shows WHERE title = 'Silo'").get() as any).c).toBe(1)
  })
})
