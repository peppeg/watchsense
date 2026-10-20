import { afterEach, describe, expect, it } from 'vitest'
import {
  bookmarkletJsText,
  dictionaries,
  fetchErrorMessage,
  formatDateIn,
  formatDateTimeIn,
  formatNumberIn,
  hasKey,
  interpolate,
  intlLocale,
  normalizeLocale,
  renderServerMessage,
  splitPlaceholders,
  translate,
  translateKey,
  type MessageKey,
} from '../app/locales/i18n'

/** Percorsi delle foglie di un dizionario (le voci plurali come `x.one`, `x.other`). */
function leafPaths(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix]
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k))
}

/** Namespace (anche vuoti) e sotto-oggetti, per controllare che la struttura coincida. */
function objectPaths(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return []
  return [prefix, ...Object.entries(node).flatMap(([k, v]) => objectPaths(v, prefix ? `${prefix}.${k}` : k))]
}

describe('dizionari', () => {
  it('en e it hanno esattamente le stesse chiavi', () => {
    expect(leafPaths(dictionaries.it).sort()).toEqual(leafPaths(dictionaries.en).sort())
    expect(objectPaths(dictionaries.it).sort()).toEqual(objectPaths(dictionaries.en).sort())
  })

  it('nessun testo vuoto e i plurali hanno sempre one e other', () => {
    for (const locale of ['en', 'it'] as const) {
      for (const path of leafPaths(dictionaries[locale])) {
        expect(translateKey(locale, path), `${locale}:${path}`).not.toBe('')
      }
    }
    const plurals = objectPaths(dictionaries.en).filter(p => p && hasKey(p))
    expect(plurals).toContain('match.applied')
    for (const p of plurals) expect(Object.keys(translateKeyNode(p)).sort()).toEqual(['one', 'other'])
  })

  it('i namespace previsti dall\'ADR esistono', () => {
    for (const ns of ['common', 'nav', 'dashboard', 'library', 'show', 'recommendations', 'bookmarks', 'settings', 'login', 'status', 'errors', 'sync']) {
      expect(dictionaries.en, ns).toHaveProperty(ns)
    }
  })
})

function translateKeyNode(path: string): Record<string, unknown> {
  return path.split('.').reduce<any>((n, k) => n[k], dictionaries.en)
}

describe('t', () => {
  const saved = JSON.parse(JSON.stringify(dictionaries.it))
  afterEach(() => { dictionaries.it = JSON.parse(JSON.stringify(saved)) })

  it('traduce nelle due lingue', () => {
    expect(translate('it', 'nav.library')).toBe('Libreria')
    expect(translate('en', 'nav.library')).toBe('Library')
    expect(translate('it', 'nav.forYou')).toBe('Per te')
  })

  it('sostituisce i parametri {nome}, anche ripetuti; quelli mancanti restano', () => {
    expect(translate('en', 'errors.auth.tooManyAttempts', { seconds: 30 })).toBe('Too many attempts: try again in 30 seconds.')
    expect(interpolate('{a} e {a}, {b}', { a: 1 })).toBe('1 e 1, {b}')
    expect(interpolate('senza parametri')).toBe('senza parametri')
  })

  it('plurale: count 1 → one, altrimenti other', () => {
    expect(translate('it', 'match.applied', { name: 'Dark', count: 1 })).toBe('Serie abbinata a "Dark" (1 visione).')
    expect(translate('it', 'match.applied', { name: 'Dark', count: 3 })).toBe('Serie abbinata a "Dark" (3 visioni).')
    expect(translate('en', 'match.applied', { name: 'Dark', count: 0 })).toBe('Series matched to "Dark" (0 views).')
    expect(translate('en', 'sync.note.movies', { count: 1 })).toBe('1 movie recorded, not shown.')
  })

  it('chiave mancante in it → testo en; mancante ovunque → la chiave', () => {
    delete (dictionaries.it.nav as any).library
    expect(translate('it', 'nav.library')).toBe('Library')
    expect(translateKey('it', 'nav.nonEsiste')).toBe('nav.nonEsiste')
    expect(translateKey('en', 'nav')).toBe('nav') // un namespace non è un testo
  })

  it('lingua normalizzata: solo en e it', () => {
    expect(normalizeLocale(' IT ')).toBe('it')
    expect(normalizeLocale('de')).toBeNull()
    expect(normalizeLocale(undefined)).toBeNull()
  })

  it('le chiavi sono tipizzate (MessageKey)', () => {
    const key: MessageKey = 'status.tmdb.ended'
    expect(translate('it', key)).toBe('Conclusa')
    // @ts-expect-error chiave inesistente
    expect(translate('en', 'nav.hom')).toBe('nav.hom')
  })
})

