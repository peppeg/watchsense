import Database from 'better-sqlite3'
import { join, dirname, resolve } from 'path'
import { mkdirSync } from 'fs'
import { findProjectRoot } from './paths'
import { runMigrations } from '../db/migrate'
import { migrations } from '../db/migrations'

let _db: Database.Database | null = null

export function getDatabasePath(): string {
  return process.env.DATABASE_PATH
    ? resolve(process.env.DATABASE_PATH.trim())
    : join(findProjectRoot(), 'data', 'watchsense.db')
}

export function getDb(): Database.Database {
  if (!_db) {
    const dbPath = getDatabasePath()
    // better-sqlite3 non crea la directory: la crea lui se manca (clone pulito)
    mkdirSync(dirname(dbPath), { recursive: true })
    const db = new Database(dbPath)
    try {
      db.pragma('journal_mode = WAL')
      db.pragma('foreign_keys = ON')
      // Schema versionato: porta il DB all'ultima migrazione (vedi server/db/migrations/)
      runMigrations(db, migrations)
    } catch (e) {
      db.close()
      throw e
    }
    _db = db
  }
  return _db
}
