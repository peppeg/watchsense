import type { Migration } from '../migrate'
import { normalizeGenres } from '../../utils/genres'

// v11 — generi in forma canonica inglese (ADR-001 §3). Solo dati, nessuna chiamata TMDB.
//
// La v9 aveva unificato i generi in italiano ("Dramma", "Fantascienza & Fantasy"); ora nel DB
// si salva il nome inglese di TMDB e la traduzione si fa in uscita, nella lingua dell'app
// (utils/genres.ts). Si riscrive shows.tmdb_genres con normalizeGenres, come nella v9: i nomi
// italiani tornano inglesi, quelli già inglesi restano, gli ignoti passano invariati.
// Valori non JSON o non array restano come sono. Idempotente.

export const canonicalGenresMigration: Migration = {
  version: 11,
  name: 'canonical_genres',
  up(db) {
    const values = db.prepare(`
      SELECT DISTINCT tmdb_genres AS value FROM shows WHERE tmdb_genres IS NOT NULL
    `).all() as { value: string }[]
    const update = db.prepare('UPDATE shows SET tmdb_genres = ? WHERE tmdb_genres = ?')
    let rows = 0
    for (const { value } of values) {
      let list: unknown
      try {
        list = JSON.parse(value)
      } catch {
        continue
      }
      if (!Array.isArray(list)) continue
      const canonical = JSON.stringify(normalizeGenres(list))
      if (canonical !== value) rows += update.run(canonical, value).changes
    }
    if (rows > 0) console.log(`[db] v11: genres restored to English names on ${rows} row(s)`)
  },
}
