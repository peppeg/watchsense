import { describe, expect, it } from 'vitest'
import { cleanTitle, stripSeasonSuffix } from '../server/utils/ingest-normalize'
import { isSeasonOnlyTitle } from '../server/utils/ingest'
import { primeEpisodeName, primeViewExists, samePrimeView } from '../server/utils/prime-dedup'
import { dedupePrimeViews } from '../server/db/migrations/008_dedupe_prime_views'
import { getSchemaVersion, runMigrations } from '../server/db/migrate'
import { migrations } from '../server/db/migrations'
import { memoryDb, seedShow } from './helpers'

const BSG = 'Battlestar Galactica'
const view = (title: string, watchedAt: string, episodeTitle: string) => ({ title, watchedAt, episodeTitle })

describe('primeEpisodeName', () => {
  it('nome dopo il primo "Episodio N:", bookmarklet e CSV', () => {
    expect(primeEpisodeName('Episodio 2: Six of One')).toBe('six of one')
    expect(primeEpisodeName('Battlestar Galactica - Season 4: Episodio 4: Six  of One')).toBe('six of one')
    expect(primeEpisodeName('THE GHOST IN THE SHELL: Episodio 1: EPISODIO 01: PROLOGUE'))
      .toBe('episodio 01: prologue')
  })

  it('null se manca o è generico', () => {
    expect(primeEpisodeName(null)).toBeNull()
    expect(primeEpisodeName('Stagione 1')).toBeNull()
    expect(primeEpisodeName('Episodio 3: Episodio 3')).toBeNull()
    expect(primeEpisodeName('Serie: Episodio 3: Parte 2')).toBeNull()
    expect(primeEpisodeName('Episodio 3: 3')).toBeNull()
  })
})

describe('samePrimeView', () => {
  it('bookmarklet ↔ CSV: stesso nome dell\'episodio con numeri diversi, stesso giorno', () => {
    expect(samePrimeView(
      view(BSG, '2022-03-18', 'Episodio 2: Six of One'),
      view(BSG, '2022-03-18', `${BSG} - Season 4: Episodio 4: Six of One`),
    )).toBe(true)
  })

  it('bookmarklet ↔ CSV: un giorno di differenza sì, due no', () => {
    const csv = view(BSG, '2022-03-22', `${BSG} - Season 4: Episodio 12: Revelations`)
    expect(samePrimeView(view(BSG, '2022-03-21', 'Episodio 10: Revelations'), csv)).toBe(true)
    expect(samePrimeView(csv, view(BSG, '2022-03-23', 'Episodio 12: Revelations'))).toBe(true)
    expect(samePrimeView(view(BSG, '2022-03-20', 'Episodio 10: Revelations'), csv)).toBe(false)
  })

  it('due righe della stessa fonte con lo stesso nome restano distinte', () => {
    // CSV: stesso nome in stagioni diverse (episodi diversi)
    expect(samePrimeView(
      view('Elle', '2024-01-01', 'Elle - Stagione 1: Episodio 1: Pilota'),
      view('Elle', '2024-01-01', 'Elle - Stagione 2: Episodio 1: Pilota'),
    )).toBe(false)
    // bookmarklet: rivisto il giorno dopo
    expect(samePrimeView(
      view('Elle', '2024-01-01', 'Episodio 1: Pilota'),
      view('Elle', '2024-01-02', 'Episodio 1: Pilota'),
    )).toBe(false)
  })

  it('serie diverse, nomi generici e titoli solo "Stagione N" non si uniscono per nome', () => {
    expect(samePrimeView(
      view('Elle', '2024-01-01', 'Episodio 1: Pilota'),
      view('Lui', '2024-01-01', 'Lui - Stagione 1: Episodio 1: Pilota'),
    )).toBe(false)
    expect(samePrimeView(
      view('Elle', '2024-01-01', 'Episodio 2: Parte 1'),
      view('Elle', '2024-01-01', 'Elle - Stagione 3: Episodio 5: Parte 1'),
    )).toBe(false)
    expect(samePrimeView(
      view('Stagione 1', '2024-01-01', 'Episodio 1: Pilota'),
      view('Stagione 1', '2024-01-02', 'Stagione 1: Episodio 3: Pilota'),
    )).toBe(false)
  })

  it('regole stesso giorno invariate: suffisso, numeri SxE, film', () => {
    expect(samePrimeView(
      view('Stagione 01', '2024-01-01', 'Episodio 1: Fuoco in buca'),
      view('Stagione 01', '2024-01-01', 'Stagione 01: Episodio 1: Fuoco in buca'),
    )).toBe(true)
    expect(samePrimeView(
      view(BSG, '2022-03-09', `${BSG} - Season 2: Episodio 5: Farma`),
      view(BSG, '2022-03-09', `${BSG} - Season 2: Episodio 5: The Farm`),
    )).toBe(true)
    expect(samePrimeView(
      view(BSG, '2022-03-09', `${BSG} - Season 2: Episodio 5: Farma`),
      view(BSG, '2022-03-10', `${BSG} - Season 2: Episodio 5: The Farm`),
    )).toBe(false)
    expect(samePrimeView(view('Dune', '2024-01-01', '(film)'), view('Dune', '2024-01-01', 'Dune'))).toBe(true)
    expect(samePrimeView(view('Dune', '2024-01-01', '(film)'), view('Dune', '2024-01-02', 'Dune'))).toBe(false)
  })
})

