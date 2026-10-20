import type { Migration } from '../migrate'
import { baseline } from './001_baseline'
import { mediaType } from './002_media_type'
import { isManual } from './003_is_manual'
import { silentMovies } from './004_silent_movies'
import { normalizeSeriesTitlesMigration } from './005_normalize_series_titles'
import { decodeHtmlEntitiesMigration } from './006_decode_html_entities'
import { showExclusions } from './007_show_exclusions'
import { dedupePrimeViewsMigration } from './008_dedupe_prime_views'
import { normalizeGenresMigration } from './009_normalize_genres'
import { localeDefaultsMigration } from './010_locale_defaults'
import { canonicalGenresMigration } from './011_canonical_genres'
import { airedEpisodesMigration } from './012_aired_episodes'
import { encryptSecretsMigration } from './013_encrypt_secrets'

// Elenco ordinato delle migrazioni: version = posizione (1..n, senza buchi).
// Per aggiungerne una: crea `NNN_nome.ts` che esporta una `Migration` con
// version = ultima + 1 e aggiungila in fondo a questo array.
export const migrations: Migration[] = [
  baseline,
  mediaType,
  isManual,
  silentMovies,
  normalizeSeriesTitlesMigration,
  decodeHtmlEntitiesMigration,
  showExclusions,
  dedupePrimeViewsMigration,
  normalizeGenresMigration,
  localeDefaultsMigration,
  canonicalGenresMigration,
  airedEpisodesMigration,
  encryptSecretsMigration,
]
