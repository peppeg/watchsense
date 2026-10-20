import type { Migration } from '../migrate'

// v10 — lingua e regione per le installazioni esistenti (ADR-001 §1). Solo dati.
//
// Le installazioni nuove partono in inglese (default di utils/locale.ts). Un DB che ha già
// una cronologia di visioni (almeno una riga in `shows`) è un'istanza nata quando l'app era
// solo italiana: si scrivono app_locale=it, tmdb_language=it-IT, tmdb_region=IT, così
// l'aggiornamento non la passa all'inglese. INSERT OR IGNORE: un valore già presente (scelto
// dall'utente) non si tocca. DB vuoto → nessuna scrittura. Idempotente.

export const localeDefaultsMigration: Migration = {
  version: 10,
  name: 'locale_defaults',
  up(db) {
    if (!db.prepare('SELECT 1 FROM shows LIMIT 1').get()) return
    const insert = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)')
    let written = 0
    for (const [key, value] of [['app_locale', 'it'], ['tmdb_language', 'it-IT'], ['tmdb_region', 'IT']]) {
      written += insert.run(key, value).changes
    }
    if (written > 0) console.log(`[db] v10: lingua e regione italiane impostate (${written} chiavi)`)
  },
}
