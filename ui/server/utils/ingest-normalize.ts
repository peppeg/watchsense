/**
 * Normalizzazione condivisa dagli import: titolo della serie dal titolo grezzo
 * e piattaforma dal nome di un provider di streaming.
 *
 * I titoli puliti finiscono nella chiave UNIQUE(title, platform, watched_at, episode_title)
 * di `shows`: ogni fonte mantiene esattamente le proprie regole storiche (profilo),
 * altrimenti un reimport degli stessi dati produrrebbe titoli diversi e righe duplicate.
 */

/**
 * Regole di pulizia per fonte:
 * - `netflix`: CSV Netflix e sync via cookie. "Serie: Stagione 1: Episodio" → "Serie"
 *   (solo se la seconda parte nomina stagione/season/series).
 * - `prime-history`: CSV di cronologia Prime; porting Unicode della vecchia CLI Python
 *   (`\p{L}`, `\p{Nd}`), con suffissi "stagione N", "Season N", "prima stagione", ….
 * - `bookmarklet`: stesse regole di `prime-history` ma con classi ASCII (`\w`, `\d`)
 *   come l'ingest storico; vale per Netflix e Prime. Usata anche dal confronto
 *   cross-fonte delle visioni Prime (prime-dedup).
 * - `prime-legacy`: CSV Prime semplice (titolo, data): solo "stagione/season/N° stagione".
 *
 * I profili Prime e `bookmarklet` tolgono poi i marcatori di stagione in coda in altre
 * lingue/forme (vedi stripSeasonSuffix); `netflix` solo sulla parte della serie quando
 * il titolo è già stato diviso su "Stagione/Season".
 *
 * Tutti i profili decodificano prima le entità HTML (decodeHtmlEntities, un solo passaggio).
 *
 * Restituisce il titolo ripulito (può essere vuoto): il fallback al grezzo è del chiamante.
 */
export type TitleProfile = 'netflix' | 'prime-history' | 'bookmarklet' | 'prime-legacy'

const PRIME_HISTORY_SUFFIX = new RegExp(
  '[\\s:–\\-(]+(?:stagione|season|the complete [\\p{L}\\p{N}_]+ season|prima stagione|seconda stagione|terza stagione|quarta stagione|quinta stagione|sesta stagione|settima stagione|ottava stagione|nona stagione|decima stagione|\\p{Nd}+° stagione|\\p{Nd}+ª stagione)[\\s\\p{Nd})]*.*$',
  'iu',
)
const PRIME_HISTORY_TAIL = /\s*[:–-]\s*(?:season|stagione)\s*\p{Nd}+.*$/iu

const BOOKMARKLET_SUFFIX = /[\s:\–\-(]+(?:stagione|season|the complete \w+ season|prima stagione|seconda stagione|terza stagione|quarta stagione|quinta stagione|sesta stagione|settima stagione|ottava stagione|nona stagione|decima stagione|\d+[°ª] stagione)[\s\d)]*.*$/i
const BOOKMARKLET_TAIL = /\s*[\:\–\-]\s*(?:season|stagione)\s*\d+.*$/i

const PRIME_LEGACY_SUFFIX = /[\s:–\-(]+(?:stagione|season|\d+[°ª] stagione)[\s\d)]*.*$/i

// Marcatori di stagione in coda, sempre preceduti da un separatore e (tranne i tag tra
// parentesi quadre) seguiti da un numero a fine titolo: una parola reale ("Stage",
// "La serie", "9-1-1") senza numero finale non viene toccata.
const SEASON_SUFFIXES: RegExp[] = [
  // tag di edizione/lingua: "[dt./OV]", "[OmU]", "[4K UHD]"
  /\s*\[[^\[\]]*\]$/u,
  // "Serie 3", "- série 1", "saison 2", "Staffel 9", "temporada 1", "Series 2", "seizoen 1", "sezon 1"
  /[\s:–\-(]+(?:s[ée]rie|series|saison|staffel|temporada|seizoen|sezon)\s*\d+\)?$/iu,
  // "Naruto - Stage 1": solo con trattino/due punti davanti
  /\s*[:–-]\s*stage\s*\d+$/iu,
  // "Mao S1", "Serie S02" (S maiuscola, numero breve)
  /\s+S\d{1,2}$/u,
  // "Grey's Anatomy (Yr 3 2006/2007)"
  /\s*\((?:yr|year)\s*\d+[^()]*\)$/iu,
]

