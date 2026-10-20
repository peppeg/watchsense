/**
 * Parsing dei CSV di cronologia (Netflix, prime watch-history CSV).
 *
 * Il formato Prime replica esattamente la vecchia CLI Python (`cmd_import_prime` /
 * `_parse_prime_title`, rimossa nel commit d404785): le righe già importate da lì
 * hanno chiave UNIQUE(title, platform, watched_at, episode_title) e un reimport
 * deve produrre gli stessi valori per non duplicarle.
 */
import { cleanTitle, decodeHtmlEntities } from './ingest-normalize'
import { userMessage, UserMessageError } from './user-message'

export interface HistoryRecord {
  title: string
  platform: string
  watched_at: string | null
  episode_title: string | null
  /** 'movie' solo se il CSV lo dichiara (Prime Type = Movie); altrimenti 'tv' = tipo ignoto, ricerca serie-prima. */
  media_type: 'tv' | 'movie'
  /** Titolo grezzo del CSV Netflix: serve solo alla deduplicazione cross-fonte (netflix-dedup). */
  raw_title?: string
}

/**
 * Parser CSV RFC 4180 (come il modulo `csv` di Python con i default):
 * campi tra virgolette con virgole, newline e `""` al loro interno, CRLF/LF,
 * BOM UTF-8 iniziale rimosso. Le righe completamente vuote vengono saltate.
 * I valori non vengono trimmati.
 */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const n = text.length

  const endRow = () => {
    row.push(field)
    field = ''
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
  }

  while (i < n) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"' && field === '') { inQuotes = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r') { endRow(); i += text[i + 1] === '\n' ? 2 : 1; continue }
    if (c === '\n') { endRow(); i++; continue }
    field += c
    i++
  }
  if (field !== '' || row.length > 0) endRow()
  return rows
}

export type CsvFormat = 'prime-history' | 'prime-legacy' | 'netflix'

/** Header normalizzato (minuscolo, trim) per il rilevamento del formato. */
export function normalizeHeader(header: string[]): string[] {
  return header.map(h => h.trim().toLowerCase())
}

export function isPrimeHistoryHeader(header: string[]): boolean {
  const h = normalizeHeader(header)
  return h.includes('date watched') && h.includes('title')
}

/**
 * Determina il formato. `platform` è il valore scelto nella UI ('auto' | 'netflix' | 'prime').
 */
export function detectCsvFormat(header: string[], platform: string): CsvFormat {
  const h = normalizeHeader(header)
  if (platform === 'netflix') return 'netflix'
  if (isPrimeHistoryHeader(header)) return 'prime-history'
  if (platform === 'prime') return 'prime-legacy'
  if (h.includes('title') && h.includes('date')) return 'netflix'
  if (h.some(x => x.includes('prime') || x.includes('playback') || x.includes('video'))) return 'prime-legacy'
  return 'netflix'
}

// ─── Prime Video watch-history CSV (Date Watched, Type, Title, Episode Title, …) ─

// Regole di pulizia: profilo 'prime-history' di cleanTitle (porting Unicode delle regex Python)
const PRIME_ONLY_SEASON = /^stagione\s+\p{Nd}+$/iu

/** Porting di `_parse_prime_title`: nome della serie dai campi del prime watch-history CSV. */
export function parsePrimeTitle(title: string, episodeTitle: string, contentType: string): string {
  // Titolo grezzo con le entità HTML decodificate (come fa cleanTitle), per i ripieghi
  const raw = decodeHtmlEntities(title).trim()
  if (contentType === 'Movie') return raw

  const cleaned = cleanTitle(title, 'prime-history')

  // Difetto legacy mantenuto per compatibilità con le righe esistenti:
  // se il titolo è solo "Stagione XX" resta tale.
  if (PRIME_ONLY_SEASON.test(cleaned) && episodeTitle) return raw

  return cleaned || raw
}

/** Come `datetime.strptime(s[:10], "%Y-%m-%d").strftime("%Y-%m-%d")`, null se non valida. */
export function parsePrimeDate(raw: string): string | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.slice(0, 10))
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

