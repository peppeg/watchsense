import { describe, expect, it } from 'vitest'
import { memoryDb, seedShow } from './helpers'
import {
  EXPORT_CONFIG_KEYS, HISTORY_COLUMNS, buildProfileExport, csvCell, exportFileName,
  historyCsv, historyRows, parseEpisodeNumbers,
} from '../server/utils/export'
import { SECRET_CONFIG_KEYS } from '../server/utils/secrets'
import { requiresAuth, authDecision, sessionValue } from '../server/utils/auth'

describe('parseEpisodeNumbers', () => {
  it('reads SxEy (Stremio, Trakt)', () => {
    expect(parseEpisodeNumbers('S1E3', 'Lost')).toEqual({ season: 1, episode: 3 })
    expect(parseEpisodeNumbers('S12E17 - The Conference Valuation', 'The Big Bang Theory')).toEqual({ season: 12, episode: 17 })
  })

  it('reads season and episode markers (Prime CSV)', () => {
    expect(parseEpisodeNumbers('Desperate Housewives - Stagione 6: Episodio 6: Regole e conseguenze', 'Desperate Housewives'))
      .toEqual({ season: 6, episode: 6 })
    expect(parseEpisodeNumbers("Grey's Anatomy Season 9: Episodio 2: Remember the Time", "Grey's Anatomy"))
      .toEqual({ season: 9, episode: 2 })
  })

  it('reads only the season from Netflix CSV titles, never from the episode name', () => {
    expect(parseEpisodeNumbers("You: Stagione 4: Lei non c'è", 'You')).toEqual({ season: 4, episode: null })
    expect(parseEpisodeNumbers('Dark: Season 2: Season of the Witch 7', 'Dark')).toEqual({ season: 2, episode: null })
    expect(parseEpisodeNumbers('Neon Genesis Evangelion: Season 3 of something', 'Neon Genesis Evangelion: Season 3 of something'))
      .toEqual({ season: null, episode: null })
    expect(parseEpisodeNumbers('RIPLEY: Miniserie: IV LA DOLCE VITA', 'RIPLEY')).toEqual({ season: null, episode: null })
    expect(parseEpisodeNumbers('The Season 5 Finale', 'Show')).toEqual({ season: null, episode: null })
  })

  it('returns nulls for empty or unnumbered titles', () => {
    expect(parseEpisodeNumbers(null)).toEqual({ season: null, episode: null })
    expect(parseEpisodeNumbers('Pilot', 'Show')).toEqual({ season: null, episode: null })
  })
})

describe('csvCell / historyCsv', () => {
  it('quotes per RFC 4180', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(12)).toBe('12')
    expect(csvCell(true)).toBe('true')
  })

  it('neutralizes spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"')
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-cmd')).toBe("'-cmd")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('\tx')).toBe("'\tx")
    expect(csvCell('\rx')).toBe('"\'\rx"')
    expect(csvCell('a=b')).toBe('a=b')
  })

  it('writes a BOM, the header and CRLF rows', () => {
    const db = memoryDb()
    seedShow(db, { title: 'Città, "Nuova"', episode_title: '=cmd|calc', watched_at: '2024-02-01', platform: 'netflix' })
    const csv = historyCsv(historyRows(db))
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe(HISTORY_COLUMNS.join(','))
    expect(lines[1]).toBe('"Città, ""Nuova""","Città, ""Nuova""",,,\'=cmd|calc,netflix,2024-02-01,,false')
    expect(lines[2]).toBe('')
    expect(Buffer.from(csv, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xEF, 0xBB, 0xBF]))
  })
})

describe('historyRows', () => {
  it('keeps TV episodes only, ordered by date then title, with TMDB names', () => {
    const db = memoryDb()
    seedShow(db, { title: 'Zeta', episode_title: 'S1E2', watched_at: '2024-03-01', platform: 'stremio', tmdb_id: 7, tmdb_name: 'Zeta TMDB' })
    seedShow(db, { title: 'Alpha', episode_title: 'S2E1 - Pilot', watched_at: '2024-03-01', platform: 'trakt' })
    seedShow(db, { title: 'Old', episode_title: 'Old: Stagione 3: Nome', watched_at: '2020-01-01', platform: 'netflix' })
    seedShow(db, { title: 'A Movie', episode_title: '(film)', watched_at: '2024-01-01', media_type: 'movie', tmdb_id: 99 })
    seedShow(db, { title: '   ', episode_title: ': Episodio 6', watched_at: '2024-01-01', platform: 'netflix' })
    seedShow(db, { title: 'Manual', episode_title: null, watched_at: '2025-01-01 10:00:00', platform: 'manual', is_manual: 1 })

    const rows = historyRows(db)
    expect(rows.map(r => r.title)).toEqual(['Old', 'Alpha', 'Zeta TMDB', 'Manual'])
    expect(rows[0]).toMatchObject({ season: 3, episode: null })
    expect(rows[2]).toEqual({
      title: 'Zeta TMDB', original_title: 'Zeta', season: 1, episode: 2, episode_title: 'S1E2',
      platform: 'stremio', watched_at: '2024-03-01', tmdb_id: 7, manual: false,
    })
    expect(rows[3]).toMatchObject({ manual: true, watched_at: '2025-01-01 10:00:00', episode_title: null })
    expect(historyCsv(rows)).not.toContain('A Movie')
  })
})

