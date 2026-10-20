import { normalizeLocale } from '~/locales/i18n'

// Lingua dell'app prima del primo render (ADR-001 §2): durante l'SSR si legge da
// GET /api/locale e lo stato (useState) arriva al client nel payload, quindi niente lampo
// di inglese per chi usa l'italiano. Senza SSR (navigazione client pura) la lettura avviene
// qui sul client, sempre prima del mount. Se la chiamata fallisce resta la lingua predefinita.
export default defineNuxtPlugin(async () => {
  const { locale, tmdbLanguage } = useLocaleState()
  const loaded = useState<boolean>('ws-locale-loaded', () => false)
  if (loaded.value) return
  try {
    const res = await useRequestFetch()('/api/locale')
    locale.value = normalizeLocale(res.app_locale) ?? locale.value
    tmdbLanguage.value = typeof res.tmdb_language === 'string' ? res.tmdb_language : null
  } catch {}
  loaded.value = true
})
