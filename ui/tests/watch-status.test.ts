import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { seedShow } from './helpers'
import { airedEpisodeCount, deriveWatchStatus, episodesToComplete, episodeWatchStatus, nextWatchStatus, watchProgress } from '../server/utils/watch-status'

const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')
delete process.env.TMDB_API_KEY

// Gli handler Nitro usano gli auto-import di h3: qui bastano versioni minime
vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('getQuery', (event: any) => event.query || {})
vi.stubGlobal('createError', createError)

const { getDb } = await import('../server/utils/db')
const listShows = (await import('../server/api/shows.get')).default as any
const showDetail = (await import('../server/api/shows/[tmdb_id].get')).default as any

afterAll(() => {
  vi.unstubAllGlobals()
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  getDb().exec('DELETE FROM shows; DELETE FROM show_user_status')
})

function setStatus(tmdbId: number, status: string) {
  getDb().prepare("INSERT OR REPLACE INTO show_user_status (tmdb_id, media_type, status, updated_at) VALUES (?, 'tv', ?, datetime('now'))")
    .run(tmdbId, status)
}

function seedSeries(tmdbId: number, episodes: number, total: number | null) {
  for (let i = 1; i <= episodes; i++) {
    getDb().prepare(`
      INSERT INTO shows (title, platform, watched_at, episode_title, tmdb_id, media_type, tmdb_name, tmdb_genres, tmdb_number_of_episodes)
      VALUES (?, 'netflix', '2024-01-01', ?, ?, 'tv', ?, '["Dramma"]', ?)
    `).run(`Serie ${tmdbId}`, `E${i}`, tmdbId, `Serie ${tmdbId}`, total)
  }
}