/**
 * Toglie in coda marcatori di stagione/edizione non coperti dalle regole storiche
 * ("Misfits: Serie 3", "Naruto - Stage 1", "Grey's Anatomy - Staffel 9 [dt./OV]",
 * "Mao S1", "Battlestar Galactica - série 1"). Ripete finché cambia qualcosa; non
 * restituisce mai una stringa vuota (in quel caso tiene l'ultimo titolo non vuoto).
 */
export function stripSeasonSuffix(title: string): string {
  let current = (title || '').trim()
  for (let changed = true; changed;) {
    changed = false
    for (const re of SEASON_SUFFIXES) {
      const next = current.replace(re, '').trim()
      if (next && next !== current) {
        current = next
        changed = true
      }
    }
  }
  return current
}

// Entità HTML che le fonti scrappate lasciano nei titoli ("Agatha Christie&#39;s Poirot"
// dal CSV/bookmarklet Prime): numeriche (decimali ed esadecimali) e le named comuni.
const HTML_ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|quot|apos|lt|gt|nbsp));/g
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>',
  // spazio normale: un titolo non ha bisogno di spazi non separabili, e così chiavi e ricerche coincidono
  nbsp: ' ',
}

/** Il testo contiene almeno un'entità che decodeHtmlEntities sa decodificare. */
export function hasHtmlEntity(text: string | null | undefined): boolean {
  return !!text && text.includes('&') && decodeHtmlEntities(text) !== text
}

/**
 * Decodifica le entità HTML in UN solo passaggio: "&amp;amp;" diventa "&amp;", non "&"
 * (il risultato non viene ridecodificato). Code point non validi (0, surrogati, oltre
 * U+10FFFF) restano come sono; &#160; diventa uno spazio come &nbsp;.
 */
export function decodeHtmlEntities(text: string): string {
  if (!text || !text.includes('&')) return text
  return text.replace(HTML_ENTITY, (match, dec?: string, hex?: string, named?: string) => {
    if (named) return NAMED_ENTITIES[named]!
    const cp = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex!, 16)
    if (!cp || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return match
    return cp === 0xA0 ? ' ' : String.fromCodePoint(cp)
  })
}

/** Come decodeHtmlEntities, ma lascia passare null/undefined (episode_title opzionali). */
export function decodeOptionalEntities<T extends string | null | undefined>(text: T): T {
  return (typeof text === 'string' ? decodeHtmlEntities(text) : text) as T
}

export function cleanTitle(rawTitle: string, profile: TitleProfile): string {
  // Entità HTML decodificate prima delle regole di pulizia, per tutti i profili
  const raw = decodeHtmlEntities(rawTitle || '')
  switch (profile) {
    case 'netflix': {
      const parts = raw.split(':')
      // " : Episodio 6": Netflix ha tolto il nome della serie, nessun titolo
      if (parts.length >= 2 && !parts[0]!.trim()) return ''
      if (parts.length >= 2 && /stagione|season|series/i.test(parts[1]!)) return stripSeasonSuffix(parts[0]!)
      return raw.trim()
    }
    case 'prime-history':
      return stripSeasonSuffix(raw.trim().replace(PRIME_HISTORY_SUFFIX, '').trim().replace(PRIME_HISTORY_TAIL, '').trim())
    case 'bookmarklet':
      return stripSeasonSuffix(raw.trim().replace(BOOKMARKLET_SUFFIX, '').trim().replace(BOOKMARKLET_TAIL, '').trim())
    case 'prime-legacy':
      return stripSeasonSuffix(raw.replace(PRIME_LEGACY_SUFFIX, '').trim())
  }
}

