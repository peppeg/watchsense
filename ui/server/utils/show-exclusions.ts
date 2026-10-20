/**
 * Esclusioni scelte dall'utente (tabella show_exclusions, migrazione v7):
 * - scope 'all': serie ignorata (non si mostra né si usa da nessuna parte; nulla si cancella).
 *   Per una serie non abbinata (pannello "serie non abbinate") la chiave è (title, platform),
 *   per una serie abbinata (scheda serie) è (tmdb_id, media_type);
 * - scope 'profile': serie esclusa dal profilo dei gusti (solo serie abbinate). Resta in
 *   liste e statistiche ma non alimenta profilo, consigli e consigli AI simili.
 *
 * I filtri delle letture sono in series-filter.ts.
 */
import { getDb } from './db'
import { isSeasonOnlyTitle } from './ingest'
import { userMessage, type UserMessage } from './user-message'

export type ExclusionScope = 'all' | 'profile'

export type ExclusionTarget =
  | { kind: 'group'; title: string; platform: string }
  | { kind: 'series'; tmdbId: number; mediaType: 'tv' | 'movie' }

export interface ExclusionRequest {
  scope: ExclusionScope
  target: ExclusionTarget
  /** true = escludi, false = ripristina */
  excluded: boolean
}

/** Errore con codice HTTP e messaggio per l'utente (l'endpoint lo trasforma in createError). */
export class ExclusionError extends Error {
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
 * Body di POST /api/exclusions:
 *   { scope: 'all', title, platform, excluded? }          → gruppo non abbinato
 *   { scope: 'all' | 'profile', tmdb_id, media_type?, excluded? } → serie abbinata
 * `excluded` (default true): false ripristina.
 */
export function parseExclusionRequest(body: any): ExclusionRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ExclusionError(400, 'Richiesta non valida: atteso un oggetto JSON.')
  }
  const scope = body.scope ?? 'all'
  if (scope !== 'all' && scope !== 'profile') {
    throw new ExclusionError(400, "scope non valido: atteso 'all' o 'profile'.")
  }
  if (body.excluded !== undefined && typeof body.excluded !== 'boolean') {
    throw new ExclusionError(400, 'excluded deve essere true o false.')
  }
  const excluded = body.excluded ?? true

  if (body.tmdb_id !== undefined && body.tmdb_id !== null) {
    const tmdbId = positiveId(body.tmdb_id)
    if (!tmdbId) throw new ExclusionError(400, 'tmdb_id non valido.')
    const mediaType = body.media_type ?? 'tv'
    if (mediaType !== 'tv' && mediaType !== 'movie') {
      throw new ExclusionError(400, "media_type non valido: atteso 'tv' o 'movie'.")
    }
    return { scope, excluded, target: { kind: 'series', tmdbId, mediaType } }
  }

  if (scope === 'profile') {
    throw new ExclusionError(400, userMessage('exclusions.profileNeedsMatch'))
  }
  const { title, platform } = body
  if (typeof title !== 'string' || !title.trim() || title.length > MAX_TEXT) {
    throw new ExclusionError(400, 'Titolo della serie mancante o non valido.')
  }
  if (typeof platform !== 'string' || !platform.trim() || platform.length > MAX_TEXT) {
    throw new ExclusionError(400, 'Piattaforma mancante o non valida.')
  }
  // title/platform esatti: sono la chiave del gruppo come la restituisce /api/match/unmatched
  return { scope, excluded, target: { kind: 'group', title, platform } }
}

/** Nome da mostrare per il gruppo, o null se non c'è nessuna visione corrispondente. */
function targetLabel(target: ExclusionTarget): string | null {
  const db = getDb()
  if (target.kind === 'group') {
    const row = db.prepare("SELECT 1 FROM shows WHERE title = ? AND platform = ? AND media_type = 'tv' LIMIT 1")
      .get(target.title, target.platform)
    return row ? target.title : null
  }
  const row = db.prepare(`
    SELECT COALESCE(tmdb_name, title) AS name FROM shows
    WHERE tmdb_id = ? AND media_type = ? ORDER BY tmdb_name IS NULL LIMIT 1
  `).get(target.tmdbId, target.mediaType) as { name: string } | undefined
  return row?.name ?? null
}

/** Applica (o rimuove) un'esclusione. Idempotente. */
export function setExclusion(req: ExclusionRequest): void {
  const db = getDb()
  const { scope, target } = req
  if (!req.excluded) {
    if (target.kind === 'group') {
      db.prepare('DELETE FROM show_exclusions WHERE tmdb_id IS NULL AND title = ? AND platform = ?')
        .run(target.title, target.platform)
    } else {
      db.prepare('DELETE FROM show_exclusions WHERE tmdb_id = ? AND media_type = ? AND scope = ?')
        .run(target.tmdbId, target.mediaType, scope)
    }
    return
  }

  if (target.kind === 'group' && isSeasonOnlyTitle(target.title)) {
    // Coerente con /api/match/unmatched, che non li elenca
    throw new ExclusionError(400, userMessage('exclusions.seasonOnly'))
  }
  const label = targetLabel(target)
  if (!label) throw new ExclusionError(404, userMessage('exclusions.noViews'))

  if (target.kind === 'group') {
    db.prepare(`
      INSERT OR IGNORE INTO show_exclusions (scope, title, platform, label) VALUES ('all', ?, ?, ?)
    `).run(target.title, target.platform, label)
  } else {
    db.prepare(`
      INSERT OR IGNORE INTO show_exclusions (scope, tmdb_id, media_type, label) VALUES (?, ?, ?, ?)
    `).run(scope, target.tmdbId, target.mediaType, label)
  }
}

/** Esclusioni attive di una serie abbinata (per la scheda serie). */
export function exclusionState(tmdbId: number, mediaType: 'tv' | 'movie'): { ignored: boolean; profileExcluded: boolean } {
  const rows = getDb().prepare('SELECT scope FROM show_exclusions WHERE tmdb_id = ? AND media_type = ?')
    .all(tmdbId, mediaType) as { scope: ExclusionScope }[]
  return {
    ignored: rows.some(r => r.scope === 'all'),
    profileExcluded: rows.some(r => r.scope === 'profile'),
  }
}

export interface ExclusionEntry {
  id: number
  scope: ExclusionScope
  tmdb_id: number | null
  media_type: 'tv' | 'movie'
  title: string | null
  platform: string | null
  label: string
  created_at: string | null
}

/** Elenco delle esclusioni per scope, le più recenti prima. */
export function listExclusions(): { ignored: ExclusionEntry[]; profileExcluded: ExclusionEntry[] } {
  const rows = getDb().prepare(`
    SELECT id, scope, tmdb_id, media_type, title, platform, label, created_at
    FROM show_exclusions ORDER BY created_at DESC, id DESC
  `).all() as ExclusionEntry[]
  return {
    ignored: rows.filter(r => r.scope === 'all'),
    profileExcluded: rows.filter(r => r.scope === 'profile'),
  }
}

/**
 * Abbinamento manuale corretto da `fromTmdbId` a `toTmdbId` (manual-match): le esclusioni
 * della serie seguono le sue visioni. Va chiamata nella stessa transazione dell'abbinamento.
 */
export function moveSeriesExclusions(fromTmdbId: number, toTmdbId: number): void {
  getDb().prepare(`
    UPDATE OR REPLACE show_exclusions SET tmdb_id = ?
    WHERE tmdb_id = ? AND media_type = 'tv'
  `).run(toTmdbId, fromTmdbId)
}
