import { describe, expect, it } from 'vitest'
import { localizeGenre, localizeGenres, normalizeGenre, normalizeGenres, storedGenres } from '../server/utils/genres'
import { normalizeGenresMigration } from '../server/db/migrations/009_normalize_genres'
import { canonicalGenresMigration } from '../server/db/migrations/011_canonical_genres'
import { memoryDb, seedShow } from './helpers'

// Nomi restituiti da TMDB /genre/tv/list e /genre/movie/list (en-US → it-IT, ottobre 2026)
const TMDB_TV: Array<[string, string]> = [
  ['Action & Adventure', 'Action & Adventure'], ['Animation', 'Animazione'], ['Comedy', 'Commedia'],
  ['Crime', 'Crime'], ['Documentary', 'Documentario'], ['Drama', 'Dramma'], ['Family', 'Famiglia'],
  ['Kids', 'Kids'], ['Mystery', 'Mistero'], ['News', 'News'], ['Reality', 'Reality'],
  ['Sci-Fi & Fantasy', 'Sci-Fi & Fantasy'], ['Soap', 'Soap'], ['Talk', 'Talk'],
  ['War & Politics', 'War & Politics'], ['Western', 'Western'],
]
const TMDB_MOVIE: Array<[string, string]> = [
  ['Action', 'Azione'], ['Adventure', 'Avventura'], ['Animation', 'Animazione'], ['Comedy', 'Commedia'],
  ['Crime', 'Crime'], ['Documentary', 'Documentario'], ['Drama', 'Dramma'], ['Family', 'Famiglia'],
  ['Fantasy', 'Fantasy'], ['History', 'Storia'], ['Horror', 'Horror'], ['Music', 'Musica'],
  ['Mystery', 'Mistero'], ['Romance', 'Romance'], ['Science Fiction', 'Fantascienza'],
  ['TV Movie', 'televisione film'], ['Thriller', 'Thriller'], ['War', 'Guerra'], ['Western', 'Western'],
]
// Nomi italiani scritti dalla v9
const V9_ITALIAN: Array<[string, string]> = [
  ['Dramma', 'Drama'], ['Commedia', 'Comedy'], ['Mistero', 'Mystery'], ['Animazione', 'Animation'],
  ['Famiglia', 'Family'], ['Documentario', 'Documentary'], ['Bambini', 'Kids'],
  ['Fantascienza & Fantasy', 'Sci-Fi & Fantasy'], ['Azione & Avventura', 'Action & Adventure'],
  ['Guerra & Politica', 'War & Politics'], ['Talk show', 'Talk'], ['Soap opera', 'Soap'], ['Notizie', 'News'],
]

describe('normalizeGenre: forma canonica inglese', () => {
  it('ogni nome TMDB, in inglese o in italiano, diventa il nome inglese', () => {
    for (const [en, it] of [...TMDB_TV, ...TMDB_MOVIE]) {
      expect(normalizeGenre(en), en).toBe(en)
      expect(normalizeGenre(it), it).toBe(en)
    }
  })

  it('i nomi italiani scritti dalla v9 tornano inglesi; ignoti invariati', () => {
    for (const [it, en] of V9_ITALIAN) expect(normalizeGenre(it), it).toBe(en)
    expect(normalizeGenre('  dramma ')).toBe('Drama')
    expect(normalizeGenre('Telenovela')).toBe('Telenovela')
  })

  it('niente doppioni dopo la normalizzazione, ordine conservato', () => {
    expect(normalizeGenres(['Dramma', 'Crime', 'Drama', 'Mistero'])).toEqual(['Drama', 'Crime', 'Mystery'])
    expect(normalizeGenres(null)).toEqual([])
    expect(normalizeGenres(['', 3, 'Talk show'])).toEqual(['Talk'])
  })
})

