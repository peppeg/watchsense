/**
 * Pipeline condivisa degli import di visioni (bookmarklet, CSV, Netflix, Stremio, Trakt):
 *
 *   1. inserimento  — tutte le righe in un'unica transazione (INSERT OR IGNORE sulla chiave
 *                     UNIQUE(title, platform, watched_at, episode_title)); le visioni Prime e
 *                     Netflix già arrivate da un'altra fonte con chiave diversa vengono
 *                     scartate (prime-dedup, netflix-dedup); un episodio Stremio già
 *                     registrato non si reinserisce con un'altra data;
 *   2. abbinamento  — solo per le righe NUOVE senza tmdb_id: se la stessa serie (titolo +
 *                     piattaforma, righe 'tv') ha già un unico tmdb_id, anche abbinato a mano,
 *                     lo eredita senza ricerca; altrimenti una ricerca TMDB per chiave
 *                     distinta (id IMDb, oppure titolo normalizzato + tipo preferito),
 *                     memoizzata per tutta l'esecuzione, concorrenza limitata;
 *                     l'id si salva con il tipo dell'endpoint che l'ha restituito;
 *   3. arricchimento — ogni (tmdb_id, media_type) distinto al massimo una volta per esecuzione
 *                     (anche se tocca più piattaforme), concorrenza limitata. Si arricchiscono
 *                     le righe nuove e quelle già presenti, toccate dall'import, rimaste senza
 *                     metadati (ritenta gli arricchimenti falliti in passato).
 *
 * Un reimport degli stessi dati non inserisce righe e non fa ricerche TMDB.
 *
 * Stato di visione: le righe nuove abbinate a un titolo sono dati più recenti dello stato
 * scelto a mano nella scheda serie (show_user_status), che quindi cede (releaseExplicitStatus):
 * lo stato torna a dedursi dagli episodi importati.
 *
 * Film: WatchSense è un'app per serie TV. I film delle cronologie si registrano con
 * media_type 'movie' (stessa deduplica) ma restano "silenziosi": non si cercano né si
 * arricchiscono su TMDB (si conserva solo l'id fornito gratis dalla fonte, es. Trakt) e
 * le letture li escludono. Una riga di tipo ignoto che la ricerca abbina a un film
 * diventa 'movie' e non viene arricchita.
 */
import { getDb } from './db'
import { decodeOptionalEntities } from './ingest-normalize'
import { netflixViewExists } from './netflix-dedup'
import { primeViewExists } from './prime-dedup'
import { seriesRows } from './series-filter'
import type { MessagePart } from './user-message'
import { renderServerMessage } from '../../app/locales/i18n'
import {
  applyTmdbEnrichment,
  fetchTmdbEnrichment,
  resolveImdbToTmdb,
  searchTmdbByTitle,
  searchTmdbTvByTitle,
  type MediaType,
  type TmdbMatch,
} from './sync-helpers'

/** Richieste TMDB contemporanee (ricerche o arricchimenti) per esecuzione. */
export const TMDB_CONCURRENCY = 5

export interface IngestRow {
  /** Titolo già ripulito (vedi cleanTitle): fa parte della chiave UNIQUE. */
  title: string
  platform: string
  /** Salvati così come sono (null resta NULL, '' resta ''): fanno parte della chiave UNIQUE. */
  watchedAt: string | null
  episodeTitle: string | null
  /** Tipo dichiarato dalla fonte (o tipo di `tmdbId`); senza tipo noto 'tv' = ricerca serie-prima. */
  mediaType: MediaType
  /** Id TMDB già noto (del tipo `mediaType`): nessuna ricerca. */
  tmdbId?: number | null
  /** Id IMDb (Stremio): si risolve con /find prima di cercare per titolo. */
  imdbId?: string | null
  /** Titolo da cercare su TMDB se diverso da `title`. */
  searchTitle?: string
  /** Titolo grezzo della fonte (CSV Netflix): usato solo per riconoscere i duplicati cross-fonte. */
  rawTitle?: string | null
  /** episode_title con cui le versioni precedenti salvavano questa visione (segnaposto di un
   *  episodio senza nome, vedi unnamedEpisodeTitle): se esiste già una riga con la stessa
   *  chiave e uno di questi episode_title, la visione è già importata. */
  legacyEpisodeTitles?: string[]
}

