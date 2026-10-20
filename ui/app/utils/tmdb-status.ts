import { translate, type AppLocale, type MessageKey } from '../locales/i18n'

/** Stato TMDB di una serie → chiave del dizionario (il valore salvato resta quello TMDB). */
const TMDB_STATUS_KEYS: Record<string, MessageKey> = {
  'Returning Series': 'status.tmdb.returning',
  'Ended': 'status.tmdb.ended',
  'Canceled': 'status.tmdb.canceled',
  'Cancelled': 'status.tmdb.canceled',
  'In Production': 'status.tmdb.inProduction',
  'Planned': 'status.tmdb.planned',
  'Pilot': 'status.tmdb.pilot',
}

/** Stato TMDB tradotto nella lingua `locale`; gli stati sconosciuti restano come sono. */
export function tmdbStatusLabel(status: string | null | undefined, locale: AppLocale): string {
  if (!status) return ''
  const key = TMDB_STATUS_KEYS[status]
  return key ? translate(locale, key) : status
}
