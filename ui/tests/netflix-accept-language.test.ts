import { describe, expect, it } from 'vitest'
import { netflixAcceptLanguage } from '../server/utils/netflix'

describe('Accept-Language Netflix', () => {
  it('it-IT: intestazione storica', () => {
    expect(netflixAcceptLanguage('it-IT')).toBe('it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7')
  })
  it('inglese e altre lingue', () => {
    expect(netflixAcceptLanguage('en-US')).toBe('en-US,en;q=0.9')
    expect(netflixAcceptLanguage('en-GB')).toBe('en-GB,en;q=0.9')
    expect(netflixAcceptLanguage('de-DE')).toBe('de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7')
  })
})
