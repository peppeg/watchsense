import type { Migration } from '../migrate'
import { normalizeGenres } from '../../utils/genres'

// v9 — generi in un'unica lingua. Solo dati, nessuna chiamata TMDB.
//
// Una parte delle serie è stata arricchita con i generi in inglese ("Drama", "Mystery") e
// TMDB in italiano lascia comunque in inglese alcuni generi ("Kids", "Sci-Fi & Fantasy"):
// il profilo gusti contava "Dramma" e "Drama" come generi diversi. Si riscrive
// shows.tmdb_genres con i nomi di utils/genres.ts (gli arricchimenti nuovi li usano già).
// Valori non JSON o non array restano come sono. Idempotente.
//
// Nota: dalla v11 utils/genres.ts produce i nomi canonici inglesi, quindi su un DB vecchio
// questa migrazione scrive già l'inglese e la v11 non ha più niente da fare.

export const normalizeGenresMigration: Migration = {
  version: 9,
  name: 'normalize_genres',
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
      const normalized = JSON.stringify(normalizeGenres(list))
      if (normalized !== value) rows += update.run(normalized, value).changes
    }
    if (rows > 0) console.log(`[db] v9: genres normalized on ${rows} row(s)`)
  },
}
