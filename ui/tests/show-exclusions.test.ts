import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { memoryDb, seedShow } from './helpers'
import { getSchemaVersion, runMigrations, tableExists } from '../server/db/migrate'
import { migrations } from '../server/db/migrations'

// DB su file temporaneo: getDb() lo apre (e lo migra) al primo uso
const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')
process.env.TMDB_API_KEY = 'test-key'
process.env.LLM_BASE_URL = 'http://llm.test/v1'
process.env.LLM_API_KEY = 'test-llm-key'

// Gli handler Nitro usano gli auto-import di h3: qui bastano versioni minime
vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('getQuery', (event: any) => event.query || {})
vi.stubGlobal('readBody', async (event: any) => event.body)
vi.stubGlobal('createError', createError)

/** Prompt inviati al provider LLM finto; TMDB risponde sempre "nessun risultato". */
const prompts: string[] = []
let llmReply = '[]'
vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: any) => {
  const url = new URL(String(input))
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  if (url.host === 'llm.test') {
    prompts.push(JSON.parse(init.body).messages[0].content)
    return json({ choices: [{ message: { content: llmReply } }] })
  }
  return json({ results: [] })
}))

const { getDb } = await import('../server/utils/db')
const { ExclusionError, listExclusions, parseExclusionRequest, setExclusion } = await import('../server/utils/show-exclusions')
const { applyManualMatch, listUnmatchedSeries } = await import('../server/utils/manual-match')
const { runIngest, rematchUnmatchedSeries } = await import('../server/utils/ingest')
const { isLikedShow } = await import('../server/utils/ai-similar')
const listShows = (await import('../server/api/shows.get')).default as any
const stats = (await import('../server/api/stats.get')).default as any
const tasteProfile = (await import('../server/api/taste-profile.get')).default as any
const synthesize = (await import('../server/api/taste-profile/synthesize.post')).default as any
const generate = (await import('../server/api/generate.post')).default as any
const showDetail = (await import('../server/api/shows/[tmdb_id].get')).default as any

afterAll(() => {
  vi.unstubAllGlobals()
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  getDb().exec('DELETE FROM shows; DELETE FROM show_exclusions; DELETE FROM show_feedback')
  prompts.length = 0
  llmReply = '[]'
})

const ignoreGroup = (title: string, platform: string) =>
  setExclusion(parseExclusionRequest({ scope: 'all', title, platform }))
const exclude = (scope: 'all' | 'profile', tmdbId: number, excluded = true) =>
  setExclusion(parseExclusionRequest({ scope, tmdb_id: tmdbId, excluded }))

function seedSeries(tmdbId: number, name: string, episodes: number, genres = '["Dramma"]') {
  for (let i = 1; i <= episodes; i++) {
    seedShow(getDb(), { title: name, platform: 'netflix', episode_title: `E${i}`, tmdb_id: tmdbId, tmdb_name: name, tmdb_genres: genres })
  }
}

describe('migrazione 007 show_exclusions', () => {
  it('crea la tabella e porta user_version a 7 senza toccare shows', () => {
    const db = memoryDb(6)
    seedShow(db, { title: 'Poirot', episode_title: 'E1' })
    runMigrations(db, migrations.slice(0, 7))
    expect(getSchemaVersion(db)).toBe(7)
    expect(tableExists(db, 'show_exclusions')).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS c FROM shows').get()).toEqual({ c: 1 })
  })

  it('una chiave sola per riga; il gruppo per titolo vale solo per lo scope "all"', () => {
    const db = memoryDb()
    const ins = db.prepare('INSERT INTO show_exclusions (scope, tmdb_id, title, platform, label) VALUES (?, ?, ?, ?, ?)')
    expect(() => ins.run('all', 1, 'X', 'prime', 'X')).toThrow(/CHECK/)
    expect(() => ins.run('all', null, null, null, 'X')).toThrow(/CHECK/)
    expect(() => ins.run('profile', null, 'X', 'prime', 'X')).toThrow(/CHECK/)
    expect(() => ins.run('boh', 1, null, null, 'X')).toThrow(/CHECK/)
    ins.run('all', 1, null, null, 'X')
    ins.run('profile', 1, null, null, 'X')
    expect(() => ins.run('all', 1, null, null, 'X')).toThrow(/UNIQUE/)
    ins.run('all', null, 'X', 'prime', 'X')
    expect(() => ins.run('all', null, 'X', 'prime', 'X')).toThrow(/UNIQUE/)
  })
})

