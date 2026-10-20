import { describe, expect, it } from 'vitest'
import { tmdbStatusLabel } from '../app/utils/tmdb-status'

describe('tmdbStatusLabel', () => {
  it('traduce gli stati TMDB noti in italiano', () => {
    expect(tmdbStatusLabel('Returning Series', 'it')).toBe('In corso')
    expect(tmdbStatusLabel('Ended', 'it')).toBe('Conclusa')
    expect(tmdbStatusLabel('Canceled', 'it')).toBe('Cancellata')
    expect(tmdbStatusLabel('Cancelled', 'it')).toBe('Cancellata')
    expect(tmdbStatusLabel('In Production', 'it')).toBe('In produzione')
    expect(tmdbStatusLabel('Planned', 'it')).toBe('Annunciata')
    expect(tmdbStatusLabel('Pilot', 'it')).toBe('Pilota')
  })

  it('e in inglese', () => {
    expect(tmdbStatusLabel('Returning Series', 'en')).toBe('Returning')
    expect(tmdbStatusLabel('Ended', 'en')).toBe('Ended')
    expect(tmdbStatusLabel('Cancelled', 'en')).toBe('Canceled')
    expect(tmdbStatusLabel('In Production', 'en')).toBe('In production')
  })

  it('lascia invariati gli stati sconosciuti e gestisce i vuoti', () => {
    expect(tmdbStatusLabel('Rumored', 'it')).toBe('Rumored')
    expect(tmdbStatusLabel('', 'it')).toBe('')
    expect(tmdbStatusLabel(null, 'en')).toBe('')
    expect(tmdbStatusLabel(undefined, 'en')).toBe('')
  })
})