describe('deriveWatchStatus / nextWatchStatus / watchProgress', () => {
  it('lo stato esplicito vince sugli episodi registrati', () => {
    expect(deriveWatchStatus({ explicit: 'completed', mediaType: 'tv', episodeCount: 1, totalEpisodes: 20 })).toBe('completed')
    expect(deriveWatchStatus({ explicit: 'unwatched', mediaType: 'tv', episodeCount: 20, totalEpisodes: 20 })).toBe('unwatched')
    expect(deriveWatchStatus({ explicit: 'boh', mediaType: 'tv', episodeCount: 3, totalEpisodes: 20 })).toBe('in_progress')
  })

  it('senza stato esplicito: deduzione storica', () => {
    expect(deriveWatchStatus({ mediaType: 'tv', episodeCount: 0 })).toBe('unwatched')
    expect(deriveWatchStatus({ mediaType: 'tv', episodeCount: 20, totalEpisodes: 20 })).toBe('completed')
    expect(deriveWatchStatus({ mediaType: 'tv', episodeCount: 1, totalEpisodes: null, platforms: 'netflix' })).toBe('completed')
    expect(deriveWatchStatus({ mediaType: 'tv', episodeCount: 1, totalEpisodes: null, platforms: 'trakt' })).toBe('in_progress')
    expect(deriveWatchStatus({ mediaType: 'movie', episodeCount: 1 })).toBe('completed')
  })

  it('il ciclo del pulsante raggiunge "completata" anche con episodi importati', () => {
    expect(nextWatchStatus('unwatched', { mediaType: 'tv', importedRows: 5 })).toBe('in_progress')
    expect(nextWatchStatus('in_progress', { mediaType: 'tv', importedRows: 5 })).toBe('completed')
    expect(nextWatchStatus('completed', { mediaType: 'tv', importedRows: 5 })).toBe('unwatched')
    // Serie non ancora in libreria: il primo clic la segna "in corso", non "completata"
    expect(nextWatchStatus('unwatched', { mediaType: 'tv', importedRows: 0 })).toBe('in_progress')
    expect(nextWatchStatus('unwatched', { mediaType: 'tv', importedRows: 0, episodeStatus: 'completed' })).toBe('in_progress')
    // Episodi importati già in pari: da "non vista" si torna allo stato degli episodi
    expect(nextWatchStatus('unwatched', { mediaType: 'tv', importedRows: 2, episodeStatus: 'completed' })).toBe('completed')
    expect(nextWatchStatus('unwatched', { mediaType: 'tv', importedRows: 2, episodeStatus: 'in_progress' })).toBe('in_progress')
    expect(nextWatchStatus('unwatched', { mediaType: 'movie', importedRows: 1 })).toBe('completed')
  })

  it('completata = tutti gli episodi del totale TMDB; in pari con gli usciti = in corso', () => {
    // VisionQuest: 8 episodi annunciati, 4 usciti e visti → in corso (in pari)
    expect(deriveWatchStatus({ mediaType: 'tv', episodeCount: 4, totalEpisodes: 8, airedEpisodes: 4, platforms: 'stremio' })).toBe('in_progress')
    expect(deriveWatchStatus({ mediaType: 'tv', episodeCount: 2, totalEpisodes: 8, airedEpisodes: 4, platforms: 'stremio' })).toBe('in_progress')
    // Tutti gli 8 usciti e visti → completata
    expect(deriveWatchStatus({ mediaType: 'tv', episodeCount: 8, totalEpisodes: 8, airedEpisodes: 8, platforms: 'stremio' })).toBe('completed')
    // Tra una stagione e l'altra (nulla di nuovo annunciato): completata
    expect(deriveWatchStatus({ mediaType: 'tv', episodeCount: 10, totalEpisodes: 10, airedEpisodes: 10 })).toBe('completed')
    // TMDB annuncia una stagione nuova: il totale cresce e la serie torna in corso da sola
    expect(deriveWatchStatus({ mediaType: 'tv', episodeCount: 10, totalEpisodes: 18, airedEpisodes: 10 })).toBe('in_progress')
    // Usciti ignoti: il totale, come prima
    expect(deriveWatchStatus({ mediaType: 'tv', episodeCount: 2, totalEpisodes: 8, airedEpisodes: null, platforms: 'stremio' })).toBe('in_progress')
    // Usciti oltre il totale (dati TMDB incoerenti): basta il totale
    expect(deriveWatchStatus({ mediaType: 'tv', episodeCount: 8, totalEpisodes: 8, airedEpisodes: 10 })).toBe('completed')
    // Totale ignoto: contano gli usciti; senza nessuno dei due, la regola del singolo episodio manuale
    expect(deriveWatchStatus({ mediaType: 'tv', episodeCount: 4, totalEpisodes: null, airedEpisodes: 4, platforms: 'stremio' })).toBe('completed')
    expect(deriveWatchStatus({ mediaType: 'tv', episodeCount: 3, totalEpisodes: null, airedEpisodes: 4, platforms: 'stremio' })).toBe('in_progress')
    expect(deriveWatchStatus({ mediaType: 'tv', episodeCount: 1, totalEpisodes: null, airedEpisodes: null, platforms: 'netflix' })).toBe('completed')
    expect(deriveWatchStatus({ mediaType: 'tv', episodeCount: 1, totalEpisodes: null, airedEpisodes: null, platforms: 'stremio' })).toBe('in_progress')
    expect(deriveWatchStatus({ mediaType: 'movie', episodeCount: 1, totalEpisodes: null, airedEpisodes: null })).toBe('completed')
    // Lo stato esplicito vince sempre su quello dedotto, anche "completata" su una serie in onda
    expect(deriveWatchStatus({ explicit: 'unwatched', mediaType: 'tv', episodeCount: 2, totalEpisodes: 8, airedEpisodes: 2 })).toBe('unwatched')
    expect(deriveWatchStatus({ explicit: 'completed', mediaType: 'tv', episodeCount: 4, totalEpisodes: 8, airedEpisodes: 4 })).toBe('completed')
    expect(episodeWatchStatus({ mediaType: 'tv', episodeCount: 4, totalEpisodes: 8, airedEpisodes: 4 })).toBe('in_progress')
    expect(episodesToComplete(8, 4)).toBe(8)
    expect(episodesToComplete(8, null)).toBe(8)
    expect(episodesToComplete(null, 4)).toBe(4)
    expect(episodesToComplete(null, null)).toBe(0)
    // Avanzamento della Libreria: in corso = visti/totale, completata (anche esplicita) = 100
    expect(watchProgress('in_progress', 4, 8)).toBe(50)
    expect(watchProgress('completed', 4, 8)).toBe(100)
  })

  it('ciclo del pulsante su una serie in onda in pari (4/4 usciti, 8 annunciati)', () => {
    const facts = { mediaType: 'tv' as const, episodeCount: 4, totalEpisodes: 8, airedEpisodes: 4, platforms: 'stremio' }
    const episodeStatus = episodeWatchStatus(facts)
    expect(episodeStatus).toBe('in_progress')
    const opts = { mediaType: 'tv' as const, importedRows: 4, episodeStatus }
    expect(nextWatchStatus('in_progress', opts)).toBe('completed')
    expect(nextWatchStatus('completed', opts)).toBe('unwatched')
    // Da "non vista" torna allo stato degli episodi: in corso, non completata
    expect(nextWatchStatus('unwatched', opts)).toBe('in_progress')
  })

  it('episodi usciti dai dettagli TMDB (last_episode_to_air + seasons, speciali esclusi)', () => {
    const seasons = [
      { season_number: 0, episode_count: 5 },
      { season_number: 1, episode_count: 10 },
      { season_number: 2, episode_count: 8 },
      { season_number: 3, episode_count: 8 },
    ]
    expect(airedEpisodeCount({ number_of_episodes: 8, seasons: [{ season_number: 1, episode_count: 8 }], last_episode_to_air: { season_number: 1, episode_number: 2 } })).toBe(2)
    expect(airedEpisodeCount({ number_of_episodes: 26, seasons, last_episode_to_air: { season_number: 3, episode_number: 4 } })).toBe(22)
    // Mai oltre il totale dichiarato
    expect(airedEpisodeCount({ number_of_episodes: 20, seasons, last_episode_to_air: { season_number: 3, episode_number: 4 } })).toBe(20)
    // Ignoto: nessun episodio uscito, ultimo uscito uno speciale, stagioni mancanti
    expect(airedEpisodeCount({ number_of_episodes: 8, seasons, last_episode_to_air: null })).toBeNull()
    expect(airedEpisodeCount({ number_of_episodes: 8, seasons, last_episode_to_air: { season_number: 0, episode_number: 3 } })).toBeNull()
    expect(airedEpisodeCount({ number_of_episodes: 8, last_episode_to_air: { season_number: 1, episode_number: 2 } })).toBeNull()
    expect(airedEpisodeCount(null)).toBeNull()
  })

  it('avanzamento: completata 100, non vista 0, altrimenti episodi/totale', () => {
    expect(watchProgress('completed', 1, 20)).toBe(100)
    expect(watchProgress('unwatched', 10, 20)).toBe(0)
    expect(watchProgress('in_progress', 5, 20)).toBe(25)
    expect(watchProgress('in_progress', 5, null)).toBe(100)
  })
})

