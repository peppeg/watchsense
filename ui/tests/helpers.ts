import Database from 'better-sqlite3'
import { runMigrations } from '../server/db/migrate'
import { migrations } from '../server/db/migrations'

/** DB SQLite in memoria portato alla migrazione `upTo` (default: tutte). */
export function memoryDb(upTo = migrations.length): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db, migrations.slice(0, upTo))
  return db
}

export interface ShowSeed {
  title: string
  platform?: string
  watched_at?: string | null
  episode_title?: string | null
  tmdb_id?: number | null
  media_type?: 'tv' | 'movie'
  tmdb_name?: string | null
  tmdb_genres?: string | null
  is_manual?: 0 | 1
}

/** Inserisce una riga di `shows` e ne restituisce l'id. */
export function seedShow(db: Database.Database, s: ShowSeed): number {
  const res = db.prepare(`
    INSERT INTO shows (title, platform, watched_at, episode_title, tmdb_id, media_type, tmdb_name, tmdb_genres, is_manual)
    VALUES (@title, @platform, @watched_at, @episode_title, @tmdb_id, @media_type, @tmdb_name, @tmdb_genres, @is_manual)
  `).run({
    platform: 'prime', watched_at: '2024-01-01', episode_title: 'Episodio 1', tmdb_id: null,
    media_type: 'tv', tmdb_name: null, tmdb_genres: null, is_manual: 0, ...s,
  })
  return Number(res.lastInsertRowid)
}
