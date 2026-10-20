import { hasColumn, type Migration } from '../migrate'

// v12 — shows.tmdb_aired_episodes: episodi già usciti secondo TMDB (serie ancora in onda).
//
// Una serie in corso ("Returning Series") ha in tmdb_number_of_episodes anche gli episodi
// annunciati e non ancora usciti: "completata" si misura sugli episodi usciti
// (utils/watch-status.ts). Il valore si calcola da last_episode_to_air e seasons[] di
// /tv/{id} (airedEpisodeCount) e si scrive con l'arricchimento TMDB o con l'aggiornamento
// della scheda serie (refreshAiringInfo).
//
// Solo una colonna nullable (ALTER TABLE ADD COLUMN, nessuna riga riscritta): NULL = ignoto,
// le letture usano allora il totale come prima. Nessuna chiamata TMDB qui. Idempotente.

export const airedEpisodesMigration: Migration = {
  version: 12,
  name: 'aired_episodes',
  up(db) {
    if (!hasColumn(db, 'shows', 'tmdb_aired_episodes')) {
      db.exec('ALTER TABLE shows ADD COLUMN tmdb_aired_episodes INTEGER')
    }
  },
}