/** Righe -> record, colonne per nome (come csv.DictReader). */
export function parsePrimeHistory(rows: string[][]): HistoryRecord[] {
  const header = rows[0].map(h => h.trim())
  const col = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase())
  const iTitle = col('Title')
  const iType = col('Type')
  const iEpisode = col('Episode Title')
  const iDate = col('Date Watched')
  const get = (row: string[], idx: number) => (idx >= 0 ? (row[idx] ?? '') : '').trim()

  const out: HistoryRecord[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const rawTitle = get(row, iTitle)
    if (!rawTitle) continue
    const contentType = get(row, iType)
    const episodeTitle = get(row, iEpisode)
    const dateStr = get(row, iDate)

    out.push({
      title: parsePrimeTitle(rawTitle, episodeTitle, contentType),
      platform: 'prime',
      watched_at: dateStr ? parsePrimeDate(dateStr) : null,
      episode_title: episodeTitle ? `${rawTitle}: ${episodeTitle}` : rawTitle,
      media_type: contentType === 'Movie' ? 'movie' : 'tv',
    })
  }
  return out
}

// ─── Prime Video, formato semplice (titolo, data per posizione) ────────────

export function parsePrimeLegacy(rows: string[][]): HistoryRecord[] {
  const out: HistoryRecord[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r].map(v => v.trim())
    const rawTitle = row[0] || ''
    if (!rawTitle) continue
    const title = cleanTitle(rawTitle, 'prime-legacy')
    out.push({
      title: title || decodeHtmlEntities(rawTitle),
      platform: 'prime',
      watched_at: row[1] || null,
      episode_title: rawTitle,
      media_type: 'tv',
    })
  }
  return out
}

// ─── Netflix (NetflixViewingHistory.csv) ───────────────────────────────────

/**
 * Ordine delle date numeriche "a-b-c" del CSV Netflix (separatori `/`, `.` o `-`):
 * l'export usa il formato della lingua del profilo, `M/D/YY` (USA) o `DD/MM/YYYY` (IT/UE).
 * - `auto`: deciso dall'intero file; se tutte le date sono ambigue (giorno ≤ 12) vale DMY.
 * - `DMY` / `MDY`: usato solo se il file è del tutto ambiguo (le date con un campo > 12 decidono).
 */
export type NetflixDateFormat = 'auto' | 'DMY' | 'MDY'

/** Come è stato scelto l'ordine giorno/mese applicato. */
export type DateFormatSource = 'detected' | 'chosen' | 'default'

/** File con date sia giorno/mese sia mese/giorno: nessun ordine è corretto per tutte. */
export class InconsistentDateFormatError extends UserMessageError {
  constructor(public dmySample: string, public mdySample: string) {
    super(userMessage('imports.csv.inconsistentDates', { dmy: dmySample, mdy: mdySample }))
  }
}

export interface NetflixParseResult {
  records: HistoryRecord[]
  /** Ordine applicato alle date a-b-c; null se il file non ne contiene. */
  dateFormat: 'DMY' | 'MDY' | null
  dateFormatSource: DateFormatSource | null
  /** Righe scartate perché la data non è riconosciuta o non è una data di calendario reale. */
  invalidDates: number
  /** Esempi (al massimo 3) di date scartate, per il messaggio. */
  invalidSamples: string[]
}

/** YYYY-MM-DD se (y, m, d) è una data di calendario reale, altrimenti null. */
function isoDate(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const YMD_DATE = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/
const XYY_DATE = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{2}|\d{4})$/

function parseYear(raw: string): number {
  return raw.length === 2 ? 2000 + Number(raw) : Number(raw)
}

/**
 * Data Netflix -> YYYY-MM-DD, null se non riconosciuta o non valida.
 * Accetta `YYYY-MM-DD` (anche con `/` o `.`) e `a/b/YY[YY]` (anche con `.` o `-`)
 * nell'ordine `order`; anni a due cifre = 20YY.
 */
