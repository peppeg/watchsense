import Database from 'better-sqlite3'
import { dirname } from 'path'
import { chmodSync, mkdirSync, statSync } from 'fs'
import { getDatabasePath, getDefaultDataDir } from './paths'
import { loadSecretKey, restrictFileMode } from './secret-key'
import { runMigrations } from '../db/migrate'
import { migrations } from '../db/migrations'

export { getDatabasePath } from './paths'

let _db: Database.Database | null = null

/**
 * Permessi dei file sensibili: DB, -wal, -shm a 0600; la cartella dati di default senza
 * accesso per "altri". Solo sui file del processo; gli errori diventano avvisi.
 */
function restrictDataPermissions(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) restrictFileMode(dbPath + suffix)
  const dir = dirname(dbPath)
  // Una cartella scelta con DATABASE_PATH può essere condivisa (es. la home): si tocca solo quella di default
  if (dir !== getDefaultDataDir()) return
  try {
    const st = statSync(dir)
    if ((st.mode & 0o007) === 0) return
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return
    chmodSync(dir, st.mode & 0o770)
  } catch (e: any) {
    console.warn(`[WatchSense] Cannot restrict the permissions of ${dir}: ${e?.code || e?.message}`)
  }
}

export function getDb(): Database.Database {
  if (!_db) {
    const dbPath = getDatabasePath()
    // better-sqlite3 non crea la directory: la crea lui se manca (clone pulito)
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 })
    // Chiave dei segreti prima delle migrazioni (la v13 cifra i valori esistenti): se il file
    // della chiave è corrotto si fallisce qui, senza toccare il DB
    loadSecretKey()
    const db = new Database(dbPath)
    try {
      // Prima del WAL: SQLite crea -wal e -shm con i permessi del file del DB
      restrictDataPermissions(dbPath)
      db.pragma('journal_mode = WAL')
      db.pragma('foreign_keys = ON')
      // Schema versionato: porta il DB all'ultima migrazione (vedi server/db/migrations/)
      runMigrations(db, migrations)
      restrictDataPermissions(dbPath)
    } catch (e) {
      db.close()
      throw e
    }
    _db = db
  }
  return _db
}
