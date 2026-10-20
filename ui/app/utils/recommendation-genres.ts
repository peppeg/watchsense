import type { MessageKey } from '../locales/i18n'

/**
 * Generi del filtro di "Per te": `value` è il nome canonico (inglese) che si manda a
 * POST /api/generate, `label` la chiave del nome mostrato. I nomi italiani coincidono con
 * quelli di server/utils/genres.ts (lo controlla tests/genres.test.ts).
 */
export const RECOMMENDATION_GENRES: Array<{ value: string, label: MessageKey }> = [
  { value: 'Crime', label: 'recommendations.genres.crime' },
  { value: 'Drama', label: 'recommendations.genres.drama' },
  { value: 'Comedy', label: 'recommendations.genres.comedy' },
  { value: 'Sci-Fi & Fantasy', label: 'recommendations.genres.sciFiFantasy' },
  { value: 'Mystery', label: 'recommendations.genres.mystery' },
  { value: 'Action & Adventure', label: 'recommendations.genres.actionAdventure' },
  { value: 'Thriller', label: 'recommendations.genres.thriller' },
  { value: 'Horror', label: 'recommendations.genres.horror' },
  { value: 'Romance', label: 'recommendations.genres.romance' },
  { value: 'Animation', label: 'recommendations.genres.animation' },
]
