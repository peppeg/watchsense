import { join, dirname, resolve } from 'path'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'

// Radice del progetto: risale da questo file fino a trovare db/schema.sql.
// Robusto sia in dev (ui/server/utils/) sia in build di produzione (.output/server/).
export function findProjectRoot(): string {
  if (existsSync(join(process.cwd(), 'db', 'schema.sql'))) {
    return process.cwd()
  }
  if (existsSync(join(process.cwd(), '..', 'db', 'schema.sql'))) {
    return resolve(process.cwd(), '..')
  }
  try {
    let dir = dirname(fileURLToPath(import.meta.url))
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, 'db', 'schema.sql'))) return dir
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {}
  return process.cwd()
}

// Cartella degli export (Trakt, ecc.): EXPORTS_PATH oppure <root>/exports.
export function getExportsDir(): string {
  const fromEnv = process.env.EXPORTS_PATH?.trim()
  return fromEnv ? resolve(fromEnv) : join(findProjectRoot(), 'exports')
}

// File del database SQLite: DATABASE_PATH oppure <root>/data/watchsense.db.
export function getDatabasePath(): string {
  return process.env.DATABASE_PATH
    ? resolve(process.env.DATABASE_PATH.trim())
    : join(findProjectRoot(), 'data', 'watchsense.db')
}

/** Cartella dati di default (<root>/data): l'unica di cui si restringono i permessi. */
export function getDefaultDataDir(): string {
  return join(findProjectRoot(), 'data')
}
