/**
 * Deduplicazione cross-fonte delle visioni Prime Video.
 *
 * Bookmarklet e CSV di cronologia scrivono la stessa visione con chiavi diverse:
 * - bookmarklet: title = serie, episode_title = "Episodio 3: …" (film: "(film)")
 * - CSV:         title = serie ripulita, episode_title = "Serie - Stagione 1: Episodio 3: …"
 *                (film: episode_title = titolo grezzo)
 * Il vincolo UNIQUE(title, platform, watched_at, episode_title) non le riconosce
 * come uguali: questo modulo confronta le righe Prime dello stesso giorno.
 *
 * Anche lo stesso CSV riscaricato in tempi diversi cambia i nomi degli episodi (Amazon
 * li ha restituiti in lingue diverse: "Episodio 5: Farma" → "Episodio 5: The Farm"):
 * se entrambe le righe dichiarano numero di stagione ed episodio, quelli decidono.
 *
 * Al contrario, bookmarklet e CSV possono numerare diversamente lo stesso episodio
 * (Battlestar Galactica: "Episodio 2: Six of One" contro "Season 4: Episodio 4: Six of
 * One") e datarlo a cavallo della mezzanotte con un giorno di differenza: tra una riga
 * del bookmarklet e una del CSV decide allora il nome dell'episodio (vedi samePrimeView).
 */
import type Database from 'better-sqlite3'
import { cleanTitle } from './ingest-normalize'

/** Titolo confrontabile: minuscolo, spazi compressi, senza suffissi di stagione. */
export function normalizePrimeTitle(title: string): string {
  const collapsed = (title || '').trim().replace(/\s+/g, ' ')
  return (cleanTitle(collapsed, 'bookmarklet') || collapsed).toLowerCase()
}

/** Riga "film": episode_title assente, uguale al titolo (CSV) o "(film)" (bookmarklet). */
function isMovieRow(title: string, episodeTitle: string | null): boolean {
  return !episodeTitle || episodeTitle === '(film)' || episodeTitle.trim() === title.trim()
}

function titlesCompatible(a: string, b: string): boolean {
  return a === b || a.startsWith(b) || b.startsWith(a)
}

/** Un episode_title è l'altro preceduto da "<qualcosa>: ". */
function episodesMatch(a: string, b: string): boolean {
  return a.endsWith(`: ${b}`) || b.endsWith(`: ${a}`)
}

