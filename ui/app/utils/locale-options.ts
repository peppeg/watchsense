/**
 * Opzioni della sezione "Lingua e regione" delle Impostazioni (ADR-001 §1): nomi di lingue
 * e paesi da Intl.DisplayNames nella lingua dell'app, nessuna tabella da tradurre.
 */

export interface LocaleOption {
  value: string
  label: string
}

/** Lingue TMDB proposte (forma xx-YY); quella salvata si aggiunge se manca. */
export const TMDB_LANGUAGES = [
  'en-US', 'en-GB', 'it-IT', 'de-DE', 'fr-FR', 'es-ES', 'es-MX', 'pt-BR', 'pt-PT',
  'nl-NL', 'sv-SE', 'da-DK', 'nb-NO', 'fi-FI', 'pl-PL', 'cs-CZ', 'tr-TR', 'ja-JP', 'ko-KR',
] as const

function displayName(displayLocale: string, type: 'language' | 'region', code: string): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type, fallback: 'code' }).of(code) || code
  } catch {
    return code
  }
}

const capitalize = (s: string, locale: string) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1)

/** Nome di una lingua dell'app nella lingua stessa ("English", "Italiano"). */
export function nativeLanguageName(code: string): string {
  return capitalize(displayName(code, 'language', code), code)
}

/** Nome di un paese ISO 3166-1 nella lingua `displayLocale` ("Italia", "United States"). */
export function regionName(code: string, displayLocale: string): string {
  return displayName(displayLocale, 'region', code)
}

const byLabel = (displayLocale: string) => (a: LocaleOption, b: LocaleOption) => a.label.localeCompare(b.label, displayLocale)

/** Lingue TMDB come "Inglese americano · en-US", in ordine alfabetico; `current` sempre presente. */
export function tmdbLanguageOptions(current: string | null | undefined, displayLocale: string): LocaleOption[] {
  const codes: string[] = [...TMDB_LANGUAGES]
  if (current && !codes.includes(current)) codes.push(current)
  return codes
    .map(code => ({ value: code, label: `${capitalize(displayName(displayLocale, 'language', code), displayLocale)} · ${code}` }))
    .sort(byLabel(displayLocale))
}

/**
 * Paesi proposti: quelli con le classifiche verificate (tabella del server), più `current`
 * se è un altro paese; come "Italia · IT", in ordine alfabetico.
 */
export function regionOptions(verified: readonly string[], current: string | null | undefined, displayLocale: string): LocaleOption[] {
  const codes = [...verified]
  if (current && !codes.includes(current)) codes.push(current)
  return codes
    .map(code => ({ value: code, label: `${regionName(code, displayLocale)} · ${code}` }))
    .sort(byLabel(displayLocale))
}

/** Codice paese di due lettere in maiuscolo; null se non valido. */
export function normalizeRegionInput(value: string): string | null {
  const v = value.trim()
  return /^[a-z]{2}$/i.test(v) ? v.toUpperCase() : null
}
