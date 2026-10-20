/**
 * Stato di visione di un titolo: quello esplicito scelto dall'utente (`show_user_status`,
 * pulsante nella scheda serie) vince; senza, si deduce dagli episodi registrati.
 * Usato da scheda serie, pulsante di visione e Libreria, così mostrano lo stesso stato.
 *
 * Lo stato esplicito cede ai dati importati più recenti: quando un import aggiunge visioni
 * di quel titolo, runIngest cancella lo stato esplicito (releaseExplicitStatus in
 * utils/ingest.ts) e lo stato torna a dedursi dagli episodi.
 *
 * "Completata" si misura sugli episodi USCITI (serie ancora in onda), non su quelli
 * previsti: con 2 episodi usciti su 8 annunciati, averne visti 2 vuol dire essere in pari.
 *
 * Le statistiche sul numero di episodi restano sulle righe reali di `shows`: segnare una
 * serie come completata non inventa episodi.
 */
import type { MediaType } from './sync-helpers'

export type WatchStatus = 'unwatched' | 'in_progress' | 'completed'

export function parseWatchStatus(value: unknown): WatchStatus | null {
  return value === 'unwatched' || value === 'in_progress' || value === 'completed' ? value : null
}

export interface WatchFacts {
  /** Stato salvato in show_user_status (o null). */
  explicit?: unknown
  mediaType: MediaType
  /** Episodi distinti registrati in `shows`. */
  episodeCount: number
  /** Episodi totali secondo TMDB (null/0 se ignoti). */
  totalEpisodes?: number | null
  /** Episodi già usciti secondo TMDB (tmdb_aired_episodes; null/0 se ignoti). */
  airedEpisodes?: number | null
  /** Piattaforme delle visioni, separate da virgola (GROUP_CONCAT). */
  platforms?: string | null
}

/** Episodi che servono per "completata": gli usciti se noti, altrimenti il totale (0 = ignoto). */
export function episodesToComplete(totalEpisodes?: number | null, airedEpisodes?: number | null): number {
  const total = totalEpisodes && totalEpisodes > 0 ? totalEpisodes : 0
  const aired = airedEpisodes && airedEpisodes > 0 ? airedEpisodes : 0
  if (!aired) return total
  return total ? Math.min(aired, total) : aired
}

export function deriveWatchStatus(f: WatchFacts): WatchStatus {
  const explicit = parseWatchStatus(f.explicit)
  if (explicit) return explicit
  return episodeWatchStatus(f)
}

/** Stato dedotto solo dagli episodi registrati (ignora lo stato esplicito). */
export function episodeWatchStatus(f: WatchFacts): WatchStatus {
  if (!f.episodeCount || f.episodeCount <= 0) return 'unwatched'
  // Un film non ha episodi: una visione registrata basta
  if (f.mediaType === 'movie') return 'completed'
  const needed = episodesToComplete(f.totalEpisodes, f.airedEpisodes)
  if (needed && f.episodeCount >= needed) return 'completed'
  // Un solo episodio senza totale noto: aggiunta manuale "vista" (Trakt/Stremio esclusi)
  if (!needed && f.episodeCount === 1 && f.platforms !== 'trakt' && f.platforms !== 'stremio') return 'completed'
  return 'in_progress'
}

/**
 * Stato successivo del pulsante della scheda: in corso → completata → non vista → in corso.
 * Da "non vista":
 * - film: completato (una visione basta);
 * - serie con episodi importati che secondo gli episodi è già completata (in pari con gli
 *   episodi usciti): torna a completata, cioè allo stato degli episodi importati;
 * - altrimenti in corso, anche per una serie non ancora in libreria (riga manuale).
 */
export function nextWatchStatus(
  current: WatchStatus,
  opts: { mediaType: MediaType; importedRows: number; episodeStatus?: WatchStatus },
): WatchStatus {
  if (current === 'in_progress') return 'completed'
  if (current === 'completed') return 'unwatched'
  if (opts.mediaType === 'movie') return 'completed'
  return opts.importedRows > 0 && opts.episodeStatus === 'completed' ? 'completed' : 'in_progress'
}

/**
 * Episodi usciti secondo i dettagli TMDB di una serie (/tv/{id}): episodi delle stagioni
 * precedenti a quella di last_episode_to_air (speciali, stagione 0, esclusi) + il suo numero.
 * null se TMDB non lo dice (nessun episodio uscito, ultimo uscito uno speciale, stagioni
 * mancanti). Mai più del totale dichiarato.
 */
export function airedEpisodeCount(details: any): number | null {
  const last = details?.last_episode_to_air
  const season = Number(last?.season_number)
  const episode = Number(last?.episode_number)
  if (!Number.isInteger(season) || season < 1 || !Number.isInteger(episode) || episode < 1) return null
  if (!Array.isArray(details?.seasons)) return null
  let aired = episode
  for (const s of details.seasons) {
    const n = Number(s?.season_number)
    if (Number.isInteger(n) && n >= 1 && n < season) aired += Number(s?.episode_count) || 0
  }
  const total = Number(details?.number_of_episodes)
  return total > 0 ? Math.min(aired, total) : aired
}

/**
 * Avanzamento 0–100 per la Libreria: completata = 100, non vista = 0, altrimenti
 * episodi registrati / episodi totali (100 se il totale è ignoto, come prima).
 */
export function watchProgress(status: WatchStatus, episodeCount: number, totalEpisodes?: number | null): number {
  if (status === 'completed') return 100
  if (status === 'unwatched') return 0
  const total = totalEpisodes || 0
  const watched = episodeCount || 1
  return total > 0 ? Math.min(100, Math.round((watched / total) * 100)) : 100
}
