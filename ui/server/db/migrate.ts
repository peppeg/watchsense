import type Database from 'better-sqlite3'

// Migrazione di schema numerata. `version` parte da 1 ed è contigua: il DB
// registra in `PRAGMA user_version` l'ultima versione applicata.
export interface Migration {
  version: number
  name: string
  // Per ricostruzioni di tabelle referenziate da FOREIGN KEY: il runner spegne
  // le FK (fuori dalla transazione, unico modo in SQLite), esegue `up` e prima
  // del commit verifica `PRAGMA foreign_key_check`.
  disableForeignKeys?: boolean
  up(db: Database.Database): void
}

export function getSchemaVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number
}

// Applica in ordine le migrazioni con version > user_version.
// Ognuna gira in una transazione IMMEDIATE insieme all'aggiornamento di
// user_version: se fallisce, rollback completo e errore esplicito.
export function runMigrations(db: Database.Database, migrations: Migration[]): number {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(`Migrations must be numbered 1..n without gaps: found v${m.version} (${m.name}) at position ${i + 1}`)
    }
  })
  const latest = migrations.length
  const current = getSchemaVersion(db)
  if (current > latest) {
    throw new Error(
      `Database schema is v${current} but this WatchSense build only knows up to v${latest}. ` +
      'Upgrade WatchSense or restore a backup made with this version.',
    )
  }

  for (const m of migrations.slice(current)) {
    const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1
    if (m.disableForeignKeys) db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        m.up(db)
        if (m.disableForeignKeys) {
          const violations = db.pragma('foreign_key_check') as unknown[]
          if (violations.length) throw new Error(`${violations.length} foreign key violation(s) after migration`)
        }
        db.pragma(`user_version = ${m.version}`)
      }).immediate()
      console.log(`[db] applied migration v${m.version} (${m.name})`)
    } catch (e: any) {
      throw new Error(`Database migration v${m.version} (${m.name}) failed and was rolled back: ${e?.message ?? e}`, { cause: e })
    } finally {
      if (m.disableForeignKeys && fkWasOn) db.pragma('foreign_keys = ON')
    }
  }
  return latest
}

// ── Helper per le migrazioni ──

export interface ColumnInfo {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

export function tableExists(db: Database.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
}

export function tableColumns(db: Database.Database, table: string): ColumnInfo[] {
  return db.prepare(`PRAGMA table_info("${table}")`).all() as ColumnInfo[]
}

export function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return tableColumns(db, table).some(c => c.name === column)
}

// Ricostruisce `table` con una nuova definizione (procedura "12 passi" di SQLite):
// crea la tabella nuova, copia le colonne in comune (`select` permette di
// sovrascrivere l'espressione per singole colonne, es. per un backfill), elimina la
// vecchia e rinomina. Gli indici della vecchia tabella vanno ricreati dal chiamante.
// Usa INSERT semplice: se la nuova definizione è più restrittiva e alcune righe non
// entrano, la migrazione fallisce (rollback) invece di perdere dati.
export function rebuildTable(
  db: Database.Database,
  table: string,
  createSql: string,
  select: Record<string, string> = {},
): void {
  const tmp = `${table}__new`
  const re = new RegExp(`^\\s*CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?["\`\\[]?${table}["\`\\]]?`, 'i')
  if (!re.test(createSql)) throw new Error(`rebuildTable: CREATE statement is not for table ${table}`)
  db.exec(`DROP TABLE IF EXISTS "${tmp}"`)
  db.exec(createSql.replace(re, `CREATE TABLE "${tmp}"`))

  const oldCols = new Set(tableColumns(db, table).map(c => c.name))
  const cols = tableColumns(db, tmp).map(c => c.name).filter(c => oldCols.has(c) || c in select)
  const target = cols.map(c => `"${c}"`).join(', ')
  const source = cols.map(c => select[c] ?? `"${c}"`).join(', ')
  db.exec(`INSERT INTO "${tmp}" (${target}) SELECT ${source} FROM "${table}"`)
  // AUTOINCREMENT: conserva il massimo id mai assegnato (non solo quello delle righe
  // rimaste), così gli id di righe cancellate non vengono riusati.
  const oldSeq = tableExists(db, 'sqlite_sequence')
    ? (db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table) as { seq: number } | undefined)?.seq
    : undefined
  db.exec(`DROP TABLE "${table}"`)
  db.exec(`ALTER TABLE "${tmp}" RENAME TO "${table}"`)
  if (oldSeq !== undefined) {
    db.prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?').run(oldSeq, table)
  }
}
