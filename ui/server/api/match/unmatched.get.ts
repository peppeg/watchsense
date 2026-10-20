import { listUnmatchedSeries } from '../../utils/manual-match'

// Serie senza abbinamento TMDB (righe 'tv' con tmdb_id NULL), una per (title, platform):
// la Libreria le elenca per abbinarle a mano.
export default defineEventHandler(() => {
  const series = listUnmatchedSeries()
  return { series, total: series.length }
})
