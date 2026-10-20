import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// DB su file temporaneo: getDb() lo apre (e lo migra) al primo uso
const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')
process.env.TMDB_API_KEY = 'test-key'
for (const k of ['WATCHSENSE_LOCALE', 'TMDB_LANGUAGE', 'TMDB_REGION']) delete process.env[k]

const { getDb } = await import('../server/utils/db')
const { fetchShowDetails, fetchStreamingCharts, fetchTrendingShows } = await import('../server/utils/tmdb')
const { fetchTmdbEnrichment, searchTmdbTvCandidates } = await import('../server/utils/sync-helpers')

const urls: URL[] = []

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

// Provider per regione: la scheda deve leggere quelli della regione configurata
const PROVIDERS = {
  IT: { flatrate: [{ provider_name: 'Netflix' }] },
  US: { flatrate: [{ provider_name: 'Hulu' }] },
  GB: { flatrate: [{ provider_name: 'Disney Plus' }] },
}

const fakeFetch = vi.fn(async (input: string | URL) => {
  const url = new URL(String(input))
  urls.push(url)
  const p = url.pathname
  if (p.startsWith('/3/discover/tv') || p.startsWith('/3/trending/tv/week') || p.startsWith('/3/search/tv'))
    return json({ results: [{ id: 1, name: 'Dark' }], total_pages: 1 })
  if (p.endsWith('/watch/providers')) return json({ results: PROVIDERS })
  if (p.endsWith('/keywords')) return json({ results: [] })
  return json({
    id: 1, name: 'Dark', genres: [{ name: 'Dramma' }, { name: 'Mistero' }],
    'watch/providers': { results: PROVIDERS },
  })
})

function setLocale(language: string, region: string) {
  const set = getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
  set.run('tmdb_language', language)
  set.run('tmdb_region', region)
}

beforeAll(() => { vi.stubGlobal('fetch', fakeFetch) })
afterAll(() => {
  vi.unstubAllGlobals()
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => { urls.length = 0 })

describe('TMDB con lingua e regione configurate', () => {
  it('classifiche: watch_region e language dalla config, cache separata per regione', async () => {
    setLocale('it-IT', 'IT')
    await fetchStreamingCharts(8, 'netflix')
    expect(urls[0]!.searchParams.get('watch_region')).toBe('IT')
    expect(urls[0]!.searchParams.get('language')).toBe('it-IT')

    setLocale('en-GB', 'GB')
    urls.length = 0
    await fetchStreamingCharts(8, 'netflix')
    // Stesso provider, altra regione: niente risposta dalla cache della config precedente
    expect(urls).toHaveLength(1)
    expect(urls[0]!.searchParams.get('watch_region')).toBe('GB')
    expect(urls[0]!.searchParams.get('language')).toBe('en-GB')
  })

  it('tendenze: piattaforma dai provider della regione configurata', async () => {
    setLocale('en-GB', 'GB')
    const [item] = await fetchTrendingShows()
    expect(urls[0]!.searchParams.get('language')).toBe('en-GB')
    expect(item!.platforms).toBe('disney')
  })

  it('scheda: lingua configurata, provider della regione, generi canonici', async () => {
    setLocale('it-IT', 'GB')
    const show = await fetchShowDetails(1, 'tv')
    expect(urls[0]!.searchParams.get('language')).toBe('it-IT')
    expect(show.providers).toEqual(['Disney Plus'])
    expect(show.genres).toEqual(['Drama', 'Mystery'])
  })

  it('arricchimento e ricerca: lingua e regione configurate', async () => {
    setLocale('it-IT', 'IT')
    const data = await fetchTmdbEnrichment(1, 'tv')
    expect(urls[0]!.searchParams.get('language')).toBe('it-IT')
    expect(data!.watchProviders).toEqual(['Netflix'])
    expect(data!.genres).toEqual(['Drama', 'Mystery'])

    setLocale('en-US', 'US')
    urls.length = 0
    expect((await fetchTmdbEnrichment(1, 'tv'))!.watchProviders).toEqual(['Hulu'])
    await searchTmdbTvCandidates('dark')
    const search = urls.find(u => u.pathname === '/3/search/tv')!
    expect(search.searchParams.get('language')).toBe('en-US')
  })
})
