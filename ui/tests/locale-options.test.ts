import { describe, expect, it } from 'vitest'
import { nativeLanguageName, normalizeRegionInput, regionName, regionOptions, tmdbLanguageOptions, TMDB_LANGUAGES } from '../app/utils/locale-options'

describe('opzioni di Lingua e regione', () => {
  it('lingue dell\'app con il nome nella lingua stessa, maiuscola iniziale', () => {
    expect(nativeLanguageName('en')).toBe('English')
    expect(nativeLanguageName('it')).toBe('Italiano')
  })

  it('lingue TMDB: nomi nella lingua dell\'app, ordine alfabetico, quella salvata sempre presente', () => {
    const it = tmdbLanguageOptions('it-IT', 'it')
    expect(it).toHaveLength(TMDB_LANGUAGES.length)
    expect(it.find(o => o.value === 'en-GB')?.label).toBe('Inglese britannico · en-GB')
    expect(it.map(o => o.label)).toEqual([...it.map(o => o.label)].sort((a, b) => a.localeCompare(b, 'it')))
    const extra = tmdbLanguageOptions('el-GR', 'en')
    expect(extra.map(o => o.value)).toContain('el-GR')
    expect(extra.find(o => o.value === 'el-GR')?.label).toMatch(/^Greek.* · el-GR$/)
  })

  it('regioni: nomi dei paesi nella lingua dell\'app; la salvata si aggiunge se manca', () => {
    expect(regionName('IT', 'it')).toBe('Italia')
    expect(regionName('US', 'en')).toBe('United States')
    const opts = regionOptions(['US', 'IT', 'GB'], 'CH', 'en')
    expect(opts.map(o => o.value)).toEqual(['IT', 'CH', 'GB', 'US'])
    expect(opts[0]).toEqual({ value: 'IT', label: 'Italy · IT' })
    expect(regionOptions(['US'], 'US', 'en')).toHaveLength(1)
  })

  it('codice paese libero: due lettere, maiuscolo', () => {
    expect(normalizeRegionInput(' ch ')).toBe('CH')
    expect(normalizeRegionInput('CHE')).toBeNull()
    expect(normalizeRegionInput('')).toBeNull()
  })
})