export function parseNetflixDate(raw: string, order: 'DMY' | 'MDY'): string | null {
  const s = raw.trim()
  let m = YMD_DATE.exec(s)
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]))
  m = XYY_DATE.exec(s)
  if (!m) return null
  const a = Number(m[1]), b = Number(m[3]), y = parseYear(m[4]!)
  return order === 'DMY' ? isoDate(y, b, a) : isoDate(y, a, b)
}

/**
 * Ordine giorno/mese dell'intero file. Un primo campo tra 13 e 31 (con il secondo ≤ 12)
 * è prova di DMY, il viceversa di MDY; prove di entrambi i tipi -> errore.
 */
export function detectNetflixDateFormat(
  dates: string[],
  preferred: NetflixDateFormat = 'auto',
): { dateFormat: 'DMY' | 'MDY' | null, source: DateFormatSource | null } {
  let dmy: string | null = null
  let mdy: string | null = null
  let any = false
  for (const raw of dates) {
    const m = XYY_DATE.exec(raw.trim())
    if (!m) continue
    any = true
    const a = Number(m[1]), b = Number(m[3])
    if (a > 12 && a <= 31 && b >= 1 && b <= 12) dmy ??= raw.trim()
    else if (b > 12 && b <= 31 && a >= 1 && a <= 12) mdy ??= raw.trim()
  }
  if (dmy && mdy) {
    throw new InconsistentDateFormatError(dmy, mdy)
  }
  if (dmy) return { dateFormat: 'DMY', source: 'detected' }
  if (mdy) return { dateFormat: 'MDY', source: 'detected' }
  if (!any) return { dateFormat: null, source: null }
  if (preferred === 'DMY' || preferred === 'MDY') return { dateFormat: preferred, source: 'chosen' }
  return { dateFormat: 'DMY', source: 'default' }
}

/**
 * Righe -> record. Le righe con data non riconosciuta o non valida (es. 31/02/26) sono
 * scartate e contate; una data vuota resta NULL. Lancia InconsistentDateFormatError.
 */
export function parseNetflix(rows: string[][], preferred: NetflixDateFormat = 'auto'): NetflixParseResult {
  const header = normalizeHeader(rows[0])
  const titleIdx = header.indexOf('title')
  const dateIdx = header.indexOf('date')
  const result: NetflixParseResult = {
    records: [], dateFormat: null, dateFormatSource: null, invalidDates: 0, invalidSamples: [],
  }
  if (titleIdx < 0) return result

  const entries: { rawTitle: string, rawDate: string }[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r].map(v => v.trim())
    if (row.length <= titleIdx) continue
    const rawTitle = row[titleIdx]
    if (!rawTitle) continue
    entries.push({ rawTitle, rawDate: dateIdx >= 0 ? (row[dateIdx] || '') : '' })
  }

  const { dateFormat, source } = detectNetflixDateFormat(entries.map(e => e.rawDate), preferred)
  result.dateFormat = dateFormat
  result.dateFormatSource = source

  for (const { rawTitle, rawDate } of entries) {
    let watchedAt: string | null = null
    if (rawDate) {
      watchedAt = parseNetflixDate(rawDate, dateFormat ?? 'DMY')
      if (!watchedAt) {
        result.invalidDates++
        if (result.invalidSamples.length < 3) result.invalidSamples.push(rawDate)
        continue
      }
    }
    const title = cleanTitle(rawTitle, 'netflix')
    result.records.push({
      title,
      platform: 'netflix',
      watched_at: watchedAt,
      // Il CSV Netflix non distingue i film: 'tv' (ricerca serie-prima), poi vale il tipo abbinato
      // confronto sul grezzo decodificato: un'entità HTML da sola non rende il titolo "diverso"
      episode_title: decodeHtmlEntities(rawTitle) !== title ? rawTitle : 'Episodio',
      media_type: 'tv',
      raw_title: rawTitle,
    })
  }
  return result
}