describe('formattazione', () => {
  const at = '2026-03-05T14:07:00Z'
  const utc = { timeZone: 'UTC' } as const

  it('locale Intl: variante regionale dalla lingua TMDB se è della stessa lingua', () => {
    expect(intlLocale('it')).toBe('it-IT')
    expect(intlLocale('en')).toBe('en-US')
    expect(intlLocale('en', 'en-GB')).toBe('en-GB')
    expect(intlLocale('en', 'it-IT')).toBe('en-US')
    expect(intlLocale('it', 'it-CH')).toBe('it-CH')
    expect(intlLocale('it', 'garbage')).toBe('it-IT')
  })

  it('date e ore come toLocale*String della lingua (ordine giorno/mese per lingua)', () => {
    const d = new Date(at)
    expect(formatDateIn('it-IT', at, utc)).toBe(d.toLocaleDateString('it-IT', utc))
    expect(formatDateTimeIn('it-IT', at, utc)).toBe(d.toLocaleString('it-IT', utc))
    // Il testo esatto dipende dalla versione di ICU: si controlla l'ordine dei campi
    expect(formatDateIn('it-IT', at, utc)).toMatch(/^0?5\/0?3\/2026$/)
    expect(formatDateIn('en-US', at, utc)).toMatch(/^0?3\/0?5\/2026$/)
    expect(formatDateIn('en-GB', at, utc)).toMatch(/^0?5\/0?3\/2026$/)
    expect(formatDateTimeIn('it-IT', at, utc)).toMatch(/14:07/)
    expect(formatDateTimeIn('en-US', at, utc)).toMatch(/2:07:00\sPM/)
    const short = { ...utc, day: 'numeric', month: 'short', year: 'numeric' } as const
    expect(formatDateIn('it-IT', at, short)).toMatch(/^5 mar 2026$/)
    expect(formatDateIn('en-US', at, short)).toBe('Mar 5, 2026')
  })

  it('date assenti o non valide → stringa vuota', () => {
    expect(formatDateIn('it-IT', null)).toBe('')
    expect(formatDateIn('it-IT', '')).toBe('')
    expect(formatDateTimeIn('en-US', 'non una data')).toBe('')
  })

  it('numeri con i separatori della lingua', () => {
    expect(formatNumberIn('it-IT', 1234567.5)).toBe('1.234.567,5')
    expect(formatNumberIn('en-US', 1234567.5)).toBe('1,234,567.5')
    expect(formatNumberIn('en-US', Number.NaN)).toBe('')
    expect(formatNumberIn('en-US', null)).toBe('')
  })
})