describe('parseExclusionRequest', () => {
  it('accetta gruppi, serie e ripristino', () => {
    expect(parseExclusionRequest({ title: 'Rebel Moon', platform: 'netflix' }))
      .toEqual({ scope: 'all', excluded: true, target: { kind: 'group', title: 'Rebel Moon', platform: 'netflix' } })
    expect(parseExclusionRequest({ scope: 'profile', tmdb_id: '7', excluded: false }))
      .toEqual({ scope: 'profile', excluded: false, target: { kind: 'series', tmdbId: 7, mediaType: 'tv' } })
  })

  it('rifiuta input non validi con 400', () => {
    for (const body of [null, [], { scope: 'x', tmdb_id: 1 }, { tmdb_id: -1 }, { tmdb_id: 1, media_type: 'x' },
      { scope: 'profile', title: 'x', platform: 'p' }, { title: ' ', platform: 'p' }, { title: 'x' }, { tmdb_id: 1, excluded: 'no' }]) {
      try {
        parseExclusionRequest(body)
        expect.unreachable(JSON.stringify(body))
      } catch (e: any) {
        expect(e).toBeInstanceOf(ExclusionError)
        expect(e.statusCode).toBe(400)
      }
    }
  })

  it('serve almeno una visione corrispondente', () => {
    expect(() => ignoreGroup('Inesistente', 'prime')).toThrow(ExclusionError)
    expect(() => exclude('profile', 999)).toThrow(ExclusionError)
  })
})

