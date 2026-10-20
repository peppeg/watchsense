import type { Migration } from '../migrate'

// v7 — esclusioni scelte dall'utente. Nessuna riga di `shows` si tocca o si cancella.
//
// Una riga di show_exclusions esclude un gruppo di visioni con uno di due livelli (scope):
// - 'all'     → serie ignorata: sparisce da liste, statistiche, profilo dei gusti,
//               raccomandazioni/prompt LLM e dal pannello "serie non abbinate";
// - 'profile' → serie esclusa dal profilo: resta in cronologia, liste e statistiche ma non
//               alimenta profilo dei gusti, generazione dei consigli e consigli AI simili.
//
// Il gruppo è identificato in uno di due modi (mutuamente esclusivi, vedi CHECK):
// - per serie abbinata: (tmdb_id, media_type), come show_feedback/show_user_status;
// - per gruppo senza abbinamento: (title, platform) esatti, la chiave con cui
//   /api/match/unmatched elenca le serie non abbinate (solo scope 'all'). La chiave non
//   dipende dal tmdb_id: le visioni nuove dello stesso titolo e piattaforma (import/sync)
//   restano ignorate, anche se nel frattempo ricevono un abbinamento.
// Le due esclusioni di una serie abbinata sono righe separate: ripristinare una serie
// ignorata non perde l'esclusione dal profilo (e viceversa).
//
// I filtri sono in utils/series-filter.ts (seriesRows, profileSeriesRows).

export const showExclusions: Migration = {
  version: 7,
  name: 'show_exclusions',
  up(db) {
    db.exec(`
      CREATE TABLE show_exclusions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL CHECK (scope IN ('all', 'profile')),
        tmdb_id INTEGER,
        media_type TEXT NOT NULL DEFAULT 'tv' CHECK (media_type IN ('tv', 'movie')),
        title TEXT,
        platform TEXT,
        label TEXT NOT NULL,                  -- nome da mostrare nell'elenco degli ignorati
        created_at TEXT DEFAULT (datetime('now')),
        CHECK (
          (tmdb_id IS NOT NULL AND title IS NULL AND platform IS NULL)
          OR (tmdb_id IS NULL AND title IS NOT NULL AND platform IS NOT NULL AND scope = 'all')
        )
      )
    `)
    db.exec(`
      CREATE UNIQUE INDEX idx_show_exclusions_tmdb ON show_exclusions(tmdb_id, media_type, scope)
        WHERE tmdb_id IS NOT NULL
    `)
    db.exec(`
      CREATE UNIQUE INDEX idx_show_exclusions_group ON show_exclusions(title, platform)
        WHERE tmdb_id IS NULL
    `)
  },
}
