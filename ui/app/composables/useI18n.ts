/**
 * Lingua dell'app nella UI (ADR-001 §2). Lo stato è condiviso (useState) e arriva già
 * con l'SSR: lo carica plugins/i18n.ts da GET /api/locale prima del primo render.
 *
 *   const { t, locale, formatDateTime, translateServerMessage } = useI18n()
 *   t('nav.home')                       → 'Home'
 *   t('match.applied', { name, count }) → forma plurale scelta da count
 */
import {
  DEFAULT_APP_LOCALE,
  SUPPORTED_APP_LOCALES,
  fetchErrorMessage,
  formatDateIn,
  formatDateTimeIn,
  formatNumberIn,
  intlLocale,
  normalizeLocale,
  renderServerMessage,
  translate,
  type AppLocale,
  type MessageKey,
  type ServerMessage,
  type TranslateParams,
} from '~/locales/i18n'

type DateInput = Date | string | number | null | undefined

/** Stato condiviso della lingua (chiavi useState usate anche dal plugin). */
export function useLocaleState() {
  return {
    locale: useState<AppLocale>('ws-locale', () => DEFAULT_APP_LOCALE),
    // Lingua TMDB: sceglie la variante regionale dei formati (en-GB, en-US…)
    tmdbLanguage: useState<string | null>('ws-tmdb-language', () => null),
  }
}

export function useI18n() {
  const { locale, tmdbLanguage } = useLocaleState()
  const intl = computed(() => intlLocale(locale.value, tmdbLanguage.value))

  /** Testo della chiave nella lingua attiva (fallback en, poi la chiave). */
  const t = (key: MessageKey, params?: TranslateParams) => translate(locale.value, key, params)

  /** Cambia lingua nella UI (il salvataggio in config resta a chi chiama POST /api/config). */
  function setLocale(value: string) {
    const next = normalizeLocale(value)
    if (next) locale.value = next
  }

  /** Esito o errore del server: dal codice se noto, altrimenti il `message` italiano. */
  const translateServerMessage = (msg: ServerMessage | null | undefined) => renderServerMessage(locale.value, msg)

  /** Testo di un errore di $fetch (codice del server se noto, poi testo, poi `fallback`). */
  const serverErrorText = (err: unknown, fallback?: string) => translateServerMessage(fetchErrorMessage(err, fallback))

  return {
    locale: readonly(locale),
    availableLocales: SUPPORTED_APP_LOCALES,
    setLocale,
    t,
    translateServerMessage,
    serverErrorText,
    /** Locale Intl effettiva (es. 'it-IT', 'en-GB'). */
    intlLocale: intl,
    formatDate: (value: DateInput, options?: Intl.DateTimeFormatOptions) => formatDateIn(intl.value, value, options),
    formatDateTime: (value: DateInput, options?: Intl.DateTimeFormatOptions) => formatDateTimeIn(intl.value, value, options),
    formatNumber: (value: number | null | undefined, options?: Intl.NumberFormatOptions) => formatNumberIn(intl.value, value, options),
  }
}
