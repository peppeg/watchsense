import { hasColumn, type Migration } from '../migrate'

// v3 — is_manual: distingue le righe di `shows` aggiunte a mano dall'utente
// ("visto" nel dettaglio serie, "già visto" su una raccomandazione) dalla
// cronologia importata. "Non visto" cancella solo le righe manuali: prima
// cancellava `platform = 'manual'`, ma l'aggiunta manuale usa spesso la
// piattaforma del provider TMDB (netflix, prime, …) e quelle righe restavano.
//
// Backfill (conservativo): le due aggiunte manuali scrivono sempre
// `watched_at = datetime('now')` ('YYYY-MM-DD HH:MM:SS') ed `episode_title` NULL.
// Nessun import produce questa combinazione: Netflix/Prime/CSV/bookmarklet scrivono
// sempre un episode_title e date 'YYYY-MM-DD' (o ISO con 'T'); Trakt scrive sempre
// un episode_title; Stremio può lasciare episode_title NULL ma con una data, e lo si
// esclude comunque per piattaforma insieme a Trakt.

const SQLITE_DATETIME = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'"

export const isManual: Migration = {
  version: 3,
  name: 'is_manual',
  up(db) {
    if (!hasColumn(db, 'shows', 'is_manual')) {
      db.exec('ALTER TABLE shows ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0 CHECK (is_manual IN (0, 1))')
    }
    const res = db.prepare(`
      UPDATE shows SET is_manual = 1
      WHERE is_manual = 0
        AND episode_title IS NULL
        AND watched_at GLOB ${SQLITE_DATETIME}
        AND platform NOT IN ('stremio', 'trakt')
    `).run()
    if (res.changes) console.log(`[db] is_manual: ${res.changes} manually-added row(s) marked`)
  },
}
