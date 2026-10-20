import { getLocaleConfig, SUPPORTED_LOCALES } from '../utils/locale'

// Lingua dell'app e lingua/regione TMDB effettive (DB → env → default), per la UI all'avvio
// (plugins/i18n.ts). Pubblica anche con l'autenticazione attiva: serve già alla schermata di
// login e non contiene nulla di riservato.
export default defineEventHandler(() => {
  const locale = getLocaleConfig()
  return {
    app_locale: locale.appLocale,
    tmdb_language: locale.tmdbLanguage,
    tmdb_region: locale.tmdbRegion,
    supported_locales: SUPPORTED_LOCALES,
  }
})
