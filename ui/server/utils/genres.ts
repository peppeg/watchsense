/**
 * Generi TMDB (ADR-001 §3). Nel DB si salvano in forma canonica, con il nome inglese di
 * TMDB (/genre/tv/list e /genre/movie/list con language=en-US); la traduzione si fa solo
 * in uscita, nella lingua dell'app.
 *
 * In ingresso arrivano anche nomi italiani: TMDB con language=it-IT traduce solo una parte
 * dei generi ("Dramma", ma "Kids" e "Sci-Fi & Fantasy" restano in inglese) e la v9 aveva
 * salvato tutto in italiano. `normalizeGenre` li riporta al nome inglese, così "Dramma" e
 * "Drama" restano un solo genere. I nomi non in tabella passano invariati.
 */
import type { AppLocale } from './locale'

/**
 * Nome canonico (inglese) → nome italiano mostrato. Serie e film insieme; i nomi uguali
 * nelle due lingue (Crime, Reality, Western, Fantasy, Horror, Romance, Thriller) ci sono
 * lo stesso, per avere qui l'elenco completo. Per i generi delle serie che TMDB lascia in
 * inglese si usano i nomi italiani già mostrati finora (scritti dalla v9).
 */
const GENRE_IT: Record<string, string> = {
  // Serie (/genre/tv/list)
  'Action & Adventure': 'Azione & Avventura',
  'Animation': 'Animazione',
  'Comedy': 'Commedia',
  'Crime': 'Crime',
  'Documentary': 'Documentario',
  'Drama': 'Dramma',
  'Family': 'Famiglia',
  'Kids': 'Bambini',
  'Mystery': 'Mistero',
  'News': 'Notizie',
  'Reality': 'Reality',
  'Sci-Fi & Fantasy': 'Fantascienza & Fantasy',
  'Soap': 'Soap opera',
  'Talk': 'Talk show',
  'War & Politics': 'Guerra & Politica',
  'Western': 'Western',
  // Solo film (/genre/movie/list)
  'Action': 'Azione',
  'Adventure': 'Avventura',
  'Fantasy': 'Fantasy',
  'History': 'Storia',
  'Horror': 'Horror',
  'Music': 'Musica',
  'Romance': 'Romance',
  'Science Fiction': 'Fantascienza',
  'TV Movie': 'Film TV',
  'Thriller': 'Thriller',
  'War': 'Guerra',
}

/** Nome (minuscolo) → nome canonico: i canonici stessi, i nomi italiani e gli alias. */
const CANONICAL = new Map<string, string>()
for (const [en, it] of Object.entries(GENRE_IT)) {
  CANONICAL.set(en.toLowerCase(), en)
  CANONICAL.set(it.toLowerCase(), en)
}
// TMDB it-IT chiama così "TV Movie"
CANONICAL.set('televisione film', 'TV Movie')

/** Nome canonico (inglese) di un genere, in qualunque lingua arrivi; ignoti invariati. */
export function normalizeGenre(name: string): string {
  const trimmed = name.trim()
  return CANONICAL.get(trimmed.toLowerCase()) ?? trimmed
}

/** Generi normalizzati, senza doppioni, nell'ordine originale; i valori non stringa si scartano. */
export function normalizeGenres(names: unknown): string[] {
  if (!Array.isArray(names)) return []
  const out: string[] = []
  for (const name of names) {
    if (typeof name !== 'string' || !name.trim()) continue
    const genre = normalizeGenre(name)
    if (!out.includes(genre)) out.push(genre)
  }
  return out
}

/** Nome da mostrare nella lingua dell'app (accetta anche nomi non canonici). */
export function localizeGenre(name: string, appLocale: AppLocale): string {
  const canonical = normalizeGenre(name)
  return appLocale === 'it' ? GENRE_IT[canonical] ?? canonical : canonical
}

/** Come normalizeGenres, ma con i nomi nella lingua dell'app. */
export function localizeGenres(names: unknown, appLocale: AppLocale): string[] {
  const out: string[] = []
  for (const genre of normalizeGenres(names)) {
    const label = localizeGenre(genre, appLocale)
    if (!out.includes(label)) out.push(label)
  }
  return out
}

/** Colonna shows.tmdb_genres (JSON) → generi canonici; [] se assente o non valida. */
export function parseStoredGenres(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    return normalizeGenres(JSON.parse(value))
  } catch {
    return []
  }
}

/** Colonna shows.tmdb_genres (JSON) → generi nella lingua dell'app; [] se assente o non valida. */
export function storedGenres(value: string | null | undefined, appLocale: AppLocale): string[] {
  return localizeGenres(parseStoredGenres(value), appLocale)
}
