/**
 * Lingua dell'app e lingua/regione TMDB (ADR-001 §1).
 *
 * Tre chiavi indipendenti in `config`; le variabili d'ambiente danno solo il valore
 * iniziale. Per ogni chiave: valore in DB → env → default. Un valore non valido si
 * ignora e si passa al successivo.
 *
 * | config          | env               | default |
 * | app_locale      | WATCHSENSE_LOCALE | en      |
 * | tmdb_language   | TMDB_LANGUAGE     | en-US   |
 * | tmdb_region     | TMDB_REGION       | US      |
 *
 * Le installazioni esistenti restano in italiano grazie alla migrazione v10.
 */
import type Database from 'better-sqlite3'
import { getDb } from './db'

export const SUPPORTED_LOCALES = ['en', 'it'] as const
export type AppLocale = typeof SUPPORTED_LOCALES[number]

export interface LocaleConfig {
  appLocale: AppLocale
  tmdbLanguage: string
  tmdbRegion: string
}

export const LOCALE_DEFAULTS: LocaleConfig = {
  appLocale: 'en',
  tmdbLanguage: 'en-US',
  tmdbRegion: 'US',
}

export const LOCALE_CONFIG_KEYS = {
  appLocale: 'app_locale',
  tmdbLanguage: 'tmdb_language',
  tmdbRegion: 'tmdb_region',
} as const

/** `en` | `it` (maiuscole e spazi tollerati); null se non supportata. */
export function normalizeAppLocale(value: unknown): AppLocale | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return (SUPPORTED_LOCALES as readonly string[]).includes(v) ? v as AppLocale : null
}

/** Lingua TMDB nella forma `xx-YY` (es. `it-IT`, `en-GB`); null se non valida. */
export function normalizeTmdbLanguage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^([a-z]{2})-([a-z]{2})$/i.exec(value.trim())
  return m ? `${m[1]!.toLowerCase()}-${m[2]!.toUpperCase()}` : null
}

/** Paese ISO 3166-1 alpha-2 in maiuscolo (es. `IT`); null se non valido. */
export function normalizeTmdbRegion(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return /^[a-z]{2}$/i.test(v) ? v.toUpperCase() : null
}

function pick<T>(normalize: (v: unknown) => T | null, dbValue: unknown, envValue: unknown, fallback: T): T {
  return normalize(dbValue) ?? normalize(envValue) ?? fallback
}

/** Config effettiva (DB → env → default). */
export function getLocaleConfig(db: Database.Database = getDb()): LocaleConfig {
  const rows = db.prepare('SELECT key, value FROM config WHERE key IN (?, ?, ?)')
    .all(LOCALE_CONFIG_KEYS.appLocale, LOCALE_CONFIG_KEYS.tmdbLanguage, LOCALE_CONFIG_KEYS.tmdbRegion) as { key: string; value: string }[]
  const stored = Object.fromEntries(rows.map(r => [r.key, r.value]))
  return {
    appLocale: pick(normalizeAppLocale, stored.app_locale, process.env.WATCHSENSE_LOCALE, LOCALE_DEFAULTS.appLocale),
    tmdbLanguage: pick(normalizeTmdbLanguage, stored.tmdb_language, process.env.TMDB_LANGUAGE, LOCALE_DEFAULTS.tmdbLanguage),
    tmdbRegion: pick(normalizeTmdbRegion, stored.tmdb_region, process.env.TMDB_REGION, LOCALE_DEFAULTS.tmdbRegion),
  }
}

/**
 * Lingua e regione scelte almeno una volta: una delle tre chiavi salvata in DB (Impostazioni
 * o migrazione v10) o impostata nell'env. Solo default → false (lista "Per iniziare").
 */
export function isLocaleConfigured(db: Database.Database = getDb()): boolean {
  const stored = db.prepare('SELECT 1 FROM config WHERE key IN (?, ?, ?) LIMIT 1')
    .get(LOCALE_CONFIG_KEYS.appLocale, LOCALE_CONFIG_KEYS.tmdbLanguage, LOCALE_CONFIG_KEYS.tmdbRegion)
  if (stored) return true
  return Boolean(normalizeAppLocale(process.env.WATCHSENSE_LOCALE)
    || normalizeTmdbLanguage(process.env.TMDB_LANGUAGE)
    || normalizeTmdbRegion(process.env.TMDB_REGION))
}
