/**
 * "Esporta i tuoi dati" (Impostazioni → Sistema): cronologia degli episodi in CSV e profilo
 * completo in JSON. Funzioni pure sul DB passato, così i test non hanno bisogno di Nuxt.
 *
 * Solo serie: i film sono registrati ma non si mostrano né si usano (media_type 'movie'
 * escluso ovunque). Le serie ignorate dall'utente restano nell'export, con il loro flag:
 * sono comunque dati suoi.
 *
 * Mai segreti né impostazioni: di `config` si leggono solo le chiavi di EXPORT_CONFIG_KEYS
 * (allowlist esplicita), cioè note e sintesi del profilo dei gusti e la lingua.
 */
import type Database from 'better-sqlite3'
import { anySeriesRows } from './series-filter'
import { parseStoredGenres } from './genres'
import { deriveWatchStatus, parseWatchStatus } from './watch-status'
import { primeEpisodeNumbers } from './prime-dedup'
import { getLocaleConfig } from './locale'
import { computeTasteProfile } from './taste-profile'

/** Le sole righe di `config` che finiscono nell'export (allowlist, non denylist). */
export const EXPORT_CONFIG_KEYS = [
  'taste_custom_notes',
  'taste_ai_summary',
  'taste_ai_summary_updated_at',
  'app_locale',
  'tmdb_language',
  'tmdb_region',
] as const

export const PROFILE_FORMAT = 'watchsense-profile'
export const PROFILE_VERSION = 1

// ── Numeri di stagione ed episodio ──

