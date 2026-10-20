import type { Migration } from '../migrate'

// v4 — film "silenziosi": WatchSense è un'app per serie TV. I film delle cronologie
// restano registrati con media_type 'movie' ma non si mostrano né si usano; non si
// cercano né si arricchiscono su TMDB (vedi utils/ingest.ts). Solo dati, nessuna
// chiamata TMDB.
//
// 1. Film rimasti 'tv' dopo la v2: stessa regola con cui la v2 li contava nel log
//    ("film row(s) keep 'tv' because their tmdb_id was matched to a TV series"):
//      media_type = 'tv' AND tmdb_id IS NOT NULL AND
//      (episode_title = '(film)' OR (platform IN ('netflix', 'prime') AND episode_title = title))
//    Il tmdb_id viene da searchTmdbByTitle (prima /search/tv): punta a una serie non
//    correlata (es. "MOON" → Moon Knight). Diventano 'movie' con tmdb_id NULL e senza
//    metadati tmdb_* (quelli della serie sbagliata).
//    Ambiguità: un episodio Prime/Netflix intitolato come la sua serie ha la stessa forma
//    (episode_title = title). Il CSV Prime scrive title = episode_title solo per
//    Type = Movie e il CSV Netflix mette il prefisso della serie nell'episode_title,
//    quindi è un caso raro; la regola è comunque identica a quella della v2.
//
// 2. Film già 'movie' arricchiti come serie: enrichShowRecord (prima della v2) poteva
//    leggere un id /movie sull'endpoint /tv. Si riconoscono dallo stato: tutto ciò che
//    non è uno stato solo-film ('Released', 'Post Production', 'Rumored'). Si azzerano
//    i metadati tmdb_* e si tiene il tmdb_id (è un id /movie corretto, es. Stremio/Trakt).
//
// Tabelle collegate (show_feedback, show_user_status, show_ai_similar, recommendations):
// non si toccano. Sono chiavate su (tmdb_id, media_type); le righe (id, 'tv') di quegli
// id restano valide per le serie che li usano ancora e, se nessuna riga di shows li
// usa più, non vengono più lette (le letture partono da shows con media_type 'tv').

const MOVIE_ONLY_STATUS = "('Released', 'Post Production', 'Rumored')"
const IS_MOVIE_CONTENT = "(episode_title = '(film)' OR (platform IN ('netflix', 'prime') AND episode_title = title))"

const CLEAR_ENRICHMENT = `
  tmdb_name = NULL,
  tmdb_genres = NULL,
  tmdb_overview = NULL,
  tmdb_keywords = NULL,
  tmdb_networks = NULL,
  tmdb_watch_providers = NULL,
  tmdb_vote_avg = NULL,
  tmdb_status = NULL,
  enriched_at = NULL,
  poster_path = NULL,
  backdrop_path = NULL,
  tmdb_number_of_episodes = NULL,
  tmdb_number_of_seasons = NULL,
  tmdb_first_air_date = NULL`

const HAS_ENRICHMENT = `(tmdb_name IS NOT NULL OR tmdb_genres IS NOT NULL OR tmdb_overview IS NOT NULL
  OR tmdb_status IS NOT NULL OR enriched_at IS NOT NULL OR poster_path IS NOT NULL)`

export const silentMovies: Migration = {
  version: 4,
  name: 'silent_movies',
  up(db) {
    const relabeled = db.prepare(`
      UPDATE shows SET media_type = 'movie', tmdb_id = NULL, ${CLEAR_ENRICHMENT}
      WHERE media_type = 'tv' AND tmdb_id IS NOT NULL AND ${IS_MOVIE_CONTENT}
    `).run()
    if (relabeled.changes) {
      console.log(`[db] silent_movies: ${relabeled.changes} film row(s) matched to a TV series → 'movie', tmdb_id cleared`)
    }

    const cleared = db.prepare(`
      UPDATE shows SET ${CLEAR_ENRICHMENT}
      WHERE media_type = 'movie'
        AND (tmdb_status IS NULL OR tmdb_status NOT IN ${MOVIE_ONLY_STATUS})
        AND ${HAS_ENRICHMENT}
    `).run()
    if (cleared.changes) {
      console.log(`[db] silent_movies: ${cleared.changes} film row(s) with TV metadata cleared`)
    }
  },
}