/**
 * Piattaforma interna (valori di `shows.platform` e chiavi della dashboard) dal nome
 * di un provider TMDB o da un testo libero ("Netflix, Prime Video"); '' se sconosciuta.
 * Il primo provider riconosciuto nell'ordine qui sotto vince.
 */
export function platformFromProvider(name: string | null | undefined): string {
  const lower = (name || '').toLowerCase()
  if (lower.includes('netflix')) return 'netflix'
  if (lower.includes('prime')) return 'prime'
  if (lower.includes('disney')) return 'disney'
  if (lower.includes('apple')) return 'appletv'
  if (lower.includes('paramount')) return 'paramount'
  if (lower.includes('hbo') || lower.includes('max')) return 'max'
  if (lower.includes('now') || lower.includes('sky')) return 'nowtv'
  return ''
}

/** Segnaposto storico per un episodio senza nome (sync via cookie Netflix, ingest). */
export const UNKNOWN_EPISODE = 'Episodio guardato'

export interface UnnamedEpisode {
  /** Titolo grezzo della serie (seriesTitle Netflix / titolo Prime), prima di cleanTitle. */
  seriesTitle: string
  /** Titolo completo dell'elemento (Netflix `title`: "Serie: Stagione 1: Episodio"). */
  fullTitle?: string | null
  /** Netflix `seasonDescriptor` ("Stagione 1", "Miniserie", …). */
  seasonDescriptor?: string | null
  /** Id stabile dell'episodio (Netflix `movieID`, Prime `gti`). */
  episodeId?: string | number | null
}

/**
 * episode_title per un episodio di cui la fonte non dà il nome. Fa parte della chiave
 * UNIQUE(title, platform, watched_at, episode_title): un segnaposto fisso faceva
 * collassare in una sola riga episodi diversi della stessa serie visti lo stesso giorno.
 * In ordine di preferenza, sempre da dati reali e stabili tra un import e l'altro:
 *   1. il resto del titolo completo dopo "Serie: " ("Stagione 1: Episodio"), che
 *      coincide con la forma del CSV e resta riconoscibile da netflix-dedup;
 *   2. l'id dell'episodio: "<seasonDescriptor | Episodio guardato> (#<id>)";
 *   3. come prima: seasonDescriptor, altrimenti 'Episodio guardato' (episodi dello
 *      stesso giorno indistinguibili: nessun dato per separarli).
 * `legacy` elenca gli episode_title con cui le versioni precedenti avrebbero salvato
 * la stessa visione: se una di quelle righe esiste (stesso titolo, piattaforma e
 * giorno) la visione è già importata, così i reimport restano idempotenti senza
 * riscrivere le righe esistenti.
 */
export function unnamedEpisodeTitle(ep: UnnamedEpisode): { episodeTitle: string; legacy: string[] } {
  const season = (ep.seasonDescriptor || '').trim()
  const legacy = [...new Set([season, UNKNOWN_EPISODE, 'Episodio'].filter(Boolean))]

  const series = (ep.seriesTitle || '').trim()
  const full = (ep.fullTitle || '').trim()
  let episodeTitle = ''
  if (series && full.length > series.length + 2 && full.startsWith(`${series}:`)) {
    episodeTitle = full.slice(series.length + 1).trim()
  }
  const id = ep.episodeId == null ? '' : String(ep.episodeId).trim()
  if (!episodeTitle && id) episodeTitle = `${season || UNKNOWN_EPISODE} (#${id})`
  if (!episodeTitle) episodeTitle = season || UNKNOWN_EPISODE

  return { episodeTitle, legacy: legacy.filter(t => t !== episodeTitle) }
}
