import { describe, expect, it } from 'vitest'
import { cleanTitle, decodeHtmlEntities, hasHtmlEntity } from '../server/utils/ingest-normalize'
import { parsePrimeHistory } from '../server/utils/csv-import'
import { decodeShowEntities } from '../server/db/migrations/006_decode_html_entities'
import { getSchemaVersion, runMigrations } from '../server/db/migrate'
import { migrations } from '../server/db/migrations'
import { memoryDb, seedShow } from './helpers'

describe('decodeHtmlEntities', () => {
  it('decodifica entità numeriche e named comuni', () => {
    expect(decodeHtmlEntities('Agatha Christie&#39;s Poirot')).toBe("Agatha Christie's Poirot")
    expect(decodeHtmlEntities('Grey&#x27;s Anatomy')).toBe("Grey's Anatomy")
    expect(decodeHtmlEntities('Tom &amp; Jerry')).toBe('Tom & Jerry')
    expect(decodeHtmlEntities('&quot;Q&quot; &apos;A&apos; &lt;b&gt;')).toBe('"Q" \'A\' <b>')
    expect(decodeHtmlEntities('a&nbsp;b&#160;c')).toBe('a b c')
  })

  it('un solo passaggio: &amp;amp; diventa &amp;', () => {
    expect(decodeHtmlEntities('A &amp;amp; B')).toBe('A &amp; B')
    expect(decodeHtmlEntities('&amp;#39;')).toBe('&#39;')
  })

  it('lascia stare testo senza entità o con entità sconosciute/non valide', () => {
    expect(decodeHtmlEntities('Law & Order')).toBe('Law & Order')
    expect(decodeHtmlEntities('A &copy; B &#0; &#xD800;')).toBe('A &copy; B &#0; &#xD800;')
    expect(hasHtmlEntity('Law & Order; SVU')).toBe(false)
    expect(hasHtmlEntity('Law &amp; Order')).toBe(true)
    expect(hasHtmlEntity(null)).toBe(false)
  })

  it('cleanTitle decodifica per tutti i profili prima di pulire', () => {
    expect(cleanTitle('Agatha Christie&#39;s Poirot - Stagione 3', 'prime-history')).toBe("Agatha Christie's Poirot")
    expect(cleanTitle('Agatha Christie&#39;s Poirot Season 2', 'bookmarklet')).toBe("Agatha Christie's Poirot")
    expect(cleanTitle('Grey&#39;s Anatomy: Stagione 1: Pilot', 'netflix')).toBe("Grey's Anatomy")
    expect(cleanTitle('Tom &amp; Jerry stagione 1', 'prime-legacy')).toBe('Tom & Jerry')
    expect(cleanTitle('A &amp;amp; B', 'netflix')).toBe('A &amp; B')
  })

  it('CSV Prime: titolo decodificato anche per i film', () => {
    const rows = [
      ['Date Watched', 'Type', 'Title', 'Episode Title'],
      ['2024-01-02', 'Movie', 'Ocean&#39;s Eleven', ''],
      ['2024-01-03', 'TV', 'Agatha Christie&#39;s Poirot - Stagione 1', 'Episodio 1'],
    ]
    const [movie, ep] = parsePrimeHistory(rows)
    expect(movie!.title).toBe("Ocean's Eleven")
    expect(ep!.title).toBe("Agatha Christie's Poirot")
  })
})

describe('migrazione 006 decode_html_entities', () => {
  it('decodifica title, episode_title e tmdb_name e porta user_version a 6', () => {
    const db = memoryDb(5)
    const a = seedShow(db, { title: 'Agatha Christie&#39;s Poirot', episode_title: 'Agatha Christie&#39;s Poirot: Episodio 1' })
    const b = seedShow(db, { title: 'Law & Order', episode_title: 'Ep; 1', tmdb_id: 1, tmdb_name: 'Law &amp; Order' })
    const untouched = seedShow(db, { title: 'Law & Order', episode_title: 'Ep 2' })
    runMigrations(db, migrations.slice(0, 6))
    expect(getSchemaVersion(db)).toBe(6)
    const get = (id: number) => db.prepare('SELECT title, episode_title, tmdb_name, tmdb_id FROM shows WHERE id = ?').get(id) as any
    expect(get(a)).toMatchObject({ title: "Agatha Christie's Poirot", episode_title: "Agatha Christie's Poirot: Episodio 1", tmdb_id: null })
    expect(get(b)).toMatchObject({ title: 'Law & Order', episode_title: 'Ep; 1', tmdb_name: 'Law & Order', tmdb_id: 1 })
    expect(get(untouched)).toMatchObject({ title: 'Law & Order', episode_title: 'Ep 2' })
  })

  it('duplicato più recente della riga decodificata: si tiene la più vecchia', () => {
    const db = memoryDb()
    const oldEncoded = seedShow(db, { title: 'Poirot&#39;s', episode_title: 'E1' })
    const newPlain = seedShow(db, { title: "Poirot's", episode_title: 'E1', tmdb_id: 790, tmdb_name: 'Poirot', tmdb_genres: '["Crime"]' })
    const stats = decodeShowEntities(db)
    expect(stats).toEqual({ updated: 1, duplicatesDeleted: 1, linksCopied: 1 })
    const rows = db.prepare('SELECT id, title, tmdb_id, tmdb_genres FROM shows').all() as any[]
    expect(rows).toEqual([{ id: oldEncoded, title: "Poirot's", tmdb_id: 790, tmdb_genres: '["Crime"]' }])
    expect(newPlain).toBeGreaterThan(oldEncoded)
  })

  it('duplicato più vecchio già decodificato: si elimina la riga con le entità', () => {
    const db = memoryDb()
    const oldPlain = seedShow(db, { title: "Poirot's", episode_title: 'E1' })
    seedShow(db, { title: 'Poirot&#39;s', episode_title: 'E1', tmdb_id: 790 })
    seedShow(db, { title: 'Poirot&#x27;s', episode_title: 'E1' })
    const stats = decodeShowEntities(db)
    expect(stats.duplicatesDeleted).toBe(2)
    expect(stats.linksCopied).toBe(1)
    const rows = db.prepare('SELECT id, title, tmdb_id FROM shows').all()
    expect(rows).toEqual([{ id: oldPlain, title: "Poirot's", tmdb_id: 790 }])
  })

  it('non confonde piattaforme o giorni diversi ed è idempotente', () => {
    const db = memoryDb()
    seedShow(db, { title: 'A&amp;B', episode_title: 'E1', platform: 'prime' })
    seedShow(db, { title: 'A&B', episode_title: 'E1', platform: 'netflix' })
    seedShow(db, { title: 'A&B', episode_title: 'E1', watched_at: '2024-02-02' })
    expect(decodeShowEntities(db)).toEqual({ updated: 1, duplicatesDeleted: 0, linksCopied: 0 })
    expect(decodeShowEntities(db)).toEqual({ updated: 0, duplicatesDeleted: 0, linksCopied: 0 })
    expect((db.prepare('SELECT COUNT(*) c FROM shows').get() as any).c).toBe(3)
  })
})