export interface IngestResult {
  /** Righe ricevute dalla pipeline. */
  received: number
  inserted: number
  /** Di cui film (media_type 'movie'): registrati ma non mostrati. */
  moviesInserted: number
  /** Già presenti (vincolo UNIQUE). */
  existing: number
  /** Visioni già importate da un'altra fonte con chiave diversa (Prime: bookmarklet ↔ CSV;
   *  Netflix: sync via cookie ↔ bookmarklet ↔ CSV ↔ vecchia CLI; episodi senza nome
   *  già salvati con il vecchio segnaposto). */
  deduped: number
  /** Righe ignorate perché senza titolo della serie (CSV Netflix: " : Episodio 6"). */
  emptyTitle: number
  /** Righe nuove che hanno ereditato l'abbinamento della stessa serie (titolo + piattaforma). */
  inherited: number
  /** Chiavi di ricerca distinte e quante hanno trovato un id TMDB. */
  lookups: number
  matched: number
  /** Arricchimenti riusciti / falliti, uno per (tmdb_id, media_type). */
  enriched: number
  enrichFailed: number
  enrichLog: Array<{ tmdbId: number; mediaType: MediaType; name: string | null }>
}

type MoviesNoteInput = Pick<IngestResult, 'moviesInserted'> & Partial<Pick<IngestResult, 'emptyTitle'>>

/** Note dei messaggi degli import (codici `sync.note.*`): film registrati ma non mostrati,
 *  righe ignorate perché senza titolo della serie. Nessuna nota per i conteggi a 0. */
export function moviesNoteParts(result: MoviesNoteInput): MessagePart[] {
  const n = result.moviesInserted
  const e = result.emptyTitle ?? 0
  return [
    ...(n > 0 ? [{ code: 'sync.note.movies', params: { count: n } }] : []),
    ...(e > 0 ? [{ code: 'sync.note.emptyTitle', params: { count: e } }] : []),
  ]
}

/** Frase per i messaggi degli import: " N film registrati, non mostrati." (vuota se 0),
 *  più le righe ignorate perché senza titolo della serie. */
export function moviesNote(result: MoviesNoteInput): string {
  return moviesNoteParts(result).map(p => ` ${renderServerMessage('it', p)}`).join('')
}

/** Esegue `fn` su ogni elemento con al massimo `limit` promesse attive. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Chiave di memoizzazione: stesso titolo a meno di maiuscole/spazi = stessa ricerca TMDB. */
function lookupKey(row: IngestRow): string {
  const title = (row.searchTitle ?? row.title).trim().replace(/\s+/g, ' ').toLowerCase()
  return `${row.mediaType}\u0000${row.imdbId || ''}\u0000${title}`
}

/** Abbinamento di una riga: id IMDb (se c'è), poi titolo; tipo preferito = tipo dichiarato. */
async function resolveRow(row: IngestRow): Promise<TmdbMatch | null> {
  if (row.imdbId && row.imdbId.startsWith('tt')) {
    const match = await resolveImdbToTmdb(row.imdbId, row.mediaType)
    if (match) return match
  }
  const title = row.searchTitle ?? row.title
  return title ? searchTmdbByTitle(title, row.mediaType) : null
}