describe('messaggi del server', () => {
  it('con codice noto: tradotto, con parametri annidati e note', () => {
    const msg = {
      code: 'imports.csv.done',
      params: { format: { code: 'imports.csv.format.netflix' }, imported: 4, skipped: 2 },
      notes: [{ code: 'sync.note.movies', params: { count: 2 } }],
      message: 'testo italiano salvato',
    }
    expect(renderServerMessage('en', msg)).toBe('CSV import Netflix complete: 4 new episodes added, 2 already present. 2 movies recorded, not shown.')
    expect(renderServerMessage('it', msg)).toBe('Import CSV Netflix completato: 4 nuovi episodi aggiunti, 2 già presenti. 2 film registrati, non mostrati.')
  })

  it('senza codice (esiti salvati prima dei codici) o con codice sconosciuto: il message', () => {
    const old = { ok: false, at: '2026-01-01T00:00:00Z', message: 'Errore nella sincronizzazione Netflix: boh' }
    expect(renderServerMessage('en', old)).toBe(old.message)
    expect(renderServerMessage('en', { code: 'sync.nonEsiste', message: 'vecchio' })).toBe('vecchio')
    expect(renderServerMessage('en', { code: 'sync.netflix.failed', params: { detail: { code: 'x.y' } }, message: 'annidato ignoto' })).toBe('annidato ignoto')
    expect(renderServerMessage('en', { code: 'sync.netflix.done', notes: [{ code: 'x.y' }], message: 'nota ignota' })).toBe('nota ignota')
    expect(renderServerMessage('en', null)).toBe('')
    expect(renderServerMessage('en', {})).toBe('')
  })

  it('errori di $fetch: codice in data.data, testo in data.message, poi fallback', () => {
    const err = { message: '[POST] /api/sync/netflix: 401', data: { message: 'Errore…', data: { reason: 'auth', code: 'sync.netflix.failed', params: { detail: { code: 'sync.netflix.cookiesExpired' } } } } }
    expect(renderServerMessage('en', fetchErrorMessage(err))).toBe('Netflix sync error: Netflix cookies expired or invalid. Log in to Netflix again and copy the updated cookies into Settings.')
    expect(renderServerMessage('en', fetchErrorMessage({ message: 'x', data: { message: 'Solo testo.' } }))).toBe('Solo testo.')
    expect(renderServerMessage('en', fetchErrorMessage({ message: 'fetch failed' }, 'Riprova.'))).toBe('Riprova.')
    expect(renderServerMessage('en', fetchErrorMessage({ message: 'fetch failed' }))).toBe('fetch failed')
  })
})

describe('testi con elementi dentro (I18nT) e bookmarklet', () => {
  it('splitPlaceholders divide sui segnaposto rimasti', () => {
    expect(splitPlaceholders('Da {site}: incolla {code}.')).toEqual(['Da ', { slot: 'site' }, ': incolla ', { slot: 'code' }, '.'])
    expect(splitPlaceholders('{a}{b}')).toEqual([{ slot: 'a' }, { slot: 'b' }])
    expect(splitPlaceholders('senza segnaposto')).toEqual(['senza segnaposto'])
    expect(splitPlaceholders('')).toEqual([])
  })

  it('i parametri di t() si sostituiscono prima, gli altri restano slot', () => {
    const text = translate('it', 'settings.bookmarklet.step1', { copy: 'Copia Codice Segnalibro' })
    expect(splitPlaceholders(text)).toEqual([
      'Trascina il pulsante qui sopra nella ', { slot: 'bar' },
      ' del browser (oppure clicca su "Copia Codice Segnalibro" e incollalo come URL di un nuovo preferito).',
    ])
  })

  it('bookmarkletJsText produce un\'espressione JS valida, con virgolette e a capo', () => {
    const expr = bookmarkletJsText('Trovati {count} "titoli"\nfine {x}', { count: 'items.length' })
    // eslint-disable-next-line no-new-func
    expect(new Function('items', `return ${expr}`)([1, 2])).toBe('Trovati 2 "titoli"\nfine {x}')
    expect(bookmarkletJsText('')).toBe('""')
  })

  it('i testi del bookmarklet non contengono "%" (il codice è un URL javascript:)', () => {
    for (const locale of ['en', 'it'] as const) {
      for (const text of Object.values(dictionaries[locale].settings.bookmarklet.js)) {
        expect(text, `${locale}: ${text}`).not.toContain('%')
      }
    }
  })
})