describe('API: lo stato esplicito vince', () => {
  it('Libreria: serie segnata completata con un solo episodio → 100%', () => {
    seedSeries(1, 1, 20)
    seedSeries(2, 5, 20)
    seedSeries(3, 20, 20)
    setStatus(1, 'completed')
    setStatus(3, 'in_progress')
    const res = listShows({ query: {} })
    const byId = Object.fromEntries(res.shows.map((s: any) => [s.tmdb_id, s]))
    expect(byId[1]).toMatchObject({ user_status: 'completed', watch_status: 'completed', progress: 100, episode_count: 1 })
    expect(byId[2]).toMatchObject({ user_status: null, watch_status: 'in_progress', progress: 25 })
    expect(byId[3]).toMatchObject({ user_status: 'in_progress', watch_status: 'in_progress', progress: 100 })
  })

  it('Scheda serie: stato e prossimo stato del pulsante', async () => {
    seedSeries(1, 3, 20)
    let { show } = await showDetail({ context: { params: { tmdb_id: '1' } }, query: {} })
    expect(show).toMatchObject({ watch_status: 'in_progress', next_watch_status: 'completed', episode_count: 3 })
    setStatus(1, 'completed')
    ;({ show } = await showDetail({ context: { params: { tmdb_id: '1' } }, query: {} }))
    expect(show).toMatchObject({ watch_status: 'completed', next_watch_status: 'unwatched', episode_count: 3, tmdb_number_of_episodes: 20 })
    setStatus(1, 'unwatched')
    ;({ show } = await showDetail({ context: { params: { tmdb_id: '1' } }, query: {} }))
    expect(show).toMatchObject({ watch_status: 'unwatched', next_watch_status: 'in_progress' })
  })
})
