/**
 * Condizioni SQL sulle righe di `shows`, da usare in ogni lettura invece di condizioni ad hoc.
 *
 * `alias` è l'alias della tabella nella query (es. 's'); vuoto se la query legge `FROM shows`
 * senza alias (le colonne si qualificano allora con `shows.`, necessario nelle sottoquery
 * su show_exclusions).
 */

function prefix(alias: string): string {
  return alias ? `${alias}.` : 'shows.'
}

/**
 * Righe che sono visioni di una serie, ignorate comprese:
 * - media_type 'tv': i film sono registrati ma silenziosi;
 * - titolo della serie non vuoto: il CSV Netflix contiene righe senza nome della serie
 *   (" : Episodio 6"). Gli import non le salvano più; quelle già presenti restano nel DB
 *   ma vengono ignorate.
 *
 * Solo per i controlli interni "l'utente l'ha già vista?" (es. scartare un consiglio
 * generato): nelle letture rivolte all'utente si usa seriesRows.
 */
export function anySeriesRows(alias = ''): string {
  const p = prefix(alias)
  return `${p}media_type = 'tv' AND TRIM(${p}title) != ''`
}

/** Righe coperte da un'esclusione (show_exclusions) con uno degli scope indicati: per
 *  serie abbinata (tmdb_id, media_type) o per gruppo (title, platform) esatti. */
function excludedBy(alias: string, scopes: string): string {
  const p = prefix(alias)
  return `EXISTS (
    SELECT 1 FROM show_exclusions x
    WHERE x.scope IN (${scopes}) AND (
      (x.tmdb_id IS NOT NULL AND x.tmdb_id = ${p}tmdb_id AND x.media_type = ${p}media_type)
      OR (x.tmdb_id IS NULL AND x.title = ${p}title AND x.platform = ${p}platform)
    )
  )`
}

/**
 * Righe che contano come visioni di una serie in ogni lettura rivolta all'utente (liste,
 * statistiche, profilo dei gusti, prompt LLM, pannello delle serie non abbinate,
 * riabbinamenti): anySeriesRows meno le serie ignorate dall'utente (scope 'all').
 */
export function seriesRows(alias = ''): string {
  return `${anySeriesRows(alias)} AND NOT ${excludedBy(alias, "'all'")}`
}

/**
 * Righe che alimentano il gusto dell'utente (profilo, sintesi AI, generazione dei consigli):
 * seriesRows meno le serie escluse dal profilo (scope 'profile'), che restano invece
 * visibili in liste e statistiche.
 */
export function profileSeriesRows(alias = ''): string {
  return `${seriesRows(alias)} AND NOT ${excludedBy(alias, "'profile'")}`
}