// Stagione in testa al resto dell'episode_title dopo il nome della serie
// (Netflix CSV: "Serie: Stagione 4: Nome episodio", nessun numero di episodio)
const LEADING_SEASON = /^[\s:–\-(]*(?:season|stagione|staffel|saison|s[ée]rie|series|temporada)\s*0*(\d{1,3})(?!\d)/iu

/**
 * Stagione ed episodio da un episode_title, null dove non si ricavano:
 * - "S1E3", "S6E6 - Nome" (Stremio, Trakt);
 * - "Serie - Stagione 6: Episodio 6: Nome" (Prime CSV), "Season 1: Episode 2";
 * - solo stagione: "Serie: Stagione 4: Nome" (Netflix CSV), cercata subito dopo il nome
 *   della serie, mai dentro il nome dell'episodio.
 */
export function parseEpisodeNumbers(episodeTitle: string | null | undefined, seriesTitle = ''): { season: number | null, episode: number | null } {
  const text = (episodeTitle || '').trim()
  if (!text) return { season: null, episode: null }
  const both = primeEpisodeNumbers(text)
  if (both) return both
  const series = (seriesTitle || '').trim()
  const rest = series && text.toLowerCase().startsWith(series.toLowerCase()) ? text.slice(series.length) : text
  const season = LEADING_SEASON.exec(rest)
  return { season: season ? Number(season[1]) : null, episode: null }
}

// ── Cronologia (CSV) ──

export interface HistoryRow {
  title: string
  original_title: string
  season: number | null
  episode: number | null
  episode_title: string | null
  platform: string
  watched_at: string | null
  tmdb_id: number | null
  manual: boolean
}

export const HISTORY_COLUMNS = ['title', 'original_title', 'season', 'episode', 'episode_title', 'platform', 'watched_at', 'tmdb_id', 'manual'] as const

/** Una riga per episodio visto (solo serie), in ordine di data e titolo. */
export function historyRows(db: Database.Database): HistoryRow[] {
  const rows = db.prepare(`
    SELECT title, tmdb_name, episode_title, platform, watched_at, tmdb_id, is_manual
    FROM shows
    WHERE ${anySeriesRows()}
    ORDER BY watched_at IS NULL, watched_at, COALESCE(tmdb_name, title) COLLATE NOCASE, id
  `).all() as any[]
  return rows.map(r => {
    const { season, episode } = parseEpisodeNumbers(r.episode_title, r.title)
    return {
      title: r.tmdb_name || r.title,
      original_title: r.title,
      season,
      episode,
      episode_title: r.episode_title ?? null,
      platform: r.platform,
      watched_at: r.watched_at ?? null,
      tmdb_id: r.tmdb_id ?? null,
      manual: r.is_manual === 1,
    }
  })
}

/**
 * Cella CSV (RFC 4180) con difesa dalla formula injection: un testo che inizia con
 * = + - @, tab o CR prende un apostrofo davanti (un foglio di calcolo lo leggerebbe
 * come formula). I numeri restano numeri (anche negativi, che qui non ci sono).
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV UTF-8 con BOM (Excel legge bene gli accenti), righe terminate da CRLF. */
export function historyCsv(rows: HistoryRow[]): string {
  const lines = [HISTORY_COLUMNS.join(',')]
  for (const r of rows) lines.push(HISTORY_COLUMNS.map(c => csvCell(r[c])).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}

// ── Profilo (JSON) ──

function feedbackLabel(value: unknown): 'liked' | 'disliked' | null {
  return value === 1 ? 'liked' : value === -1 ? 'disliked' : null
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function seriesEntries(db: Database.Database) {
  const rows = db.prepare(`
    SELECT
      s.tmdb_id,
      COALESCE(MAX(s.tmdb_name), MIN(s.title)) AS name,
      json_group_array(DISTINCT s.title) AS imported_titles,
      MAX(s.tmdb_genres) AS tmdb_genres,
      MAX(s.tmdb_first_air_date) AS first_air_date,
      MAX(s.tmdb_number_of_episodes) AS total_episodes,
      MAX(s.tmdb_aired_episodes) AS aired_episodes,
      COUNT(DISTINCT COALESCE(s.episode_title, s.id)) AS episode_count,
      GROUP_CONCAT(DISTINCT s.platform) AS platforms,
      MIN(s.watched_at) AS first_watched,
      MAX(s.watched_at) AS last_watched,
      sf.feedback AS feedback,
      us.status AS user_status,
      EXISTS (SELECT 1 FROM recommendations r WHERE r.tmdb_id = s.tmdb_id AND r.media_type = 'tv' AND r.bookmarked = 1) AS bookmarked,
      EXISTS (SELECT 1 FROM show_exclusions x WHERE x.scope = 'all' AND x.tmdb_id = s.tmdb_id AND x.media_type = 'tv') AS ignored,
      EXISTS (SELECT 1 FROM show_exclusions x WHERE x.scope = 'profile' AND x.tmdb_id = s.tmdb_id AND x.media_type = 'tv') AS excluded_from_profile
    FROM shows s
    LEFT JOIN show_feedback sf ON sf.tmdb_id = s.tmdb_id AND sf.media_type = s.media_type
    LEFT JOIN show_user_status us ON us.tmdb_id = s.tmdb_id AND us.media_type = s.media_type
    WHERE s.tmdb_id IS NOT NULL AND ${anySeriesRows('s')}
    GROUP BY s.tmdb_id
    ORDER BY last_watched DESC, name COLLATE NOCASE
  `).all() as any[]

  return rows.map(r => ({
    tmdb_id: r.tmdb_id as number,
    name: r.name as string,
    imported_titles: ((parseJson(r.imported_titles) as string[] | null) || []).sort(),
    genres: parseStoredGenres(r.tmdb_genres),
    first_air_date: r.first_air_date ?? null,
    episodes_watched: r.episode_count as number,
    total_episodes: r.total_episodes ?? null,
    platforms: String(r.platforms || '').split(',').filter(Boolean).sort(),
    first_watched: r.first_watched ?? null,
    last_watched: r.last_watched ?? null,
    // Lo stesso stato delle API (stato esplicito se c'è, altrimenti dedotto dagli episodi)
    watch_status: deriveWatchStatus({
      explicit: r.user_status,
      mediaType: 'tv',
      episodeCount: r.episode_count,
      totalEpisodes: r.total_episodes,
      airedEpisodes: r.aired_episodes,
      platforms: r.platforms,
    }),
    user_status: parseWatchStatus(r.user_status),
    feedback: feedbackLabel(r.feedback),
    bookmarked: r.bookmarked === 1,
    ignored: r.ignored === 1,
    excluded_from_profile: r.excluded_from_profile === 1,
  }))
}

function unmatchedEntries(db: Database.Database) {
  const rows = db.prepare(`
    SELECT title, platform,
      COUNT(DISTINCT COALESCE(episode_title, id)) AS episode_count,
      MIN(watched_at) AS first_watched,
      MAX(watched_at) AS last_watched,
      EXISTS (SELECT 1 FROM show_exclusions x WHERE x.scope = 'all' AND x.tmdb_id IS NULL
        AND x.title = shows.title AND x.platform = shows.platform) AS ignored
    FROM shows
    WHERE ${anySeriesRows()} AND tmdb_id IS NULL
    GROUP BY title, platform
    ORDER BY last_watched DESC, title COLLATE NOCASE
  `).all() as any[]
  return rows.map(r => ({
    title: r.title as string,
    platform: r.platform as string,
    episodes_watched: r.episode_count as number,
    first_watched: r.first_watched ?? null,
    last_watched: r.last_watched ?? null,
    ignored: r.ignored === 1,
  }))
}

function bookmarkEntries(db: Database.Database) {
  return (db.prepare(`
    SELECT title, tmdb_id, created_at, already_watched
    FROM recommendations
    WHERE bookmarked = 1 AND media_type = 'tv'
    ORDER BY created_at DESC, id DESC
  `).all() as any[]).map(r => ({
    title: r.title as string,
    tmdb_id: r.tmdb_id ?? null,
    saved_at: r.created_at ?? null,
    already_watched: r.already_watched === 1,
  }))
}

/** Storico dei consigli: ogni batch con le sue serie consigliate e le reazioni dell'utente. */
function recommendationBatches(db: Database.Database) {
  const batches = db.prepare(`
    SELECT id, created_at, genre_filter, taste_snapshot FROM recommendation_batches
    ORDER BY created_at DESC, id DESC
  `).all() as any[]
  const recs = db.prepare(`
    SELECT title, tmdb_id, reason, where_to_watch, score, feedback, bookmarked, already_watched, dismissed
    FROM recommendations WHERE batch_id = ? AND media_type = 'tv'
    ORDER BY score DESC, id
  `)
  return batches.map(b => ({
    created_at: b.created_at ?? null,
    genre_filter: b.genre_filter ?? null,
    taste_snapshot: parseJson(b.taste_snapshot),
    recommendations: (recs.all(b.id) as any[]).map(r => ({
      title: r.title as string,
      tmdb_id: r.tmdb_id ?? null,
      reason: r.reason ?? null,
      where_to_watch: r.where_to_watch ?? null,
      score: r.score ?? null,
      feedback: feedbackLabel(r.feedback),
      bookmarked: r.bookmarked === 1,
      already_watched: r.already_watched === 1,
      dismissed: r.dismissed === 1,
    })),
  }))
}

function allowedConfig(db: Database.Database): Partial<Record<typeof EXPORT_CONFIG_KEYS[number], string>> {
  const placeholders = EXPORT_CONFIG_KEYS.map(() => '?').join(',')
  const rows = db.prepare(`SELECT key, value FROM config WHERE key IN (${placeholders})`).all(...EXPORT_CONFIG_KEYS) as { key: string, value: string }[]
  const out: Record<string, string> = {}
  for (const r of rows) if ((EXPORT_CONFIG_KEYS as readonly string[]).includes(r.key)) out[r.key] = r.value
  return out
}

export function buildProfileExport(db: Database.Database, opts: { appVersion: string, now?: Date }) {
  const config = allowedConfig(db)
  // Lingua effettiva (DB → env → default), come la usa l'app
  const locale = getLocaleConfig(db)
  const taste = computeTasteProfile(db)
  const history = historyRows(db)
  const series = seriesEntries(db)
  const unmatched = unmatchedEntries(db)

  return {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    exported_at: (opts.now ?? new Date()).toISOString(),
    app_version: opts.appVersion,
    locale: {
      app_locale: locale.appLocale,
      tmdb_language: locale.tmdbLanguage,
      tmdb_region: locale.tmdbRegion,
    },
    summary: {
      episodes: history.length,
      series: series.length,
      unmatched: unmatched.length,
    },
    taste: {
      notes: config.taste_custom_notes || '',
      ai_summary: config.taste_ai_summary || '',
      ai_summary_updated_at: config.taste_ai_summary_updated_at || null,
      // Calcolato come in Profilo dei gusti; generi con i nomi canonici (inglesi)
      profile: {
        top_genres: taste.topGenres,
        avoid_genres: taste.avoidGenres,
        top_keywords: taste.topKeywords,
        liked: taste.likedShows,
        disliked: taste.dislikedShows,
        most_watched_neutral: taste.neutralShows,
        series_count: taste.totalShows,
        feedback_count: taste.feedbackCount,
      },
    },
    series,
    unmatched,
    bookmarks: bookmarkEntries(db),
    recommendations: recommendationBatches(db),
    history,
  }
}

/** Nome del file scaricato: watchsense-<kind>-YYYY-MM-DD.<ext> (data locale del server). */
export function exportFileName(kind: 'history' | 'profile', ext: 'csv' | 'json', now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `watchsense-${kind}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${ext}`
}