describe('primeViewExists', () => {
  it('trova la riga CSV del giorno adiacente per una visione del bookmarklet', () => {
    const db = memoryDb()
    seedShow(db, { title: BSG, watched_at: '2022-03-22', episode_title: `${BSG} - Season 4: Episodio 12: Revelations` })
    expect(primeViewExists(db, view(BSG, '2022-03-21', 'Episodio 10: Revelations'))).toBe(true)
    expect(primeViewExists(db, view(BSG, '2022-03-23', 'Episodio 10: Revelations'))).toBe(true)
    expect(primeViewExists(db, view(BSG, '2022-03-24', 'Episodio 10: Revelations'))).toBe(false)
    expect(primeViewExists(db, view(BSG, '2022-03-21', 'Episodio 11: The Hub'))).toBe(false)
  })

  it('a cavallo del cambio di mese', () => {
    const db = memoryDb()
    seedShow(db, { title: BSG, watched_at: '2022-04-01', episode_title: `${BSG} - Season 4: Episodio 18: Deadlock` })
    expect(primeViewExists(db, view(BSG, '2022-03-31', 'Episodio 16: Deadlock'))).toBe(true)
  })
})

describe('migrazione 008 dedupe_prime_views', () => {
  const all = (db: ReturnType<typeof memoryDb>) =>
    db.prepare('SELECT id, title, watched_at, episode_title, tmdb_id FROM shows ORDER BY id').all() as any[]

  it('tiene la riga del CSV, copia l\'abbinamento e porta user_version a 8', () => {
    const db = memoryDb(7)
    const bm1 = seedShow(db, { title: BSG, watched_at: '2022-03-18', episode_title: 'Episodio 2: Six of One', tmdb_id: 1972 })
    const csv1 = seedShow(db, { title: BSG, watched_at: '2022-03-18', episode_title: `${BSG} - Season 4: Episodio 4: Six of One` })
    const csv2 = seedShow(db, { title: BSG, watched_at: '2022-03-22', episode_title: `${BSG} - Season 4: Episodio 12: Revelations`, tmdb_id: 1972 })
    const bm2 = seedShow(db, { title: BSG, watched_at: '2022-03-21', episode_title: 'Episodio 10: Revelations', tmdb_id: 1972 })
    const other = seedShow(db, { title: BSG, watched_at: '2022-03-21', episode_title: 'Episodio 11: The Hub', tmdb_id: 1972 })
    const manual = seedShow(db, { title: BSG, watched_at: '2022-03-22', episode_title: 'Episodio 12: Revelations', is_manual: 1 })
    const netflix = seedShow(db, { title: BSG, platform: 'netflix', watched_at: '2022-03-18', episode_title: 'Episodio 2: Six of One' })

    runMigrations(db, migrations.slice(0, 8))
    expect(getSchemaVersion(db)).toBe(8)
    const ids = all(db).map(r => r.id)
    expect(ids).toEqual([csv1, csv2, other, manual, netflix])
    expect(ids).not.toContain(bm1)
    expect(ids).not.toContain(bm2)
    expect(all(db).find(r => r.id === csv1).tmdb_id).toBe(1972)

    // idempotente
    expect(dedupePrimeViews(db)).toEqual({ duplicatesDeleted: 0, linksCopied: 0 })
  })

  it('stesso giorno con suffisso uguale (righe anteriori alla deduplica cross-fonte)', () => {
    const db = memoryDb(7)
    const csv = seedShow(db, { title: 'The Expanse', watched_at: '2026-07-20', episode_title: "The Expanse - Stagione 6: Episodio 6: Babylon's Ashes", tmdb_id: 63639 })
    seedShow(db, { title: 'The Expanse', watched_at: '2026-07-20', episode_title: "Episodio 6: Babylon's Ashes", tmdb_id: 63639 })
    const s = dedupePrimeViews(db)
    expect(s.duplicatesDeleted).toBe(1)
    expect(all(db).map(r => r.id)).toEqual([csv])
  })

  it('non unisce due visioni CSV dello stesso nome in stagioni diverse', () => {
    const db = memoryDb(7)
    seedShow(db, { title: 'Elle', watched_at: '2024-01-01', episode_title: 'Elle - Stagione 1: Episodio 1: Pilota' })
    seedShow(db, { title: 'Elle', watched_at: '2024-01-01', episode_title: 'Elle - Stagione 2: Episodio 1: Pilota' })
    expect(dedupePrimeViews(db).duplicatesDeleted).toBe(0)
  })
})

describe('titoli "<Serie> S<n>" (Mao S1)', () => {
  it('il suffisso di stagione breve si toglie, i titoli solo-stagione restano tali', () => {
    expect(stripSeasonSuffix('Mao S1')).toBe('Mao')
    expect(cleanTitle('Mao S1', 'bookmarklet')).toBe('Mao')
    expect(cleanTitle('Mao S1', 'prime-history')).toBe('Mao')
    expect(isSeasonOnlyTitle('Mao')).toBe(false)
    expect(isSeasonOnlyTitle('Stagione 01')).toBe(true)
    expect(isSeasonOnlyTitle('Season 1')).toBe(true)
  })
})