export async function runIngest(rows: IngestRow[], options: { concurrency?: number } = {}): Promise<IngestResult> {
  const db = getDb()
  const concurrency = options.concurrency ?? TMDB_CONCURRENCY
  const result: IngestResult = {
    received: rows.length,
    inserted: 0,
    moviesInserted: 0,
    existing: 0,
    deduped: 0,
    emptyTitle: 0,
    inherited: 0,
    lookups: 0,
    matched: 0,
    enriched: 0,
    enrichFailed: 0,
    enrichLog: [],
  }

  // (tmdb_id, media_type) → piattaforme da arricchire
  const toEnrich = new Map<string, { tmdbId: number; mediaType: MediaType; platforms: Set<string> }>()
  const queueEnrich = (tmdbId: number, mediaType: MediaType, platform: string) => {
    if (mediaType === 'movie') return // film: nessun arricchimento TMDB
    const key = `${mediaType}:${tmdbId}`
    const entry = toEnrich.get(key) || { tmdbId, mediaType, platforms: new Set<string>() }
    entry.platforms.add(platform)
    toEnrich.set(key, entry)
  }

  // Titoli che ricevono righe nuove: il loro stato esplicito cede ai dati importati
  const released = new Map<string, { tmdbId: number; mediaType: MediaType }>()
  const markNew = (tmdbId: number, mediaType: MediaType) => released.set(`${mediaType}:${tmdbId}`, { tmdbId, mediaType })

  // ── 1. Inserimento ──────────────────────────────────────────────────────
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO shows (title, platform, watched_at, episode_title, tmdb_id, media_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const existingStmt = db.prepare(`
    SELECT tmdb_id, media_type, tmdb_genres FROM shows
    WHERE title = ? AND platform = ? AND watched_at = ? AND episode_title = ?
  `)
  const stremioEpisodeStmt = db.prepare(`
    SELECT tmdb_id, media_type, tmdb_genres FROM shows
    WHERE title = ? AND platform = 'stremio' AND episode_title = ?
    ORDER BY watched_at IS NULL, watched_at, id
    LIMIT 1
  `)
  const legacyStmt = db.prepare(`
    SELECT 1 FROM shows
    WHERE title = ? AND platform = ? AND watched_at = ? AND episode_title IN (SELECT value FROM json_each(?))
    LIMIT 1
  `)
  // Abbinamento già noto per la stessa serie (stesso titolo e piattaforma), anche se fatto a
  // mano dalla Libreria: le visioni nuove lo ereditano invece di ricercare su TMDB (e
  // magari trovare di nuovo la serie sbagliata). Solo se è univoco.
  const knownMatchStmt = db.prepare(`
    SELECT DISTINCT tmdb_id FROM shows
    WHERE title = ? AND platform = ? AND media_type = 'tv' AND tmdb_id IS NOT NULL
    LIMIT 2
  `)
  const setTmdbId = db.prepare('UPDATE shows SET tmdb_id = ? WHERE id = ?')
  // Righe nuove da abbinare, raggruppate per chiave di ricerca
  const pending = new Map<string, { row: IngestRow; ids: number[]; platforms: Set<string> }>()

  const inheritMatch = (row: IngestRow, id: number): boolean => {
    // Titoli solo "Stagione N": serie diverse con lo stesso titolo, nessuna eredità
    if (row.mediaType !== 'tv' || row.imdbId || isSeasonOnlyTitle(row.title)) return false
    const known = knownMatchStmt.all(row.title, row.platform) as { tmdb_id: number }[]
    if (known.length !== 1) return false
    setTmdbId.run(known[0]!.tmdb_id, id)
    queueEnrich(known[0]!.tmdb_id, 'tv', row.platform)
    markNew(known[0]!.tmdb_id, 'tv')
    return true
  }

  db.transaction(() => {
    for (const input of rows) {
      // Visione senza il nome della serie: non identifica nulla, si ignora (non è un errore)
      if (!input.title?.trim()) {
        result.emptyTitle++
        continue
      }
      // Entità HTML ("&#39;") nei nomi degli episodi, per tutte le fonti: si decodificano qui,
      // una volta sola. Il titolo della serie no: lo fa già cleanTitle (ridecodificarlo
      // trasformerebbe "&amp;amp;" in "&").
      const row: IngestRow = {
        ...input,
        episodeTitle: decodeOptionalEntities(input.episodeTitle),
        rawTitle: decodeOptionalEntities(input.rawTitle),
        legacyEpisodeTitles: input.legacyEpisodeTitles?.map(t => decodeOptionalEntities(t)),
      }
      const watchedAt = row.watchedAt ?? null
      const episodeTitle = row.episodeTitle ?? null
      // Episodio senza nome già salvato con il vecchio segnaposto (prima che episodi diversi
      // dello stesso giorno avessero chiavi distinte): non si duplica e non si riscrive
      if (row.legacyEpisodeTitles?.length && watchedAt
        && !existingStmt.get(row.title, row.platform, watchedAt, episodeTitle)
        && legacyStmt.get(row.title, row.platform, watchedAt, JSON.stringify(row.legacyEpisodeTitles))) {
        result.deduped++
        continue
      }
      // Prime/Netflix: la stessa visione può essere già arrivata da un'altra fonte (chiavi diverse)
      if (row.platform === 'prime' && primeViewExists(db, { title: row.title, watchedAt, episodeTitle })) {
        result.deduped++
        continue
      }
      if (row.platform === 'netflix'
        && netflixViewExists(db, { title: row.title, watchedAt, episodeTitle, rawTitle: row.rawTitle })) {
        result.deduped++
        continue
      }
      // Stremio: lo stato è "episodio visto sì/no" con date ricavate (cambiano tra una sync e
      // l'altra): un episodio già registrato non si duplica con un'altra data
      if (row.platform === 'stremio' && episodeTitle) {
        const old = stremioEpisodeStmt.get(row.title, episodeTitle) as
          { tmdb_id: number | null; media_type: MediaType; tmdb_genres: string | null } | undefined
        if (old) {
          result.existing++
          if (old.tmdb_id && old.tmdb_genres === null) queueEnrich(old.tmdb_id, old.media_type, row.platform)
          continue
        }
      }
      const tmdbId = row.tmdbId || null
      const res = insertStmt.run(row.title, row.platform, watchedAt, episodeTitle, tmdbId, row.mediaType)
      if (res.changes > 0) {
        result.inserted++
        if (tmdbId) markNew(tmdbId, row.mediaType)
        if (row.mediaType === 'movie') {
          // Film: si tiene l'eventuale id della fonte, nessuna ricerca TMDB
          result.moviesInserted++
        } else if (tmdbId) {
          queueEnrich(tmdbId, row.mediaType, row.platform)
        } else if (inheritMatch(row, Number(res.lastInsertRowid))) {
          result.inherited++
        } else {
          const key = lookupKey(row)
          const group = pending.get(key) || { row, ids: [], platforms: new Set<string>() }
          group.ids.push(Number(res.lastInsertRowid))
          group.platforms.add(row.platform)
          pending.set(key, group)
        }
        continue
      }
      result.existing++
      // Riga già presente: se ha un id ma non i metadati, si ritenta l'arricchimento
      // (con NULL nella chiave l'INSERT non viene mai ignorato, quindi qui non servono)
      const old = existingStmt.get(row.title, row.platform, watchedAt, episodeTitle) as
        { tmdb_id: number | null; media_type: MediaType; tmdb_genres: string | null } | undefined
      if (old?.tmdb_id && old.tmdb_genres === null) queueEnrich(old.tmdb_id, old.media_type, row.platform)
    }
  })()

  // ── 2. Abbinamento TMDB (una ricerca per chiave distinta) ───────────────
  const groups = Array.from(pending.values()).filter(g => g.row.imdbId || (g.row.searchTitle ?? g.row.title))
  result.lookups = groups.length
  const matches = await mapWithConcurrency(groups, concurrency, async (g) => {
    try {
      return await resolveRow(g.row)
    } catch {
      return null
    }
  })

  const setTmdb = db.prepare('UPDATE shows SET tmdb_id = ?, media_type = ? WHERE id = ?')
  db.transaction(() => {
    groups.forEach((g, i) => {
      const match = matches[i]
      if (!match) return
      result.matched++
      if (match.mediaType === 'movie') result.moviesInserted += g.ids.length
      for (const id of g.ids) setTmdb.run(match.tmdbId, match.mediaType, id)
      for (const platform of g.platforms) queueEnrich(match.tmdbId, match.mediaType, platform)
      markNew(match.tmdbId, match.mediaType)
    })
    releaseExplicitStatus(Array.from(released.values()))
  })()

  // ── 3. Arricchimento (una volta per (tmdb_id, media_type)) ──────────────
  await enrichTargets(Array.from(toEnrich.values()), concurrency, result)

  return result
}

/**
 * Titoli che hanno ricevuto visioni importate nuove: lo stato scelto a mano nella scheda
 * serie (show_user_status) era stato deciso senza questi dati e non vale più, quindi si
 * cancella e lo stato torna a dedursi dagli episodi (utils/watch-status.ts). Si cancella
 * anche la riga segnaposto dell'aggiunta manuale ("in corso"/"completata" su una serie non
 * in libreria: is_manual = 1, senza episodio), che altrimenti conterebbe come un episodio
 * in più accanto a quelli veri. Da chiamare dentro una transazione.
 */
export function releaseExplicitStatus(titles: Array<{ tmdbId: number; mediaType: MediaType }>): number {
  if (!titles.length) return 0
  const db = getDb()
  const clearStatus = db.prepare('DELETE FROM show_user_status WHERE tmdb_id = ? AND media_type = ?')
  const clearPlaceholder = db.prepare(`
    DELETE FROM shows WHERE tmdb_id = ? AND media_type = ? AND is_manual = 1 AND episode_title IS NULL
      AND EXISTS (SELECT 1 FROM shows i WHERE i.tmdb_id = shows.tmdb_id AND i.media_type = shows.media_type AND i.is_manual = 0)
  `)
  let changes = 0
  for (const t of titles) {
    changes += clearStatus.run(t.tmdbId, t.mediaType).changes
    clearPlaceholder.run(t.tmdbId, t.mediaType)
  }
  return changes
}

type EnrichTarget = { tmdbId: number; mediaType: MediaType; platforms: Set<string> }

/** Arricchisce ogni (tmdb_id, media_type) una volta e scrive i metadati sulle righe delle sue piattaforme. */
async function enrichTargets(
  targets: EnrichTarget[],
  concurrency: number,
  result: Pick<IngestResult, 'enriched' | 'enrichFailed' | 'enrichLog'>,
): Promise<void> {
  const enrichments = await mapWithConcurrency(targets, concurrency, t => fetchTmdbEnrichment(t.tmdbId, t.mediaType))
  targets.forEach((t, i) => {
    const data = enrichments[i]
    let ok = false
    if (data) {
      try {
        for (const platform of t.platforms) applyTmdbEnrichment(data, t.tmdbId, t.mediaType, platform)
        ok = true
      } catch {}
    }
    if (ok) result.enriched++
    else result.enrichFailed++
    result.enrichLog.push({ tmdbId: t.tmdbId, mediaType: t.mediaType, name: ok ? data!.name : null })
  })
}

/** Titolo che non nomina la serie (righe Prime "Stagione 1" / "Season 01"): non si cerca. */
const SEASON_ONLY_TITLE = /^(?:stagione|season) ?\d+$/i

/** Titolo solo "Stagione N" / "Season 01": più serie diverse salvate con lo stesso nome. */
export function isSeasonOnlyTitle(title: string): boolean {
  return SEASON_ONLY_TITLE.test((title || '').trim().replace(/\s+/g, ' '))
}

export interface RematchResult {
  /** Titoli distinti cercati su TMDB (a meno di maiuscole/spazi, tutte le piattaforme). */
  titlesTried: number
  matched: number
  /** Righe di shows collegate a una serie. */
  rowsMatched: number
  stillUnmatched: number
  unmatchedTitles: string[]
  enriched: number
  enrichFailed: number
  enrichLog: IngestResult['enrichLog']
}

/**
 * Riabbina le serie rimaste senza tmdb_id (righe 'tv' con titolo non vuoto e non solo
 * "Stagione N"): una ricerca TMDB per titolo distinto, solo tra le serie (se TMDB trova
 * solo un film la riga resta senza id: i film sono silenziosi), concorrenza limitata, poi
 * lo stesso arricchimento degli import. Idempotente: le righe abbinate non si cercano più.
 */
export async function rematchUnmatchedSeries(options: { concurrency?: number } = {}): Promise<RematchResult> {
  const db = getDb()
  const concurrency = options.concurrency ?? TMDB_CONCURRENCY
  const rows = db.prepare(`
    SELECT DISTINCT title, platform FROM shows
    WHERE ${seriesRows()} AND tmdb_id IS NULL
    ORDER BY title, platform
  `).all() as { title: string; platform: string }[]

  // titolo normalizzato → titolo da cercare + coppie (title, platform) da aggiornare
  const groups = new Map<string, { query: string; pairs: { title: string; platform: string }[] }>()
  for (const row of rows) {
    const query = row.title.trim().replace(/\s+/g, ' ')
    if (SEASON_ONLY_TITLE.test(query)) continue
    const key = query.toLowerCase()
    const group = groups.get(key) || { query, pairs: [] }
    group.pairs.push(row)
    groups.set(key, group)
  }

  const list = Array.from(groups.values())
  const matches = await mapWithConcurrency(list, concurrency, async (g) => {
    try {
      return await searchTmdbTvByTitle(g.query)
    } catch {
      return null
    }
  })

  const result: RematchResult = {
    titlesTried: list.length,
    matched: 0,
    rowsMatched: 0,
    stillUnmatched: 0,
    unmatchedTitles: [],
    enriched: 0,
    enrichFailed: 0,
    enrichLog: [],
  }
  const toEnrich = new Map<number, EnrichTarget>()
  const setTmdb = db.prepare(`
    UPDATE shows SET tmdb_id = ?
    WHERE title = ? AND platform = ? AND media_type = 'tv' AND tmdb_id IS NULL
  `)
  db.transaction(() => {
    list.forEach((g, i) => {
      const match = matches[i]
      if (!match || match.mediaType !== 'tv') {
        result.stillUnmatched++
        result.unmatchedTitles.push(g.query)
        return
      }
      result.matched++
      const target = toEnrich.get(match.tmdbId) || { tmdbId: match.tmdbId, mediaType: 'tv' as const, platforms: new Set<string>() }
      for (const pair of g.pairs) {
        result.rowsMatched += setTmdb.run(match.tmdbId, pair.title, pair.platform).changes
        target.platforms.add(pair.platform)
      }
      toEnrich.set(match.tmdbId, target)
    })
    // Visioni importate appena collegate alla serie: lo stato scelto a mano cede anche qui
    releaseExplicitStatus(Array.from(toEnrich.keys(), tmdbId => ({ tmdbId, mediaType: 'tv' as const })))
  })()

  await enrichTargets(Array.from(toEnrich.values()), concurrency, result)
  return result
}