describe('buildProfileExport', () => {
  function seeded() {
    const db = memoryDb()
    const genres = JSON.stringify(['Drama', 'Mystery'])
    seedShow(db, { title: 'Dark', episode_title: 'S1E1', watched_at: '2024-01-01', platform: 'netflix', tmdb_id: 1, tmdb_name: 'Dark', tmdb_genres: genres })
    seedShow(db, { title: 'Dark', episode_title: 'S1E2', watched_at: '2024-01-05', platform: 'stremio', tmdb_id: 1, tmdb_name: 'Dark', tmdb_genres: genres })
    seedShow(db, { title: 'Ignored', episode_title: 'S1E1', watched_at: '2024-02-01', tmdb_id: 2, tmdb_name: 'Ignored', tmdb_genres: genres })
    seedShow(db, { title: 'Mystery Show', episode_title: 'Ep', watched_at: '2023-01-01', platform: 'prime' })
    seedShow(db, { title: 'Film', episode_title: '(film)', watched_at: '2024-01-01', media_type: 'movie', tmdb_id: 3, tmdb_name: 'Film' })
    db.prepare("UPDATE shows SET tmdb_number_of_episodes = 2 WHERE tmdb_id = 1").run()
    db.prepare("INSERT INTO show_feedback (tmdb_id, media_type, feedback) VALUES (1, 'tv', 1), (2, 'tv', -1), (3, 'movie', 1)").run()
    db.prepare("INSERT INTO show_user_status (tmdb_id, media_type, status) VALUES (2, 'tv', 'unwatched')").run()
    db.prepare("INSERT INTO show_exclusions (scope, tmdb_id, media_type, label) VALUES ('all', 2, 'tv', 'Ignored')").run()
    db.prepare("INSERT INTO show_exclusions (scope, title, platform, label) VALUES ('all', 'Mystery Show', 'prime', 'Mystery Show')").run()
    db.prepare("INSERT INTO recommendation_batches (id, created_at, genre_filter, taste_snapshot, prompt_snapshot) VALUES (1, '2024-03-01', NULL, '{\"topGenres\":[\"Drama\"]}', 'PROMPT TEXT')").run()
    db.prepare("INSERT INTO recommendations (title, tmdb_id, media_type, reason, score, feedback, bookmarked, batch_id) VALUES ('Babylon Berlin', 10, 'tv', 'Because Dark', 9, 1, 1, 1)").run()
    db.prepare("INSERT INTO recommendations (title, tmdb_id, media_type, bookmarked, batch_id) VALUES ('Some Movie', 11, 'movie', 1, 1)").run()
    const setConfig = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
    setConfig.run('taste_custom_notes', 'I love slow-burn mysteries')
    setConfig.run('taste_ai_summary', 'A fan of dark European drama.')
    setConfig.run('taste_ai_summary_updated_at', '2024-03-02T00:00:00.000Z')
    setConfig.run('app_locale', 'it')
    return db
  }

  it('has a self-describing shape', () => {
    const out = buildProfileExport(seeded(), { appVersion: '1.0.0', now: new Date('2024-04-01T12:00:00Z') })
    expect(Object.keys(out)).toEqual(['format', 'version', 'exported_at', 'app_version', 'locale', 'summary', 'taste', 'series', 'unmatched', 'bookmarks', 'recommendations', 'history'])
    expect(out).toMatchObject({ format: 'watchsense-profile', version: 1, exported_at: '2024-04-01T12:00:00.000Z', app_version: '1.0.0' })
    expect(out.locale.app_locale).toBe('it')
    expect(out.summary).toEqual({ episodes: 4, series: 2, unmatched: 1 })
    expect(out.taste).toMatchObject({ notes: 'I love slow-burn mysteries', ai_summary: 'A fan of dark European drama.', ai_summary_updated_at: '2024-03-02T00:00:00.000Z' })
    // Profilo: la serie ignorata non lo alimenta; generi canonici (inglesi) anche con l'app in italiano
    expect(out.taste.profile.liked).toEqual(['Dark'])
    expect(out.taste.profile.disliked).toEqual([])
    expect(out.taste.profile.top_genres.map(g => g.name)).toEqual(['Drama', 'Mystery'])
  })

  it('describes series with status, feedback and flags (TV only)', () => {
    const out = buildProfileExport(seeded(), { appVersion: '1.0.0' })
    expect(out.series.map(s => s.tmdb_id)).toEqual([2, 1])
    expect(out.series.find(s => s.tmdb_id === 1)).toEqual({
      tmdb_id: 1, name: 'Dark', imported_titles: ['Dark'], genres: ['Drama', 'Mystery'], first_air_date: null,
      episodes_watched: 2, total_episodes: 2, platforms: ['netflix', 'stremio'],
      first_watched: '2024-01-01', last_watched: '2024-01-05',
      watch_status: 'completed', user_status: null, feedback: 'liked',
      bookmarked: false, ignored: false, excluded_from_profile: false,
    })
    expect(out.series.find(s => s.tmdb_id === 2)).toMatchObject({ watch_status: 'unwatched', user_status: 'unwatched', feedback: 'disliked', ignored: true })
    expect(out.unmatched).toEqual([{ title: 'Mystery Show', platform: 'prime', episodes_watched: 1, first_watched: '2023-01-01', last_watched: '2023-01-01', ignored: true }])
    expect(out.bookmarks).toEqual([{ title: 'Babylon Berlin', tmdb_id: 10, saved_at: expect.any(String), already_watched: false }])
    expect(out.recommendations).toHaveLength(1)
    expect(out.recommendations[0]!.taste_snapshot).toEqual({ topGenres: ['Drama'] })
    expect(out.recommendations[0]!.recommendations).toEqual([expect.objectContaining({ title: 'Babylon Berlin', feedback: 'liked', bookmarked: true })])
    expect(out.history).toHaveLength(4)
    const json = JSON.stringify(out)
    expect(json).not.toContain('Film')
    expect(json).not.toContain('Some Movie')
    expect(json).not.toContain('PROMPT TEXT')
  })

  it('never exports secrets or settings', () => {
    const db = seeded()
    const secrets: Record<string, string> = {
      tmdb_api_key: 'SECRET-tmdb-0123456789',
      stremio_auth_key: 'SECRET-stremio-authkey',
      netflix_cookies: 'NetflixId=SECRET-cookie-value; SecureNetflixId=SECRET-2',
      ingest_token: 'SECRET-bookmarklet-token',
      llm_config: JSON.stringify({ base_url: 'http://SECRET-llm.host/v1', model: 'SECRET-model', api_key: 'SECRET-llm-key' }),
      prime_cookies: 'SECRET-amazon-cookie',
      encryption_key: 'SECRET-key-material',
      last_sync_result: '{"SECRET":"sync-state"}',
      home_hidden_sections: 'SECRET-setting',
    }
    const setConfig = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
    for (const [k, v] of Object.entries(secrets)) setConfig.run(k, v)
    // Ogni segreto noto è fuori dall'allowlist
    for (const k of [...SECRET_CONFIG_KEYS, 'llm_config']) expect(EXPORT_CONFIG_KEYS as readonly string[]).not.toContain(k)

    const json = JSON.stringify(buildProfileExport(db, { appVersion: '1.0.0' }))
    expect(json).not.toContain('SECRET')
    for (const k of Object.keys(secrets)) expect(json).not.toContain(k)
    for (const k of Object.keys(secrets)) expect(historyCsv(historyRows(db))).not.toContain(k)
  })
})

describe('export endpoints', () => {
  it('names the files by date', () => {
    expect(exportFileName('history', 'csv', new Date(2024, 0, 5))).toBe('watchsense-history-2024-01-05.csv')
    expect(exportFileName('profile', 'json', new Date(2024, 10, 25))).toBe('watchsense-profile-2024-11-25.json')
  })

  it('are behind the optional auth (not public)', () => {
    const token = 'test-token-0123456789'
    for (const p of ['/api/export/history.csv', '/api/export/profile.json', '/API/Export/History.csv']) {
      expect(requiresAuth(p), p).toBe(true)
      expect(authDecision({ path: p }, token), p).toBe('deny')
      // Il link <a download> porta il cookie di sessione del browser
      expect(authDecision({ path: p, cookie: sessionValue(token) }, token), p).toBe('allow')
      expect(authDecision({ path: p }, null), p).toBe('allow')
    }
  })
})
