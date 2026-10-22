import { getDb } from '../utils/db'
import { getLocaleConfig } from '../utils/locale'
import { localizeGenre } from '../utils/genres'
import { computeTasteProfile, tasteTexts } from '../utils/taste-profile'

// GET: taste profile based on show feedback + viewing history
// (profilo calcolato in utils/taste-profile.ts; qui i generi passano nella lingua dell'app)
export default defineEventHandler(() => {
  const db = getDb()
  const { appLocale } = getLocaleConfig(db)
  const profile = computeTasteProfile(db)
  const localize = <T extends { name: string }>(g: T): T => ({ ...g, name: localizeGenre(g.name, appLocale) })

  return {
    profile: {
      ...profile,
      topGenres: profile.topGenres.map(localize),
      avoidGenres: profile.avoidGenres.map(localize),
      ...tasteTexts(db),
    },
  }
})
