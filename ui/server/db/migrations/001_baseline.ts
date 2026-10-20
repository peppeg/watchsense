import Database from 'better-sqlite3'
import { join, resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import { findProjectRoot } from '../../utils/paths'
import { rebuildTable, tableColumns, tableExists, type Migration } from '../migrate'

// v1 — baseline: `db/schema.sql` (congelato: le modifiche successive vanno in
// nuove migrazioni, mai in schema.sql).
//
// DB nuovo: esegue schema.sql.
// DB esistente con user_version = 0 (creato prima delle migrazioni, eventualmente
// con colonne aggiunte a mano con ALTER TABLE): viene "adottato" come baseline in
// modo idempotente e senza perdita di dati:
//   1. aggiunge le altre colonne del baseline che mancano (ALTER TABLE ADD COLUMN);
//   2. ricostruisce una tabella se i suoi vincoli UNIQUE/PRIMARY KEY differiscono
//      dal baseline (es. il vecchio UNIQUE(title, platform, watched_at) di `shows`)
//      o se le manca una colonna non aggiungibile con ALTER (FOREIGN KEY come
//      recommendations.batch_id, default non costante come created_at, ...);
//   3. esegue schema.sql (CREATE ... IF NOT EXISTS: tabelle e indici mancanti);
//   4. pulizia una tantum: elimina il cookie Amazon della vecchia sync Prime.

export function resolveSchemaPath(): string {
  return process.env.SCHEMA_PATH
    ? resolve(process.env.SCHEMA_PATH.trim())
    : join(findProjectRoot(), 'db', 'schema.sql')
}

// Default ammessi da ALTER TABLE ADD COLUMN: solo letterali (non datetime('now'), CURRENT_TIMESTAMP, ...).
const CONSTANT_DEFAULT = /^(NULL|TRUE|FALSE|[-+]?\d+(\.\d+)?|'(?:[^']|'')*')$/i

function uniqueKeys(db: Database.Database, table: string): string[] {
  const list = db.prepare(`PRAGMA index_list("${table}")`).all() as { name: string; origin: string }[]
  return list
    .filter(i => i.origin === 'u' || i.origin === 'pk')
    .map(i => (db.prepare(`PRAGMA index_info("${i.name}")`).all() as { name: string }[]).map(c => c.name).join(','))
    .sort()
}

export const baseline: Migration = {
  version: 1,
  name: 'baseline',
  disableForeignKeys: true,
  up(db) {
    const schemaPath = resolveSchemaPath()
    if (!existsSync(schemaPath)) {
      throw new Error(`baseline schema not found at ${schemaPath} (set SCHEMA_PATH)`)
    }
    const schema = readFileSync(schemaPath, 'utf8')

    // Schema di riferimento in memoria, per confrontare colonne e vincoli.
    const ref = new Database(':memory:')
    try {
      ref.exec(schema)
      const refTables = ref
        .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string; sql: string }[]

      for (const { name, sql } of refTables) {
        if (!tableExists(db, name)) continue // la crea schema.sql più sotto

        // Le colonne mancanti si aggiungono con ALTER TABLE ADD COLUMN, salvo quelle che
        // SQLite non permette di aggiungere così o il cui vincolo andrebbe perso
        // (FOREIGN KEY, PRIMARY KEY, NOT NULL senza default, default non costante):
        // in quei casi, o se i vincoli UNIQUE/PK differiscono, si ricostruisce la tabella.
        const have = new Set(tableColumns(db, name).map(c => c.name))
        const fkCols = new Set((ref.prepare(`PRAGMA foreign_key_list("${name}")`).all() as { from: string }[]).map(f => f.from))
        const missing = tableColumns(ref, name).filter(c => !have.has(c.name))
        const notAddable = missing.some(c =>
          fkCols.has(c.name) || c.pk || (c.notnull && c.dflt_value === null) || (c.dflt_value !== null && !CONSTANT_DEFAULT.test(c.dflt_value.trim())))
        if (notAddable || uniqueKeys(db, name).join('|') !== uniqueKeys(ref, name).join('|')) {
          console.log(`[db] baseline: rebuilding table ${name} to match baseline constraints`)
          rebuildTable(db, name, sql)
          continue
        }

        for (const col of missing) {
          const def = [`"${col.name}"`, col.type, col.notnull ? 'NOT NULL' : '', col.dflt_value !== null ? `DEFAULT ${col.dflt_value}` : '']
            .filter(Boolean).join(' ')
          console.log(`[db] baseline: adding missing column ${name}.${col.name}`)
          db.exec(`ALTER TABLE "${name}" ADD COLUMN ${def}`)
        }
      }
    } finally {
      ref.close()
    }

    db.exec(schema)

    // La sync Prime via cookie è stata rimossa: non conservare il cookie Amazon nel DB
    db.prepare("DELETE FROM config WHERE key = 'prime_cookies'").run()
  },
}