// Marcatore di stagione / episodio con numero: "Season 2", "Stagione 10", "série 1",
// "Staffel 9", "Serie 3", "Stage 1"; "Episodio 5", "Episode 5", "Folge 5", "Épisode 5".
const SEASON_MARK = /(?:^|[\s:–\-(])(?:season|stagione|staffel|saison|s[ée]rie|series|temporada|stage)\s*0*(\d{1,3})(?!\d)/iu
const SHORT_SEASON_MARK = /(?:^|[\s:–\-(])S0*(\d{1,2})(?![\p{L}\p{N}])/u
const EPISODE_MARK = /(?:^|[\s:–\-(])(?:episodio|episode|épisode|folge)\s*0*(\d{1,4})(?!\d)/iu
const SXEY_MARK = /(?:^|[\s:–\-(])S0*(\d{1,3})\s*E0*(\d{1,4})(?!\d)/iu

/**
 * Numero di stagione ed episodio dichiarati da un episode_title Prime, null se manca
 * uno dei due. Forma del CSV: "<titolo grezzo con la stagione>: Episodio N: nome".
 * La stagione deve comparire PRIMA del primo marcatore di episodio: così il nome
 * dell'episodio ("Episodio 3: Season of the Witch", "… Season 10 Episode 1 Black")
 * non viene mai letto come stagione. Accetta anche "S1E3".
 */
export function primeEpisodeNumbers(episodeTitle: string | null | undefined): { season: number; episode: number } | null {
  const text = (episodeTitle || '').trim()
  if (!text) return null
  const ep = EPISODE_MARK.exec(text)
  const sxe = SXEY_MARK.exec(text)
  if (sxe && (!ep || sxe.index < ep.index)) return { season: Number(sxe[1]), episode: Number(sxe[2]) }
  if (!ep) return null
  const prefix = text.slice(0, ep.index + 1)
  const season = SEASON_MARK.exec(prefix) || SHORT_SEASON_MARK.exec(prefix)
  if (!season) return null
  return { season: Number(season[1]), episode: Number(ep[1]) }
}

/** Titolo che non nomina la serie ("", "Stagione 01", "Season 1"): serie diverse si confondono. */
const SEASON_ONLY_TITLE = /^(?:(?:stagione|season)\s*\d+)?$/i

// "<marcatore di episodio> N: nome", il primo nel testo (come in primeEpisodeNumbers)
const EPISODE_NAME = /(?:^|[\s:–\-(])(?:episodio|episode|épisode|folge)\s*\d{1,4}\s*:\s*(.+)$/iu
// Nomi che non identificano un episodio: "Episodio 3", "Parte 2", "Part 1", "3"
const GENERIC_EPISODE_NAME = /^(?:(?:episodio|episode|épisode|folge|parte?|teil|partie|capitolo|chapter)\s*)?\d*$/iu

/**
 * Nome dell'episodio dopo "Episodio N: " (minuscolo, spazi compressi), null se manca o
 * se è generico ("Episodio 3", "Parte 2"): da solo non distinguerebbe gli episodi.
 */
export function primeEpisodeName(episodeTitle: string | null | undefined): string | null {
  const m = EPISODE_NAME.exec((episodeTitle || '').trim())
  if (!m) return null
  const name = m[1]!.trim().replace(/\s+/g, ' ').toLowerCase()
  if (!/\p{L}/u.test(name) || GENERIC_EPISODE_NAME.test(name)) return null
  return name
}

/** episode_title del bookmarklet: comincia con "Episodio N:" (il CSV lo fa precedere dal titolo grezzo). */
function isBookmarkletEpisode(episodeTitle: string): boolean {
  return /^(?:episodio|episode|épisode|folge)\s*\d{1,4}\s*:/iu.test(episodeTitle.trim())
}

/** Giorni tra due date "YYYY-MM-DD…" (NaN se una non è una data). */
function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86_400_000
}

export interface PrimeView {
  title: string
  watchedAt: string | null
  episodeTitle: string | null
}

/**
 * True se due righe Prime descrivono la stessa visione (stessa riga logica salvata da due
 * fonti o da due download del CSV): `a` è la riga già salvata, `b` quella nuova (conta solo
 * per la regola 1b). Senza data: mai (decide solo l'UNIQUE).
 *
 * Stesso giorno:
 *   1. chiave identica;
 *   1b. nuova riga CSV senza nome della serie ("Stagione 01" + "Stagione 01: Episodio 1: The
 *       Tick: Pilot") e riga salvata con lo stesso episode_title completo (rinominata a mano
 *       con la serie);
 *   2a. film: entrambe "film" e titolo normalizzato identico;
 *   2b. episodi: un episode_title è suffisso ": …" dell'altro e titoli serie compatibili;
 *   2c. stessa serie (titolo normalizzato identico) e stessi numeri di stagione ed episodio
 *       dichiarati da entrambe, anche se i nomi differiscono.
 * Stesso giorno o giorni consecutivi:
 *   2d. una riga del bookmarklet e una del CSV (mai due della stessa fonte: due visioni
 *       vere con lo stesso nome restano), stessa serie (titolo normalizzato identico, non
 *       solo "Stagione N") e stesso nome dell'episodio non generico (primeEpisodeName),
 *       anche se i numeri differiscono.
 */
export function samePrimeView(a: PrimeView, b: PrimeView): boolean {
  if (!a.watchedAt || !b.watchedAt) return false
  const aEp = a.episodeTitle || null
  const bEp = b.episodeTitle || null
  const sameDay = a.watchedAt === b.watchedAt

  if (sameDay) {
    // 1) chiave identica (già coperto dal vincolo UNIQUE)
    if (a.title === b.title && aEp === bEp) return true
  }

  const aTitle = normalizePrimeTitle(a.title)
  const bTitle = normalizePrimeTitle(b.title)
  const aIsMovie = isMovieRow(a.title, aEp)
  const bIsMovie = isMovieRow(b.title, bEp)

  if (sameDay) {
    // 1b) nuova riga "Stagione 01" con lo stesso episode_title completo di una già salvata
    if (bEp && aEp === bEp && !bIsMovie && SEASON_ONLY_TITLE.test(bTitle)) return true
  }

  // 2a) film
  if (aIsMovie || bIsMovie) return sameDay && aIsMovie && bIsMovie && aTitle === bTitle

  if (sameDay) {
    // 2b) un episode_title è suffisso ": …" dell'altro
    if (aEp && bEp && episodesMatch(aEp, bEp) && titlesCompatible(aTitle, bTitle)) return true

    // 2c) stessi numeri di stagione ed episodio
    if (aTitle === bTitle && !SEASON_ONLY_TITLE.test(aTitle)) {
      const an = primeEpisodeNumbers(aEp)
      const bn = an && primeEpisodeNumbers(bEp)
      if (an && bn && an.season === bn.season && an.episode === bn.episode) return true
    }
  }

  // 2d) bookmarklet ↔ CSV: stesso nome dell'episodio, al massimo un giorno di distanza
  if (aEp && bEp && aTitle === bTitle && !SEASON_ONLY_TITLE.test(aTitle)
    && isBookmarkletEpisode(aEp) !== isBookmarkletEpisode(bEp)
    && daysApart(a.watchedAt, b.watchedAt) <= 1) {
    const name = primeEpisodeName(aEp)
    if (name && name === primeEpisodeName(bEp)) return true
  }
  return false
}

/** Giorno prima e dopo di una data "YYYY-MM-DD" (null se non è una data). */
function adjacentDays(watchedAt: string): [string, string] | null {
  const t = Date.parse(watchedAt.slice(0, 10))
  if (Number.isNaN(t)) return null
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return [day(t - 86_400_000), day(t + 86_400_000)]
}

const stmtCache = new WeakMap<Database.Database, Database.Statement>()

/**
 * True se nel DB esiste già una riga Prime per la stessa visione (samePrimeView: stesso
 * giorno o, per bookmarklet ↔ CSV, giorno adiacente), scritta da questa o dall'altra fonte.
 * Senza data non si deduplica oltre l'UNIQUE.
 */
export function primeViewExists(db: Database.Database, view: PrimeView): boolean {
  if (!view.watchedAt) return false

  let stmt = stmtCache.get(db)
  if (!stmt) {
    // Usa idx_shows_platform_date (platform, watched_at)
    stmt = db.prepare(`
      SELECT title, watched_at, episode_title FROM shows
      WHERE platform = 'prime' AND (watched_at = @day OR watched_at BETWEEN @from AND @to)
    `)
    stmtCache.set(db, stmt)
  }
  const around = adjacentDays(view.watchedAt)
  // Fuori da [from, to] se non è una data: resta solo il confronto sullo stesso giorno
  const rows = stmt.all({ day: view.watchedAt, from: around?.[0] ?? '', to: around ? `${around[1]}\uffff` : '' }) as
    { title: string; watched_at: string; episode_title: string | null }[]
  return rows.some(row => samePrimeView({ title: row.title, watchedAt: row.watched_at, episodeTitle: row.episode_title }, view))
}
