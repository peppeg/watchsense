import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { seedShow } from './helpers'

// Caso reale: VisionQuest (tmdb 213375), "Returning Series", 8 episodi annunciati e 2 usciti.
// 👍 sulla scheda mentre non era in libreria → "completata 8/8"; poi Stremio importa S1E1–S1E2,
// ma lo stato esplicito vinceva; "non vista" nascondeva gli episodi e la sync non li ripristinava.

const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')
process.env.TMDB_API_KEY = 'test-key'

vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('getQuery', (event: any) => event.query || {})
vi.stubGlobal('readBody', async (event: any) => event.body)
vi.stubGlobal('createError', createError)

const VQ = 213375
// Ultimo episodio uscito (cambia nei test per simulare un'uscita nuova)
let lastAired = 2

function tvDetails() {
  return {
    id: VQ,
    name: 'VisionQuest',
    status: 'Returning Series',
    number_of_episodes: 8,
    number_of_seasons: 1,
    seasons: [{ season_number: 1, episode_count: 8 }],
    last_episode_to_air: { season_number: 1, episode_number: lastAired },
    next_episode_to_air: { season_number: 1, episode_number: lastAired + 1 },
    genres: [{ name: 'Drama' }],
    overview: '',
    vote_average: 7,
    keywords: { results: [] },
    'watch/providers': { results: {} },
  }
}

// Nessuna chiamata reale: TMDB finto per /tv/213375 (dettagli, keyword, provider)
const fakeFetch = vi.fn(async (input: any) => {
  const url = new URL(String(input))
  if (url.pathname.endsWith(`/tv/${VQ}/keywords`)) return Response.json({ results: [] })
  if (url.pathname.endsWith(`/tv/${VQ}/watch/providers`)) return Response.json({ results: {} })
  if (url.pathname.endsWith(`/tv/${VQ}`)) return Response.json(tvDetails())
  return Response.json({ results: [] })
})
vi.stubGlobal('fetch', fakeFetch)

const { getDb } = await import('../server/utils/db')
const { runIngest } = await import('../server/utils/ingest')
const { clearTmdbCaches } = await import('../server/utils/tmdb')
const showDetail = (await import('../server/api/shows/[tmdb_id].get')).default as any
const watchPost = (await import('../server/api/shows/[tmdb_id]/watch.post')).default as any
const feedbackPost = (await import('../server/api/show-feedback.post')).default as any
const listShows = (await import('../server/api/shows.get')).default as any

afterAll(() => {
  vi.unstubAllGlobals()
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  getDb().exec('DELETE FROM shows; DELETE FROM show_user_status; DELETE FROM show_feedback')
  lastAired = 2
  clearTmdbCaches()
  fakeFetch.mockClear()
})

const detail = async () => (await showDetail({ context: { params: { tmdb_id: String(VQ) } }, query: {} })).show
const click = (body: any = {}) => watchPost({ context: { params: { tmdb_id: String(VQ) } }, query: {}, body })
const explicit = () => (getDb().prepare('SELECT status FROM show_user_status WHERE tmdb_id = ?').get(VQ) as any)?.status ?? null
const stremioRows = (eps: number[]) => eps.map(e => ({
  title: 'VisionQuest', platform: 'stremio', watchedAt: `2026-10-0${e}`, episodeTitle: `S1E${e}`, mediaType: 'tv' as const, tmdbId: VQ,
}))

