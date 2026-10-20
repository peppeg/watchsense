/**
 * Abbinamento manuale di una serie a un id TMDB (Libreria → "Abbina su TMDB", scheda serie
 * → "Abbinamento errato? Correggi").
 *
 * Gruppo di righe da abbinare (sempre e solo media_type 'tv'):
 * - serie senza abbinamento: le righe con tmdb_id NULL e stesso (title, platform), cioè
 *   come la Libreria elenca le serie non abbinate;
 * - serie abbinata male: tutte le righe con quel tmdb_id.
 *
 * Le righe ricevono il nuovo tmdb_id e i metadati TMDB freschi (stesso arricchimento degli
 * import: fetchTmdbEnrichment + applyTmdbEnrichment), tutto in una transazione.
 *
 * Non serve un flag "manuale": nessun processo riscrive un tmdb_id già presente
 * (rematchUnmatchedSeries tocca solo righe con tmdb_id NULL, l'arricchimento solo righe
 * senza metadati dello stesso id) e gli import riusano l'abbinamento esistente per lo
 * stesso (title, platform) invece di cercare di nuovo su TMDB (vedi runIngest).
 */
import { getDb } from './db'
import { applyTmdbEnrichment, fetchTmdbEnrichment } from './sync-helpers'
import { seriesRows } from './series-filter'
import { isSeasonOnlyTitle } from './ingest'
import { moveSeriesExclusions } from './show-exclusions'
import { userMessage, type UserMessage } from './user-message'

/** Colonne dei metadati TMDB: si azzerano prima di riscriverle (applyTmdbEnrichment
 *  scrive solo sulle righe con tmdb_genres NULL). */
const ENRICHMENT_COLUMNS = [
  'tmdb_name', 'tmdb_genres', 'tmdb_overview', 'tmdb_keywords', 'tmdb_networks',
  'tmdb_watch_providers', 'tmdb_vote_avg', 'tmdb_status', 'enriched_at', 'poster_path',
  'backdrop_path', 'tmdb_number_of_episodes', 'tmdb_number_of_seasons', 'tmdb_first_air_date',
  'tmdb_aired_episodes',
]

export type MatchTarget =
  | { kind: 'unmatched'; title: string; platform: string }
  | { kind: 'matched'; fromTmdbId: number }

/** Errore con codice HTTP e messaggio per l'utente (l'endpoint lo trasforma in createError). */
export class MatchError extends Error {
  /** Messaggio con codice per la UI; i testi senza codice (richieste malformate) restano solo testo. */
  public userMessage: UserMessage
  constructor(public statusCode: number, message: string | UserMessage) {
    super(typeof message === 'string' ? message : message.message)
    this.userMessage = typeof message === 'string' ? { code: '', message } : message
  }
}

const MAX_TEXT = 500

function positiveId(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * Body di POST /api/match/apply:
 *   { tmdb_id, title, platform }  → serie non abbinata
 *   { tmdb_id, from_tmdb_id }     → serie abbinata male
 */
export function parseMatchRequest(body: any): { tmdbId: number; target: MatchTarget } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new MatchError(400, 'Richiesta non valida: atteso un oggetto JSON.')
  }
  const tmdbId = positiveId(body.tmdb_id)
  if (!tmdbId) throw new MatchError(400, 'tmdb_id mancante o non valido.')

  if (body.from_tmdb_id !== undefined && body.from_tmdb_id !== null) {
    const fromTmdbId = positiveId(body.from_tmdb_id)
    if (!fromTmdbId) throw new MatchError(400, 'from_tmdb_id non valido.')
    if (fromTmdbId === tmdbId) throw new MatchError(400, userMessage('match.alreadyMatched'))
    return { tmdbId, target: { kind: 'matched', fromTmdbId } }
  }

  const { title, platform } = body
  if (typeof title !== 'string' || !title.trim() || title.length > MAX_TEXT) {
    throw new MatchError(400, 'Titolo della serie mancante o non valido.')
  }
  if (typeof platform !== 'string' || !platform.trim() || platform.length > MAX_TEXT) {
    throw new MatchError(400, 'Piattaforma mancante o non valida.')
  }
  // "Stagione 1", "Season 01": sono più serie diverse sotto un solo nome, restano senza abbinamento
  if (isSeasonOnlyTitle(title)) {
    throw new MatchError(400, userMessage('match.seasonOnly'))
  }
  // title/platform esatti (sono la chiave del gruppo come la restituisce /api/match/unmatched)
  return { tmdbId, target: { kind: 'unmatched', title, platform } }
}

export interface MatchResult {
  tmdbId: number
  name: string
  /** Righe di shows ricollegate. */
  rows: number
}

/** Righe del gruppo, condizione SQL + parametri. */
function groupWhere(target: MatchTarget): { where: string; params: unknown[] } {
  return target.kind === 'unmatched'
    ? { where: "media_type = 'tv' AND tmdb_id IS NULL AND title = ? AND platform = ?", params: [target.title, target.platform] }
    : { where: "media_type = 'tv' AND tmdb_id = ?", params: [target.fromTmdbId] }
}

export async function applyManualMatch(tmdbId: number, target: MatchTarget): Promise<MatchResult> {
  const db = getDb()
  const { where, params } = groupWhere(target)
  const count = (db.prepare(`SELECT COUNT(*) AS c FROM shows WHERE ${where}`).get(...params) as { c: number }).c
  if (!count) throw new MatchError(404, userMessage('match.noViews'))

  // Prima la chiamata TMDB (fuori dalla transazione): conferma anche che l'id è una serie
  const data = await fetchTmdbEnrichment(tmdbId, 'tv')
  if (!data) throw new MatchError(502, userMessage('match.tmdbNotFound'))

  const result = db.transaction(() => {
    // Il gruppo si rilegge dentro la transazione: nel frattempo un import può averlo cambiato
    const rows = db.prepare(`SELECT id, platform FROM shows WHERE ${where}`).all(...params) as { id: number; platform: string }[]
    if (!rows.length) throw new MatchError(404, userMessage('match.noViews'))
    const update = db.prepare(`
      UPDATE shows SET tmdb_id = ?, media_type = 'tv', ${ENRICHMENT_COLUMNS.map(c => `${c} = NULL`).join(', ')}
      WHERE id = ?
    `)
    for (const row of rows) update.run(tmdbId, row.id)
    for (const platform of new Set(rows.map(r => r.platform))) applyTmdbEnrichment(data, tmdbId, 'tv', platform)
    // Serie ignorata o esclusa dal profilo: l'esclusione segue le visioni sul nuovo id
    if (target.kind === 'matched') moveSeriesExclusions(target.fromTmdbId, tmdbId)
    return { tmdbId, name: data.name, rows: rows.length }
  }).immediate()
  return result
}

export interface UnmatchedSeries {
  title: string
  platform: string
  episode_count: number
  last_watched: string | null
}

/** Serie senza abbinamento TMDB, una per (title, platform), come le raggruppa applyManualMatch.
 *  Esclusi i titoli solo "Stagione N" (serie diverse con lo stesso nome: restano non abbinate). */
export function listUnmatchedSeries(): UnmatchedSeries[] {
  return (getDb().prepare(`
    SELECT title, platform,
      COUNT(DISTINCT COALESCE(episode_title, id)) AS episode_count,
      MAX(watched_at) AS last_watched
    FROM shows
    WHERE ${seriesRows()} AND tmdb_id IS NULL
    GROUP BY title, platform
    ORDER BY last_watched DESC, title
  `).all() as UnmatchedSeries[]).filter(s => !isSeasonOnlyTitle(s.title))
}
