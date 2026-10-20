import { hasColumn, rebuildTable, type Migration } from '../migrate'

// v2 — media_type: TMDB usa spazi di id distinti per serie (/tv/{id}) e film
// (/movie/{id}), quindi lo stesso tmdb_id può indicare una serie e un film diversi.
// Ogni tabella che memorizza un tmdb_id riceve `media_type` ('tv' | 'movie',
// default 'tv') e le chiavi uniche su tmdb_id diventano (tmdb_id, media_type).
//
// `media_type` dice come va interpretato il tmdb_id (quale endpoint TMDB), non solo
// che cosa ha guardato l'utente. Per le righe con tmdb_id NULL descrive il contenuto.
//
// Struttura:
//   - shows, recommendations: nessun vincolo UNIQUE su tmdb_id → ALTER TABLE ADD
//     COLUMN (con CHECK); l'indice su tmdb_id diventa (tmdb_id, media_type).
//   - show_feedback (UNIQUE), show_user_status e show_ai_similar (PRIMARY KEY):
//     ricostruite con la chiave (tmdb_id, media_type). Nessuna FOREIGN KEY le
//     referenzia, quindi non serve disabilitare le FK.
//
// Regole di backfill per `shows` (tutto il resto resta 'tv'):
//   Come gli importer segnano i film oggi:
//     - episode_title = '(film)': scraping Netflix, Stremio (item.type = 'movie'),
//       import Trakt (entry.type = 'movie'), bookmarklet Prime;
//     - platform prime/netflix con episode_title = title: CSV Prime (Type = Movie:
//       title ed episode_title sono il titolo grezzo; stessa regola di
//       prime-dedup.ts) e il vecchio import CSV Netflix (titolo senza ':').
//       Il CSV Netflix attuale scrive 'Episodio' anche per i film: non riconoscibili.
//   Come è stato ottenuto il tmdb_id:
//     - Stremio: /find dall'IMDb id → per un film è un id /movie;
//     - Trakt: ids.tmdb del film → id /movie;
//     - Netflix, Prime, CSV: searchTmdbByTitle, che cerca prima /search/tv →
//       l'id è di norma una serie, anche quando il contenuto è un film;
//     - enrichShowRecord ha già scelto /movie o /tv: tmdb_status 'Released',
//       'Post Production' e 'Rumored' esistono solo per i film.
//   Quindi media_type = 'movie' se:
//     R1. tmdb_status è uno stato solo-film (arricchita come film), oppure
//     R2. la riga è un film (marcatori sopra) e
//         a. tmdb_id è NULL (nessun id da interpretare: descrive il contenuto), o
//         b. platform è 'stremio' o 'trakt' (id preso da IMDb/Trakt, già /movie;
//            l'eventuale arricchimento come serie è un errore di enrichShowRecord).
//   Un film di Netflix/Prime/CSV con tmdb_id da ricerca per titolo e senza R1 resta
//   'tv': l'id punta a una serie (abbinamento sbagliato, vedi B3) e marcarlo 'movie'
//   farebbe leggere a TMDB un film qualsiasi con quel numero. Il conteggio viene
//   loggato: vanno riabbinati (T17b).
//
// Altre tabelle:
//   - show_feedback, show_user_status, show_ai_similar: 'movie' se esiste almeno una
//     riga di shows con quel tmdb_id e sono tutte 'movie'; altrimenti 'tv'.
//     Ogni tmdb_id riceve un solo tipo, quindi le nuove chiavi non possono
//     collidere (le vecchie erano UNIQUE su tmdb_id).
//   - recommendations: sempre 'tv'. Il prompt chiede serie e il tmdb_id viene da
//     searchTmdbByTitle (prima /search/tv); nessuna colonna conserva il tipo.

const MEDIA_TYPE_COL = "media_type TEXT NOT NULL DEFAULT 'tv' CHECK (media_type IN ('tv', 'movie'))"

const MOVIE_ONLY_STATUS = "('Released', 'Post Production', 'Rumored')"
const IS_MOVIE_CONTENT = "(episode_title = '(film)' OR (platform IN ('netflix', 'prime') AND episode_title = title))"

// tmdb_id il cui tipo deducibile da `shows` è 'movie' (tutte le righe sono film)
const movieFromShows = (table: string) => `CASE WHEN EXISTS (
    SELECT 1 FROM shows s WHERE s.tmdb_id = "${table}".tmdb_id
  ) AND NOT EXISTS (
    SELECT 1 FROM shows s WHERE s.tmdb_id = "${table}".tmdb_id AND s.media_type <> 'movie'
  ) THEN 'movie' ELSE 'tv' END`

export const mediaType: Migration = {
  version: 2,
  name: 'media_type',
  up(db) {
    // ── shows ──
    if (!hasColumn(db, 'shows', 'media_type')) {
      db.exec(`ALTER TABLE shows ADD COLUMN ${MEDIA_TYPE_COL}`)
    }
    db.exec(`
      UPDATE shows SET media_type = 'movie'
      WHERE tmdb_status IN ${MOVIE_ONLY_STATUS}
         OR (${IS_MOVIE_CONTENT} AND (tmdb_id IS NULL OR platform IN ('stremio', 'trakt')))
    `)
    db.exec('DROP INDEX IF EXISTS idx_shows_tmdb_id')
    db.exec('CREATE INDEX IF NOT EXISTS idx_shows_tmdb_media ON shows(tmdb_id, media_type)')

    const kept = db.prepare(`
      SELECT COUNT(*) AS n FROM shows
      WHERE media_type = 'tv' AND tmdb_id IS NOT NULL AND ${IS_MOVIE_CONTENT}
    `).get() as { n: number }
    if (kept.n) {
      console.log(`[db] media_type: ${kept.n} film row(s) keep 'tv' because their tmdb_id was matched to a TV series`)
    }

    // ── recommendations ──
    if (!hasColumn(db, 'recommendations', 'media_type')) {
      db.exec(`ALTER TABLE recommendations ADD COLUMN ${MEDIA_TYPE_COL}`)
    }
    db.exec('DROP INDEX IF EXISTS idx_recommendations_tmdb')
    db.exec('CREATE INDEX IF NOT EXISTS idx_recommendations_tmdb_media ON recommendations(tmdb_id, media_type)')

    // ── tabelle con chiave su tmdb_id ──
    rebuildTable(db, 'show_feedback', `
      CREATE TABLE show_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tmdb_id INTEGER NOT NULL,
        ${MEDIA_TYPE_COL},
        feedback INTEGER NOT NULL DEFAULT 0,   -- 1=liked, -1=disliked, 0=neutral
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(tmdb_id, media_type)
      )`, { media_type: movieFromShows('show_feedback') })

    rebuildTable(db, 'show_ai_similar', `
      CREATE TABLE show_ai_similar (
        tmdb_id INTEGER NOT NULL,
        ${MEDIA_TYPE_COL},
        recommendations TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (tmdb_id, media_type)
      )`, { media_type: movieFromShows('show_ai_similar') })

    rebuildTable(db, 'show_user_status', `
      CREATE TABLE show_user_status (
        tmdb_id INTEGER NOT NULL,
        ${MEDIA_TYPE_COL},
        status TEXT NOT NULL,            -- 'unwatched', 'in_progress', 'completed'
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (tmdb_id, media_type)
      )`, { media_type: movieFromShows('show_user_status') })
  },
}