describe('VisionQuest: stato di visione', () => {
  it('il 👍 non cambia lo stato (né in API né nella scheda serie)', async () => {
    await feedbackPost({ body: { tmdb_id: VQ, media_type: 'tv', feedback: 1 } })
    expect(explicit()).toBeNull()
    expect((getDb().prepare('SELECT COUNT(*) c FROM shows').get() as any).c).toBe(0)
    const show = await detail()
    expect(show).toMatchObject({ watch_status: 'unwatched', user_feedback: 1, tmdb_aired_episodes: 2 })
    // La scheda non chiama più /watch dopo un 👍
    const vue = readFileSync(join(__dirname, '../app/components/ShowDetail.vue'), 'utf8')
    const setFeedback = vue.slice(vue.indexOf('async function setFeedback'))
    expect(setFeedback).not.toContain('/watch')
  })

  it('serie non in libreria: il primo clic la segna "in corso"', async () => {
    expect((await detail()).next_watch_status).toBe('in_progress')
    const res = await click()
    expect(res.status).toBe('in_progress')
    expect(explicit()).toBe('in_progress')
    const show = await detail()
    expect(show).toMatchObject({ watch_status: 'in_progress', next_watch_status: 'completed', tmdb_number_of_episodes: 8, tmdb_aired_episodes: 2 })
  })

  it('completata a mano, poi import di S1E1–S1E2: lo stato esplicito cede, in pari con i 2 usciti', async () => {
    // Come faceva il vecchio 👍: completata esplicita + riga manuale segnaposto
    await click({ status: 'completed' })
    expect(explicit()).toBe('completed')

    const res = await runIngest(stremioRows([1, 2]))
    expect(res.inserted).toBe(2)
    expect(explicit()).toBeNull()
    // Il segnaposto manuale non conta più come terzo episodio
    expect((getDb().prepare('SELECT COUNT(*) c FROM shows WHERE tmdb_id = ? AND is_manual = 1').get(VQ) as any).c).toBe(0)

    const show = await detail()
    expect(show).toMatchObject({ watch_status: 'completed', episode_count: 2, tmdb_number_of_episodes: 8, tmdb_aired_episodes: 2, next_watch_status: 'unwatched' })
    const lib = listShows({ query: {} }).shows.find((s: any) => s.tmdb_id === VQ)
    expect(lib).toMatchObject({ user_status: null, watch_status: 'completed', progress: 100, tmdb_aired_episodes: 2 })

    // Esce S1E3: non più in pari → in corso (2/8, 3 usciti)
    lastAired = 3
    clearTmdbCaches()
    expect(await detail()).toMatchObject({ watch_status: 'in_progress', tmdb_aired_episodes: 3 })
  })

  it('stato del DB reale (non vista esplicita + 2 episodi Stremio, usciti ignoti): un clic lo sistema', async () => {
    for (const e of [1, 2]) {
      seedShow(getDb(), {
        title: 'VisionQuest', platform: 'stremio', watched_at: `2026-10-0${e}`, episode_title: `S1E${e}`,
        tmdb_id: VQ, tmdb_name: 'VisionQuest', tmdb_genres: '["Drama"]',
      })
    }
    getDb().prepare("UPDATE shows SET tmdb_status = 'Returning Series', tmdb_number_of_episodes = 8 WHERE tmdb_id = ?").run(VQ)
    getDb().prepare("INSERT INTO show_user_status (tmdb_id, media_type, status) VALUES (?, 'tv', 'unwatched')").run(VQ)

    // La scheda aggiorna gli episodi usciti da TMDB e lo scrive nel DB
    const show = await detail()
    expect(show).toMatchObject({ watch_status: 'unwatched', imported_rows: 2, episode_count: 2, tmdb_aired_episodes: 2, next_watch_status: 'completed' })
    expect((getDb().prepare('SELECT MIN(tmdb_aired_episodes) a FROM shows WHERE tmdb_id = ?').get(VQ) as any).a).toBe(2)

    // Un clic: torna allo stato degli episodi importati, senza stato esplicito
    expect((await click()).status).toBe('completed')
    expect(explicit()).toBeNull()
    expect(await detail()).toMatchObject({ watch_status: 'completed', episode_count: 2 })

    // Il ciclo resta: completata → non vista (esplicita) → completata
    expect((await click()).status).toBe('unwatched')
    expect(explicit()).toBe('unwatched')
    // Una sync con un episodio nuovo ripristina comunque gli episodi importati
    lastAired = 3
    clearTmdbCaches()
    await runIngest(stremioRows([3]))
    expect(explicit()).toBeNull()
    expect(await detail()).toMatchObject({ watch_status: 'completed', episode_count: 3, tmdb_aired_episodes: 3 })
  })

  it('una sync senza righe nuove non tocca lo stato esplicito', async () => {
    await runIngest(stremioRows([1, 2]))
    await click({ status: 'unwatched' })
    expect(explicit()).toBe('unwatched')
    const res = await runIngest(stremioRows([1, 2]))
    expect(res.inserted).toBe(0)
    expect(explicit()).toBe('unwatched')
  })
})

describe('migrazione v12 (tmdb_aired_episodes)', () => {
  it('aggiunge la colonna senza toccare le righe ed è idempotente', async () => {
    const { memoryDb } = await import('./helpers')
    const { runMigrations } = await import('../server/db/migrate')
    const { migrations } = await import('../server/db/migrations')
    const db = memoryDb(11)
    seedShow(db, { title: 'VisionQuest', tmdb_id: VQ, tmdb_genres: '["Drama"]' })
    runMigrations(db, migrations)
    expect(db.pragma('user_version', { simple: true })).toBe(12)
    expect(db.prepare('SELECT title, tmdb_aired_episodes FROM shows').all()).toEqual([{ title: 'VisionQuest', tmdb_aired_episodes: null }])
    // Colonna già presente (v12 riapplicata): nessun errore
    db.pragma('user_version = 11')
    runMigrations(db, migrations)
    expect(db.pragma('user_version', { simple: true })).toBe(12)
    db.close()
  })
})
