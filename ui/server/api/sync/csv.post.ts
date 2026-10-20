import { moviesNoteParts, runIngest } from '../../utils/ingest'
import { userError, userMessage, type MessagePart } from '../../utils/user-message'
import {
  parseCsv,
  detectCsvFormat,
  parsePrimeHistory,
  parsePrimeLegacy,
  parseNetflix,
  InconsistentDateFormatError,
  type CsvFormat,
  type NetflixDateFormat,
  type NetflixParseResult,
  type HistoryRecord,
} from '../../utils/csv-import'

const ALLOWED_PLATFORMS = new Set(['auto', 'netflix', 'prime'])

// Etichette come codici del dizionario (imports.csv.*): la UI le traduce nel messaggio
const FORMAT_LABEL: Record<CsvFormat, MessagePart> = {
  'prime-history': { code: 'imports.csv.format.primeHistory' },
  'prime-legacy': { code: 'imports.csv.format.primeLegacy' },
  'netflix': { code: 'imports.csv.format.netflix' },
}

function parseDateFormat(raw: unknown): NetflixDateFormat {
  const v = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  if (v === 'DMY' || v === 'MDY') return v
  return 'auto'
}

export default defineEventHandler(async (event) => {
  let csvContent = ''
  let explicitPlatform = 'auto'
  let dateFormatParam: NetflixDateFormat = 'auto'

  const contentType = getHeader(event, 'content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    const formData = await readMultipartFormData(event)
    for (const part of formData || []) {
      if (part.name === 'file' || part.filename) {
        csvContent = part.data.toString('utf8')
      }
      if (part.name === 'platform') {
        explicitPlatform = part.data.toString('utf8').trim().toLowerCase()
      }
      if (part.name === 'dateFormat') {
        dateFormatParam = parseDateFormat(part.data.toString('utf8'))
      }
    }
  } else {
    const body: any = await readBody(event).catch(() => ({}))
    csvContent = typeof body?.csvContent === 'string' ? body.csvContent : ''
    explicitPlatform = typeof body?.platform === 'string' ? body.platform.trim().toLowerCase() : 'auto'
    dateFormatParam = parseDateFormat(body?.dateFormat)
  }

  if (!ALLOWED_PLATFORMS.has(explicitPlatform)) explicitPlatform = 'auto'

  if (!csvContent || csvContent.trim().length === 0) {
    throw userError(400, userMessage('imports.csv.empty'))
  }

  const rows = parseCsv(csvContent)
  if (rows.length < 2) {
    throw userError(400, userMessage('imports.csv.invalid'))
  }

  const format = detectCsvFormat(rows[0], explicitPlatform)
  let netflix: NetflixParseResult | null = null
  if (format === 'netflix') {
    try {
      netflix = parseNetflix(rows, dateFormatParam)
    } catch (err) {
      if (err instanceof InconsistentDateFormatError) {
        throw userError(400, err.userMessage)
      }
      throw err
    }
  }
  const records: HistoryRecord[] =
    format === 'prime-history' ? parsePrimeHistory(rows)
    : format === 'prime-legacy' ? parsePrimeLegacy(rows)
    : netflix!.records
  const platform = format === 'netflix' ? 'netflix' : 'prime'

  // Inserimento in transazione, poi una ricerca TMDB per titolo distinto (e tipo dichiarato)
  // solo per le righe nuove: i film dichiarati (Prime Type = Movie) si cercano prima tra i film.
  const result = await runIngest(records.map(r => ({
    title: r.title,
    platform: r.platform,
    watchedAt: r.watched_at || null,
    episodeTitle: r.episode_title || null,
    mediaType: r.media_type,
    rawTitle: r.raw_title ?? null,
  })))
  const imported = result.inserted - result.moviesInserted
  const skipped = result.existing + result.deduped

  const msg = userMessage('imports.csv.done', { format: FORMAT_LABEL[format], imported, skipped }, [
    ...moviesNoteParts(result),
    netflix?.dateFormat && netflix.dateFormatSource
      ? {
          code: 'imports.csv.note.dates',
          params: {
            format: { code: `imports.csv.dateFormat.${netflix.dateFormat}` },
            source: { code: `imports.csv.dateSource.${netflix.dateFormatSource}` },
          },
        }
      : null,
    netflix && netflix.invalidDates > 0
      ? {
          code: 'imports.csv.note.invalidDates',
          params: { count: netflix.invalidDates, samples: netflix.invalidSamples.map(d => `"${d}"`).join(', ') },
        }
      : null,
  ])

  return {
    ok: true,
    platform,
    format,
    formatLabel: userMessage(FORMAT_LABEL[format].code).message,
    rowsProcessed: records.length,
    imported,
    moviesInserted: result.moviesInserted,
    skipped,
    skippedNoTitle: result.emptyTitle,
    showsEnriched: result.enriched,
    dateFormat: netflix?.dateFormat ?? null,
    dateFormatSource: netflix?.dateFormatSource ?? null,
    invalidDates: netflix?.invalidDates ?? 0,
    ...msg,
  }
})