describe('serie ignorata (scope "all")', () => {
  it('sparisce da pannello non abbinate, liste, statistiche e profilo; nulla si cancella', async () => {
    const db = getDb()
    seedShow(db, { title: 'Rebel Moon', platform: 'netflix', episode_title: 'Rebel Moon: Parte 1' })
    seedShow(db, { title: 'Serie Teen', platform: 'prime', episode_title: 'E1' })
    seedSeries(10, 'Serie Teen Abbinata', 3, '["Teen"]')
    seedSeries(20, 'Poirot', 2, '["Crime"]')

    ignoreGroup('Rebel Moon', 'netflix')
    exclude('all', 10)

    expect(listUnmatchedSeries().map(s => s.title)).toEqual(['Serie Teen'])
    const list = listShows({ query: {} })
    expect(list.shows.map((s: any) => s.tmdb_id)).toEqual([20])
    expect(list.availableGenres).toEqual(['Crime'])

    const st = await stats({})
    expect(st.totalEpisodes).toBe(3) // Serie Teen (1) + Poirot (2)
    expect(st.uniqueShows).toBe(2)
    expect(st.genres).toEqual([{ name: 'Crime', count: 2 }])
    expect(st.topShows.map((s: any) => s.tmdb_id)).toEqual([20])

    const { profile } = tasteProfile({})
    expect(profile.totalShows).toBe(1)
    expect(profile.topGenres.map((g: any) => g.name)).toEqual(['Crime'])

    expect(db.prepare('SELECT COUNT(*) AS c FROM shows').get()).toEqual({ c: 7 })
    // la scheda resta raggiungibile (per ripristinarla) e lo dice
    const { show } = await showDetail({ context: { params: { tmdb_id: '10' } }, query: {} })
    expect(show).toMatchObject({ is_ignored: true, profile_excluded: false })
  })

  it('una nuova visione dello stesso titolo e piattaforma resta ignorata, anche dopo il riabbinamento', async () => {
    const db = getDb()
    seedShow(db, { title: 'Rebel Moon', platform: 'netflix', episode_title: 'Rebel Moon: Parte 1' })
    ignoreGroup('Rebel Moon', 'netflix')

    await runIngest([{ title: 'Rebel Moon', platform: 'netflix', watchedAt: '2024-05-01', episodeTitle: 'Rebel Moon: Parte 2', mediaType: 'tv' }])
    expect(db.prepare("SELECT COUNT(*) AS c FROM shows WHERE title = 'Rebel Moon'").get()).toEqual({ c: 2 })
    expect(listUnmatchedSeries()).toEqual([])

    // il riabbinamento automatico non lo cerca nemmeno su TMDB
    const res = await rematchUnmatchedSeries()
    expect(res.titlesTried).toBe(0)

    // anche se le righe ricevono un tmdb_id, il gruppo resta fuori da liste e statistiche
    db.prepare("UPDATE shows SET tmdb_id = 30, tmdb_name = 'Rebel Moon', tmdb_genres = '[\"Azione\"]' WHERE title = 'Rebel Moon'").run()
    expect(listShows({ query: {} }).shows).toEqual([])
    expect((await stats({})).totalEpisodes).toBe(0)
    // la stessa serie su un'altra piattaforma non è ignorata
    seedShow(db, { title: 'Rebel Moon', platform: 'prime', episode_title: 'X', tmdb_id: 30, tmdb_name: 'Rebel Moon', tmdb_genres: '["Azione"]' })
    expect(listShows({ query: {} }).shows.map((s: any) => s.platforms)).toEqual(['prime'])
  })

  it('"Ripristina" la riporta ovunque; elenco degli ignorati', () => {
    seedShow(getDb(), { title: 'Rebel Moon', platform: 'netflix', episode_title: 'E1' })
    seedSeries(10, 'Serie Teen', 2)
    ignoreGroup('Rebel Moon', 'netflix')
    ignoreGroup('Rebel Moon', 'netflix') // idempotente
    exclude('all', 10)
    expect(listExclusions().ignored.map(e => [e.label, e.tmdb_id, e.platform]).sort())
      .toEqual([['Rebel Moon', null, 'netflix'], ['Serie Teen', 10, null]])

    setExclusion(parseExclusionRequest({ title: 'Rebel Moon', platform: 'netflix', excluded: false }))
    exclude('all', 10, false)
    expect(listExclusions().ignored).toEqual([])
    expect(listUnmatchedSeries().map(s => s.title)).toEqual(['Rebel Moon'])
    expect(listShows({ query: {} }).shows.map((s: any) => s.tmdb_id)).toEqual([10])
  })

  it('correggere l\'abbinamento porta l\'esclusione sul nuovo id', async () => {
    seedSeries(10, 'Serie Teen', 2)
    exclude('all', 10)
    exclude('profile', 10)
    vi.mocked(fetch).mockImplementationOnce(async () => new Response(JSON.stringify({
      id: 11, name: 'Serie Teen Giusta', genres: [], overview: '', status: 'Ended',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    await applyManualMatch(11, { kind: 'matched', fromTmdbId: 10 })
    const rows = getDb().prepare('SELECT scope, tmdb_id FROM show_exclusions ORDER BY scope').all()
    expect(rows).toEqual([{ scope: 'all', tmdb_id: 11 }, { scope: 'profile', tmdb_id: 11 }])
  })
})

describe('serie esclusa dal profilo (scope "profile")', () => {
  it('resta in liste e statistiche ma non alimenta profilo, sintesi e consigli', async () => {
    const db = getDb()
    seedSeries(10, 'Serie Teen', 12, '["Teen"]')
    seedSeries(20, 'Poirot', 3, '["Crime"]')
    db.prepare("INSERT INTO show_feedback (tmdb_id, media_type, feedback) VALUES (10, 'tv', 1), (20, 'tv', 1)").run()
    exclude('profile', 10)

    expect(listShows({ query: {} }).shows.map((s: any) => s.tmdb_id)).toEqual([10, 20])
    const st = await stats({})
    expect(st.totalEpisodes).toBe(15)
    expect(st.genres.map((g: any) => g.name).sort()).toEqual(['Crime', 'Teen'])

    const { profile } = tasteProfile({})
    expect(profile.likedShows).toEqual(['Poirot'])
    expect(profile.topGenres.map((g: any) => g.name)).toEqual(['Crime'])

    llmReply = 'Sintesi'
    await synthesize({})
    expect(prompts[0]).toContain('Poirot')
    expect(prompts[0]).not.toContain('Serie Teen')
    expect(prompts[0]).not.toContain('Teen')

    llmReply = '[]'
    await expect(generate({ body: {} })).rejects.toThrow()
    const prompt = prompts[1]!
    const [taste, rules] = prompt.split(/=== 4\. [^=]+ ===/) // REGOLE FERREE | STRICT RULES
    expect(taste).toContain('Poirot')
    expect(taste).not.toContain('Serie Teen')
    // resta tra le serie già viste da non consigliare
    expect(rules).toContain('Serie Teen')

    // niente consigli AI "sartoriali" per la serie esclusa
    expect(isLikedShow(10, 'tv')).toBe(false)
    expect(isLikedShow(20, 'tv')).toBe(true)

    const { show } = await showDetail({ context: { params: { tmdb_id: '10' } }, query: {} })
    expect(show).toMatchObject({ is_ignored: false, profile_excluded: true })

    // reversibile
    exclude('profile', 10, false)
    expect(tasteProfile({}).profile.likedShows.sort()).toEqual(['Poirot', 'Serie Teen'])
  })

  it('una serie ignorata non compare nei prompt, nemmeno tra le già viste', async () => {
    seedSeries(10, 'Serie Teen', 2)
    seedSeries(20, 'Poirot', 2)
    exclude('all', 10)
    await expect(generate({ body: {} })).rejects.toThrow()
    expect(prompts[0]).toContain('Poirot')
    expect(prompts[0]).not.toContain('Serie Teen')
  })

  it('ripristinare una serie ignorata non perde l\'esclusione dal profilo', () => {
    seedSeries(10, 'Serie Teen', 2)
    exclude('profile', 10)
    exclude('all', 10)
    exclude('all', 10, false)
    expect(listExclusions()).toMatchObject({ ignored: [], profileExcluded: [{ tmdb_id: 10 }] })
  })
})
