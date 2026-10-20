import type Database from 'better-sqlite3'
import type { Migration } from '../migrate'
import { samePrimeView } from '../../utils/prime-dedup'
import { TMDB_COLUMNS } from './005_normalize_series_titles'

// v8 — visioni Prime duplicate rimaste dagli import precedenti alla deduplica attuale.
// Solo dati, nessuna chiamata TMDB.
//
// Le coppie sono quelle che la regola degli import (samePrimeView in utils/prime-dedup)
// riconosce come la stessa visione:
// - righe bookmarklet ("Episodio 3: nome") e CSV ("Serie - Stagione 1: Episodio 3: nome")
//   dello stesso giorno, salvate prima che esistesse la deduplica cross-fonte o quando una
//   delle due aveva ancora entità HTML nel nome (decodificate dalla v6);
// - righe bookmarklet e CSV con lo stesso nome dell'episodio ma numerate diversamente o
//   datate con un giorno di differenza (Battlestar Galactica: "Episodio 2: Six of One"
//   contro "Season 4: Episodio 4: Six of One").
// Le coppie Prime con stessi numeri di stagione/episodio nello stesso giorno (nomi in
// lingue diverse) le ha già unite la v5; se ne restano, le unisce anche questa.
//
// Per ogni gruppo resta una riga sola, in quest'ordine di preferenza: la riga del CSV
// (porta la stagione ed è la forma di un reimport del CSV; un reimport del bookmarklet la
// riconosce con la stessa regola), poi quella con un tmdb_id, poi la più vecchia. Se la
// superstite non ha un abbinamento TMDB riceve quello della duplicata eliminata.
// Righe manuali escluse. Idempotente: una seconda esecuzione non trova coppie.

interface PrimeRow {
  id: number
  title: string
  watched_at: string
  episode_title: string | null
  tmdb_id: number | null
}

export interface PrimeDedupeStats {
  duplicatesDeleted: number
  linksCopied: number
}

const BOOKMARKLET_EPISODE = /^(?:episodio|episode|épisode|folge)\s*\d{1,4}\s*:/iu

export function dedupePrimeViews(db: Database.Database): PrimeDedupeStats {
  const stats: PrimeDedupeStats = { duplicatesDeleted: 0, linksCopied: 0 }
  const rows = db.prepare(`
    SELECT id, title, watched_at, episode_title, tmdb_id FROM shows
    WHERE platform = 'prime' AND media_type = 'tv' AND is_manual = 0 AND watched_at IS NOT NULL
  `).all() as PrimeRow[]

  const isBookmarklet = (r: PrimeRow) => BOOKMARKLET_EPISODE.test((r.episode_title || '').trim())
  rows.sort((a, b) =>
    Number(isBookmarklet(a)) - Number(isBookmarklet(b))
    || Number(!a.tmdb_id) - Number(!b.tmdb_id)
    || a.id - b.id)

  const copyLink = db.prepare(`
    UPDATE shows SET ${TMDB_COLUMNS.map(c => `${c} = (SELECT ${c} FROM shows WHERE id = @from)`).join(', ')}
    WHERE id = @to AND tmdb_id IS NULL
  `)
  const del = db.prepare('DELETE FROM shows WHERE id = ?')

  const dayOf = (watchedAt: string) => Date.parse(watchedAt.slice(0, 10)) / 86_400_000
  const kept = new Map<number | string, PrimeRow[]>()
  const bucket = (r: PrimeRow): number | string => {
    const d = dayOf(r.watched_at)
    return Number.isNaN(d) ? r.watched_at : d
  }
  const view = (r: PrimeRow) => ({ title: r.title, watchedAt: r.watched_at, episodeTitle: r.episode_title })

  for (const row of rows) {
    const b = bucket(row)
    const near = typeof b === 'number'
      ? [b - 1, b, b + 1].flatMap(d => kept.get(d) ?? [])
      : kept.get(b) ?? []
    const keeper = near.find(k => samePrimeView(view(k), view(row)))
    if (!keeper) {
      const list = kept.get(b)
      if (list) list.push(row)
      else kept.set(b, [row])
      continue
    }
    if (!keeper.tmdb_id && row.tmdb_id) {
      stats.linksCopied += copyLink.run({ from: row.id, to: keeper.id }).changes
      keeper.tmdb_id = row.tmdb_id
    }
    del.run(row.id)
    stats.duplicatesDeleted++
  }
  return stats
}

export const dedupePrimeViewsMigration: Migration = {
  version: 8,
  name: 'dedupe_prime_views',
  up(db) {
    const s = dedupePrimeViews(db)
    if (s.duplicatesDeleted) {
      console.log(`[db] dedupe_prime_views: ${s.duplicatesDeleted} duplicate Prime view(s) removed, ${s.linksCopied} TMDB link(s) kept`)
    }
  },
}
