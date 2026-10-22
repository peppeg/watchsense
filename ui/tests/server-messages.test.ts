import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'h3'
import { hasKey, renderServerMessage } from '../app/locales/i18n'

// DB su file temporaneo: getDb() lo apre (e lo migra) al primo uso
const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')

// Gli handler Nitro usano gli auto-import di h3: qui bastano versioni minime
vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('readBody', async (event: any) => event.body)
vi.stubGlobal('createError', createError)

const { getDb } = await import('../server/utils/db')
const { userMessage, userError, messageFields } = await import('../server/utils/user-message')
const { setSyncStatus } = await import('../server/utils/sync-helpers')
const { moviesNote, moviesNoteParts } = await import('../server/utils/ingest')
const { MatchError, parseMatchRequest } = await import('../server/utils/manual-match')
const { InconsistentDateFormatError, parseNetflix, parseCsv } = await import('../server/utils/csv-import')
const getConfig = (await import('../server/api/config.get')).default as any
const postConfig = (await import('../server/api/config.post')).default as any
const getLocale = (await import('../server/api/locale.get')).default as any

const ENV_KEYS = ['WATCHSENSE_LOCALE', 'TMDB_LANGUAGE', 'TMDB_REGION'] as const

afterAll(() => {
  vi.unstubAllGlobals()
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
  getDb().prepare("DELETE FROM config WHERE key IN ('app_locale', 'tmdb_language', 'tmdb_region') OR key LIKE 'last_sync_status_%'").run()
})

describe('testo italiano dei messaggi con codice: identico ai messaggi di prima', () => {
  it('sync Stremio con righe tolte, film e visioni senza titolo', () => {
    const msg = userMessage('sync.stremio.done', { titles: 12, episodes: 5 }, [
      { code: 'sync.note.rowsRemoved', params: { count: 1 } },
      ...moviesNoteParts({ moviesInserted: 2, emptyTitle: 1 }),
    ])
    expect(msg.message).toBe('Sincronizzazione Stremio completata: 12 titoli analizzati, 5 nuovi episodi registrati.'
      + ' 1 riga tolta (episodi non più segnati su Stremio, numerati male o doppioni).'
      + ' 2 film registrati, non mostrati. 1 visione senza titolo della serie ignorata.')
    expect(renderServerMessage('en', msg)).toBe('Stremio sync complete: 12 titles checked, 5 new episodes recorded.'
      + ' 1 row removed (episodes no longer marked on Stremio, misnumbered or duplicates).'
      + ' 2 movies recorded, not shown. 1 view without a series title ignored.')
  })

  it('moviesNote resta la stessa frase', () => {
    expect(moviesNote({ moviesInserted: 1 })).toBe(' 1 film registrato, non mostrato.')
    expect(moviesNote({ moviesInserted: 0, emptyTitle: 0 })).toBe('')
    expect(moviesNoteParts({ moviesInserted: 0 })).toEqual([])
  })

  it('errori Netflix: dettaglio annidato con codice o testo grezzo', () => {
    expect(userMessage('sync.netflix.failed', { detail: { code: 'sync.netflix.cookiesExpired' } }).message).toBe(
      'Errore nella sincronizzazione Netflix: Cookie Netflix scaduti o non validi. Effettua nuovamente il login a Netflix e copia i cookie aggiornati nelle Impostazioni.')
    expect(userMessage('sync.netflix.failed', { detail: { code: 'sync.netflix.unreachable', params: { cause: 'ENOTFOUND' } } }).message).toBe(
      'Errore nella sincronizzazione Netflix: impossibile contattare Netflix (ENOTFOUND).')
    expect(userMessage('sync.netflix.failed', { detail: { code: 'sync.netflix.http', params: { status: 503 } } }).message).toBe(
      'Errore nella sincronizzazione Netflix: Netflix ha risposto con codice HTTP 503.')
    expect(userMessage('sync.netflix.failed', { detail: 'boom' }).message).toBe('Errore nella sincronizzazione Netflix: boom')
  })

  it('import CSV con formato e note sulle date', () => {
    const msg = userMessage('imports.csv.done', { format: { code: 'imports.csv.format.primeHistory' }, imported: 3, skipped: 7 }, [
      { code: 'imports.csv.note.dates', params: { format: { code: 'imports.csv.dateFormat.DMY' }, source: { code: 'imports.csv.dateSource.detected' } } },
      { code: 'imports.csv.note.invalidDates', params: { count: 2, samples: '"x", "y"' } },
    ])
    expect(msg.message).toBe('Import CSV Prime Video (CSV cronologia) completato: 3 nuovi episodi aggiunti, 7 già presenti.'
      + ' Date lette come giorno/mese/anno (rilevato dal file). 2 righe scartate per data non valida (es. "x", "y").')
  })

  it('Trakt, riabbinamento, abbinamento manuale', () => {
    expect(userMessage('imports.trakt.done', { entries: 100, episodes: 40, newShows: 3, archived: 25 }).message).toBe(
      'Import Trakt completato: 100 voci lette, 40 nuovi episodi inseriti, 3 serie nuove (25 serie Trakt in archivio).')
    expect(userMessage('maintenance.rematch.done', { tried: 4, matched: 2, rows: 9, unmatched: 2 }).message).toBe(
      'Serie cercate: 4, abbinate: 2 (9 episodi), ancora non trovate: 2.')
    expect(userMessage('match.applied', { name: 'Dark', count: 1 }).message).toBe('Serie abbinata a "Dark" (1 visione).')
  })

  it('codice sconosciuto: il testo è il codice, mai vuoto', () => {
    expect(userMessage('sync.nonEsiste').message).toBe('sync.nonEsiste')
  })
})