describe('localizeGenre: nome mostrato', () => {
  it('it: inglese → nomi italiani mostrati finora; en: identità', () => {
    for (const [it, en] of V9_ITALIAN) {
      expect(localizeGenre(en, 'it'), en).toBe(it)
      expect(localizeGenre(en, 'en'), en).toBe(en)
    }
    expect(localizeGenre('Crime', 'it')).toBe('Crime')
    expect(localizeGenre('Science Fiction', 'it')).toBe('Fantascienza')
    expect(localizeGenre('TV Movie', 'it')).toBe('Film TV')
    expect(localizeGenre('Telenovela', 'it')).toBe('Telenovela')
  })

  it('andata e ritorno: localizzato → canonico → localizzato', () => {
    for (const [en] of [...TMDB_TV, ...TMDB_MOVIE]) {
      expect(normalizeGenre(localizeGenre(en, 'it')), en).toBe(en)
    }
  })

  it('accetta anche nomi non canonici e toglie i doppioni', () => {
    expect(localizeGenre('Dramma', 'en')).toBe('Drama')
    expect(localizeGenres(['Drama', 'Dramma', 'Kids'], 'it')).toEqual(['Dramma', 'Bambini'])
    expect(storedGenres('["Drama","Mystery"]', 'it')).toEqual(['Dramma', 'Mistero'])
    expect(storedGenres('["Drama","Mystery"]', 'en')).toEqual(['Drama', 'Mystery'])
    expect(storedGenres('non json', 'it')).toEqual([])
    expect(storedGenres(null, 'it')).toEqual([])
  })
})

describe('migrazioni dei generi', () => {
  const genres = (db: any, id: number) => (db.prepare('SELECT tmdb_genres g FROM shows WHERE id = ?').get(id) as any).g

  it('v9 (con la tabella attuale) unifica già sui nomi inglesi; idempotente', () => {
    const db = memoryDb(8)
    const a = seedShow(db, { title: 'Lost', tmdb_genres: '["Mystery", "Action & Adventure", "Dramma"]' })
    const c = seedShow(db, { title: 'X', watched_at: '2024-01-03', tmdb_genres: 'non json' })
    normalizeGenresMigration.up(db)
    normalizeGenresMigration.up(db)
    expect(genres(db, a)).toBe('["Mystery","Action & Adventure","Drama"]')
    expect(genres(db, c)).toBe('non json')
  })

  it('v11 riporta all\'inglese i generi italiani, non tocca valori non validi; idempotente', () => {
    const db = memoryDb(10)
    const a = seedShow(db, { title: 'Lost', tmdb_genres: '["Mistero","Azione & Avventura","Dramma"]' })
    const b = seedShow(db, { title: 'Dexter', watched_at: '2024-01-02', tmdb_genres: '["Crime","Dramma","Drama"]' })
    const c = seedShow(db, { title: 'X', watched_at: '2024-01-03', tmdb_genres: 'non json' })
    const d = seedShow(db, { title: 'Bluey', watched_at: '2024-01-04', tmdb_genres: '["Bambini","Animazione","Famiglia","Fantascienza & Fantasy","Talk show","Soap opera","Notizie","Guerra & Politica","Commedia","Documentario"]' })
    const e = seedShow(db, { title: 'Dark', watched_at: '2024-01-05', tmdb_genres: '["Drama","Mystery"]' })
    canonicalGenresMigration.up(db)
    const after = [a, b, c, d, e].map(id => genres(db, id))
    canonicalGenresMigration.up(db)
    expect([a, b, c, d, e].map(id => genres(db, id))).toEqual(after)
    expect(genres(db, a)).toBe('["Mystery","Action & Adventure","Drama"]')
    expect(genres(db, b)).toBe('["Crime","Drama"]')
    expect(genres(db, c)).toBe('non json')
    expect(genres(db, d)).toBe('["Kids","Animation","Family","Sci-Fi & Fantasy","Talk","Soap","News","War & Politics","Comedy","Documentary"]')
    expect(genres(db, e)).toBe('["Drama","Mystery"]')
  })
})

describe('filtro dei generi di "Per te"', () => {
  it('manda il nome canonico e mostra lo stesso nome del server in ogni lingua', async () => {
    const { RECOMMENDATION_GENRES } = await import('../app/utils/recommendation-genres')
    const { translate } = await import('../app/locales/i18n')
    for (const g of RECOMMENDATION_GENRES) {
      expect(normalizeGenre(g.value)).toBe(g.value)
      expect(translate('en', g.label)).toBe(localizeGenre(g.value, 'en'))
      expect(translate('it', g.label)).toBe(localizeGenre(g.value, 'it'))
    }
  })
})
