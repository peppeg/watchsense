/**
 * Deduplicazione cross-fonte delle visioni Netflix.
 *
 * La stessa visione può arrivare da fonti che la scrivono con chiavi diverse:
 * - CSV (NetflixViewingHistory.csv): titolo grezzo "Serie: Stagione 1: Episodio";
 *   title = serie ripulita ed episode_title = titolo grezzo, oppure (se la pulizia non
 *   cambia nulla, es. film o "Serie: Episodio") title = grezzo ed episode_title = 'Episodio';
 * - vecchia CLI Python: title = serie, episode_title = titolo grezzo (film: episode_title = title);
 * - sync via cookie e bookmarklet: title = serie (seriesTitle) ed episode_title = solo il nome
 *   dell'episodio, oppure '(film)' / 'Episodio' / 'Episodio guardato' come segnaposto;
 *   un episodio senza nome ha "Stagione 1: Episodio" (dal titolo completo) oppure
 *   "<Stagione 1 | Episodio guardato> (#movieID)" (vedi unnamedEpisodeTitle).
 * Il vincolo UNIQUE(title, platform, watched_at, episode_title) non le riconosce come uguali:
 * questo modulo confronta le righe Netflix dello stesso giorno.
 *
 * Regola guida: meglio lasciar passare un duplicato che scartare una visione diversa
 * (due episodi diversi della stessa serie lo stesso giorno restano entrambi).
 */
import type Database from 'better-sqlite3'

export interface NetflixView {
  title: string
  watchedAt: string | null
  episodeTitle: string | null
  /** Titolo grezzo del CSV ("Serie: Stagione 1: Episodio"), se noto. */
  rawTitle?: string | null
}

/**
 * Forma confrontabile di una visione:
 * - `full`: titolo grezzo completo, come nel CSV;
 * - `partial`: serie + solo nome dell'episodio (sync via cookie / bookmarklet);
 * - `unknown`: episodio non identificabile ('Episodio guardato', anche con "(#id)"): mai
 *   deduplicata. Le forme "Stagione 1 (#id)" sono `partial` ma, non comparendo in nessun'altra
 *   fonte, corrispondono solo a sé stesse.
 */
export type NetflixShape =
  | { kind: 'full'; full: string }
  | { kind: 'partial'; title: string; episode: string }
  | { kind: 'unknown' }

/** Minuscolo, spazi compressi, spazi attorno ai ':' uniformati a ": ". */
function norm(s: string | null | undefined): string {
  return (s || '').trim().replace(/\s+/g, ' ').replace(/\s*:\s*/g, ': ').toLowerCase()
}

/** Segnaposto "nessun nome di episodio" in cui il titolo è l'intero titolo grezzo. */
const TITLE_ONLY_MARKERS = new Set(['', '(film)', 'episodio'])

/**
 * Interpretazioni possibili di una riga (di solito una sola). title = episode_title è
 * ambiguo: film della CLI oppure episodio che si chiama come la serie (sync/bookmarklet).
 */
export function netflixShapes(view: Pick<NetflixView, 'title' | 'episodeTitle' | 'rawTitle'>): NetflixShape[] {
  const raw = norm(view.rawTitle)
  if (raw) return [{ kind: 'full', full: raw }]

  const title = norm(view.title)
  const ep = norm(view.episodeTitle)
  if (ep === 'episodio guardato' || /^episodio guardato \(#[^)]*\)$/.test(ep)) return [{ kind: 'unknown' }]
  // CLI con titolo grezzo senza serie (": Episodio 3"): title = '' ed episode_title = grezzo
  if (!title) return [TITLE_ONLY_MARKERS.has(ep) ? { kind: 'unknown' } : { kind: 'full', full: ep }]
  // Film / titolo singolo: CSV ('Episodio'), sync/bookmarklet ('(film)')
  if (TITLE_ONLY_MARKERS.has(ep)) return [{ kind: 'full', full: title }]
  // Film della CLI (episode_title = title) o episodio omonimo della serie
  if (ep === title) return [{ kind: 'full', full: title }, { kind: 'partial', title, episode: ep }]
  // CSV / CLI: episode_title è il titolo grezzo "Serie: …"
  if (ep.startsWith(`${title}: `)) return [{ kind: 'full', full: ep }]
  return [{ kind: 'partial', title, episode: ep }]
}

/** "Serie: [Stagione/Miniserie/…: ]Episodio" corrisponde a serie + nome episodio. */
function fullMatchesPartial(full: string, title: string, episode: string): boolean {
  return full.length >= title.length + 2 + episode.length
    && full.startsWith(`${title}: `)
    && (full === `${title}: ${episode}` || full.endsWith(`: ${episode}`))
}

/** True se due forme descrivono la stessa visione (stesso giorno assunto dal chiamante). */
export function netflixShapesMatch(a: NetflixShape, b: NetflixShape): boolean {
  if (a.kind === 'unknown' || b.kind === 'unknown') return false
  if (a.kind === 'full' && b.kind === 'full') return a.full === b.full
  if (a.kind === 'partial' && b.kind === 'partial') return a.title === b.title && a.episode === b.episode
  const full = a.kind === 'full' ? a : b as Extract<NetflixShape, { kind: 'full' }>
  const partial = a.kind === 'partial' ? a : b as Extract<NetflixShape, { kind: 'partial' }>
  return fullMatchesPartial(full.full, partial.title, partial.episode)
}

const stmtCache = new WeakMap<Database.Database, Database.Statement>()

/**
 * True se nel DB esiste già, con chiave diversa, una riga Netflix per la stessa visione
 * (stesso giorno) scritta da un'altra fonte. Una riga con la stessa chiave esatta è lasciata
 * al vincolo UNIQUE (conta come "già presente"). Senza data non si deduplica.
 */
export function netflixViewExists(db: Database.Database, view: NetflixView): boolean {
  if (!view.watchedAt) return false
  const shapes = netflixShapes(view)
  if (shapes.every(s => s.kind === 'unknown')) return false

  let stmt = stmtCache.get(db)
  if (!stmt) {
    // Usa idx_shows_platform_date (platform, watched_at)
    stmt = db.prepare("SELECT title, episode_title FROM shows WHERE platform = 'netflix' AND watched_at = ?")
    stmtCache.set(db, stmt)
  }
  const rows = stmt.all(view.watchedAt) as { title: string; episode_title: string | null }[]
  const newEp = view.episodeTitle ?? null

  for (const row of rows) {
    if (row.title === view.title && row.episode_title === newEp) return false
  }
  for (const row of rows) {
    const rowShapes = netflixShapes({ title: row.title, episodeTitle: row.episode_title })
    if (shapes.some(a => rowShapes.some(b => netflixShapesMatch(a, b)))) return true
  }
  return false
}