describe('codici usati dal server', () => {
  function sources(path: string): string[] {
    return readdirSync(path).flatMap((name) => {
      const p = join(path, name)
      return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : []
    })
  }

  it('ogni codice letterale esiste nel dizionario', () => {
    const codes = new Set<string>()
    for (const file of sources(join(__dirname, '..', 'server'))) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/(?:userMessage\(|new LlmError\(|code: )'([a-z][\w.]*)'/gi)) codes.add(m[1]!)
      for (const m of text.matchAll(/'(errors\.config\.\w+)'/g)) codes.add(m[1]!)
    }
    expect(codes.size).toBeGreaterThan(30)
    expect([...codes].filter(c => !hasKey(c))).toEqual([])
  })
})

describe('codici negli esiti e negli errori', () => {
  it('lo stato della sync salvato ha codice, parametri, note e il testo italiano', async () => {
    const msg = userMessage('sync.netflix.done', { viewed: 20, episodes: 3 }, moviesNoteParts({ moviesInserted: 1 }))
    setSyncStatus('netflix', true, msg)
    const status = (await getConfig()).sync.netflix.last_status
    expect(status).toMatchObject({
      ok: true,
      code: 'sync.netflix.done',
      params: { viewed: 20, episodes: 3 },
      notes: [{ code: 'sync.note.movies', params: { count: 1 } }],
      message: 'Sincronizzazione Netflix riuscita: 20 visioni controllate, 3 nuovi episodi inseriti. 1 film registrato, non mostrato.',
    })
    expect(renderServerMessage('en', status)).toBe('Netflix sync succeeded: 20 views checked, 3 new episodes added. 1 movie recorded, not shown.')
  })

  it('uno stato fallito con codice tiene reason; uno solo testo resta com\'era', async () => {
    setSyncStatus('netflix', false, userMessage('sync.netflix.failed', { detail: { code: 'sync.netflix.cookiesExpired' } }), 'auth')
    setSyncStatus('stremio', false, 'Messaggio libero')
    const { sync } = await getConfig()
    expect(sync.netflix.last_status).toMatchObject({ ok: false, reason: 'auth', code: 'sync.netflix.failed' })
    expect(sync.stremio.last_status).toEqual({ ok: false, at: expect.any(String), message: 'Messaggio libero', reason: 'error' })
  })

  it('POST /api/config con lingua non valida: 400 con codice e testo italiano invariato', async () => {
    const err: any = await postConfig({ body: { locale: { app_locale: 'de' } } }).catch((e: any) => e)
    expect(err.statusCode).toBe(400)
    expect(err.message).toBe('Lingua dell\'app non valida (en, it)')
    expect(err.data).toEqual({ code: 'errors.config.invalidAppLocale' })
    expect(renderServerMessage('en', { ...err.data, message: err.message })).toBe('Invalid app language (en, it)')

    const ok = await postConfig({ body: {} })
    expect(ok).toEqual({ ok: true, code: 'settings.saved', message: 'Impostazioni salvate con successo' })
  })

  it('userError mette il codice in data accanto agli altri dati', () => {
    const err = userError(401, userMessage('sync.netflix.failed', { detail: 'x' }), { reason: 'auth' })
    expect(err.statusCode).toBe(401)
    expect(err.data).toEqual({ reason: 'auth', code: 'sync.netflix.failed', params: { detail: 'x' } })
    expect(messageFields({ code: '', message: 'solo testo' })).toEqual({})
  })

  it('errori delle utility: codice per i casi che l\'utente vede, solo testo per le richieste malformate', () => {
    const seasonOnly = (() => { try { parseMatchRequest({ tmdb_id: 1, title: 'Stagione 1', platform: 'prime' }) } catch (e) { return e } })() as any
    expect(seasonOnly).toBeInstanceOf(MatchError)
    expect(seasonOnly.userMessage.code).toBe('match.seasonOnly')
    expect(seasonOnly.message).toBe('Il titolo indica solo una stagione ("Stagione 1"): raggruppa serie diverse e non si può abbinare.')
    const malformed = (() => { try { parseMatchRequest(null) } catch (e) { return e } })() as any
    expect(malformed.userMessage.code).toBe('')

    const csv = parseCsv('Title,Date\nA,13/01/2024\nB,01/13/2024\n')
    const dates = (() => { try { parseNetflix(csv, 'auto') } catch (e) { return e } })() as any
    expect(dates).toBeInstanceOf(InconsistentDateFormatError)
    expect(dates.userMessage).toMatchObject({ code: 'imports.csv.inconsistentDates', params: { dmy: '13/01/2024', mdy: '01/13/2024' } })
    expect(dates.message).toBe('Formato delle date incoerente nel file: alcune date sono giorno/mese (es. "13/01/2024") '
      + 'e altre mese/giorno (es. "01/13/2024"). Correggi il file o scarica di nuovo l\'export da Netflix.')
  })
})

describe('GET /api/locale', () => {
  it('lingua e regione effettive', () => {
    expect(getLocale()).toEqual({ app_locale: 'en', tmdb_language: 'en-US', tmdb_region: 'US', supported_locales: ['en', 'it'] })
    getDb().prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('app_locale', 'it'), ('tmdb_language', 'it-IT'), ('tmdb_region', 'IT')").run()
    expect(getLocale()).toMatchObject({ app_locale: 'it', tmdb_language: 'it-IT', tmdb_region: 'IT' })
  })
})
