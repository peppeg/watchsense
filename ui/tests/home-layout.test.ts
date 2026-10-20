import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'watchsense-test-'))
process.env.DATABASE_PATH = join(dir, 'test.db')

const { getDb } = await import('../server/utils/db')
const { chartSources, dedupeChartRows, getHiddenHomeSections, getHomeLayout, homeSectionsForRegion, setHiddenHomeSections } =
  await import('../server/utils/home-layout')

afterAll(() => {
  getDb().close()
  rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  getDb().exec("DELETE FROM config WHERE key = 'home_hidden_sections'")
})

const show = (id: number) => ({ tmdb_id: id, media_type: 'tv' })
const ids = (list: Array<{ tmdb_id?: number | null }>) => list.map(s => s.tmdb_id)

describe('dedupeChartRows', () => {
  it('ogni serie resta solo nella prima fila e le altre si riempiono con le successive', () => {
    const rows = dedupeChartRows([
      ['netflix', [show(1), show(2), show(3)]],
      ['prime', [show(1), show(4), show(2), show(5), show(6)]],
      ['nowtv', [show(4), show(1), show(7)]],
    ], 2)
    expect(ids(rows.netflix!)).toEqual([1, 2])
    expect(ids(rows.prime!)).toEqual([4, 5])
    expect(ids(rows.nowtv!)).toEqual([7])
  })

  it('un titolo oltre il limite di una fila resta libero per le successive', () => {
    const rows = dedupeChartRows([
      ['netflix', [show(1), show(2), show(3)]],
      ['prime', [show(3)]],
    ], 2)
    expect(ids(rows.prime!)).toEqual([3])
  })

  it('stesso id ma tipo diverso: titoli diversi', () => {
    const rows = dedupeChartRows([
      ['a', [show(1)]],
      ['b', [{ tmdb_id: 1, media_type: 'movie' }]],
    ], 12)
    expect(rows.b).toHaveLength(1)
  })
})

describe('sezioni nascoste della Home', () => {
  it('di default tutto visibile', () => {
    expect(getHomeLayout().every(s => s.visible)).toBe(true)
    expect(getHomeLayout()[0]!.key).toBe('hero')
  })

  it('salva e rilegge, rifiuta chiavi sconosciute', () => {
    expect(setHiddenHomeSections(['nowtv', 'disney'])).toEqual(['disney', 'nowtv'])
    expect(Array.from(getHiddenHomeSections()).sort()).toEqual(['disney', 'nowtv'])
    expect(getHomeLayout().find(s => s.key === 'disney')!.visible).toBe(false)
    expect(setHiddenHomeSections(['boh'])).toBeNull()
    expect(setHiddenHomeSections('nowtv')).toBeNull()
    expect(Array.from(getHiddenHomeSections()).sort()).toEqual(['disney', 'nowtv'])
  })

  it('valori salvati non validi: nessuna sezione nascosta', () => {
    getDb().prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('home_hidden_sections', 'xx')").run()
    expect(getHiddenHomeSections().size).toBe(0)
  })
})

describe('classifiche per regione', () => {
  const chartKeys = (region: string) => homeSectionsForRegion(region).filter(s => s.chart).map(s => s.key)

  it('Italia: tutte le classifiche, con gli id storici', () => {
    expect(chartKeys('IT')).toEqual(['trending', 'netflix', 'prime', 'max', 'disney', 'paramount', 'appletv', 'nowtv'])
    const src = chartSources('IT')
    expect(src.get('prime')).toEqual({ kind: 'provider', providerId: 119, platform: 'prime' })
    expect(src.get('nowtv')).toEqual({ kind: 'provider', providerId: 39, platform: 'now' })
    expect(src.get('max')).toEqual({ kind: 'network', networkIds: '49|3186', platform: 'max' })
  })

  it('altre regioni: NOW solo dove esiste, id per regione', () => {
    expect(chartKeys('US')).toEqual(['trending', 'netflix', 'prime', 'max', 'disney', 'paramount', 'appletv'])
    expect(chartSources('US').get('prime')).toMatchObject({ providerId: 9 })
    expect(chartSources('US').get('paramount')).toMatchObject({ providerId: 2303 })
    expect(chartKeys('GB')).toContain('nowtv')
    expect(chartKeys('DE')).not.toContain('nowtv')
    expect(chartKeys('ES')).toEqual(['trending', 'netflix', 'prime', 'max', 'disney', 'appletv'])
  })

  it('regione non in tabella: solo i servizi presenti ovunque', () => {
    expect(chartKeys('ZZ')).toEqual(['trending', 'netflix', 'disney', 'appletv'])
  })

  it('le sezioni non classifica restano in ogni regione', () => {
    for (const region of ['IT', 'US', 'ZZ']) {
      const keys = homeSectionsForRegion(region).map(s => s.key)
      for (const k of ['hero', 'recommendations', 'taste', 'trakt']) expect(keys).toContain(k)
    }
  })

  it('Impostazioni: elencano solo le classifiche della regione; le nascoste altrove restano nascoste', () => {
    expect(getHomeLayout('ES').map(s => s.key)).not.toContain('nowtv')
    setHiddenHomeSections(['nowtv'], 'IT')
    // Da una regione senza NOW, salvare l'elenco delle Impostazioni non la rende visibile
    expect(setHiddenHomeSections(['disney'], 'ES')).toEqual(['disney', 'nowtv'])
    expect(getHomeLayout('IT').find(s => s.key === 'nowtv')!.visible).toBe(false)
  })
})

describe('nomi delle sezioni', () => {
  it('ogni sezione ha il suo nome nei dizionari (home.sections.<key>)', async () => {
    const { HOME_SECTIONS } = await import('../server/utils/home-layout')
    const { dictionaries } = await import('../app/locales/i18n')
    for (const s of HOME_SECTIONS) {
      expect(dictionaries.en.home.sections, s.key).toHaveProperty(s.key)
      expect(dictionaries.it.home.sections, s.key).toHaveProperty(s.key)
    }
    expect(Object.keys(dictionaries.en.home.sections).sort()).toEqual(HOME_SECTIONS.map(s => s.key).sort())
  })
})
