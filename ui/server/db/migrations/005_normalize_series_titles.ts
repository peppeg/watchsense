import type Database from 'better-sqlite3'
import type { Migration } from '../migrate'
import { stripSeasonSuffix } from '../../utils/ingest-normalize'
import { normalizePrimeTitle, primeEpisodeNumbers } from '../../utils/prime-dedup'

// v5 — titoli delle serie e visioni Prime duplicate. Solo dati, nessuna chiamata TMDB.
//
// 1. Titoli: i profili Prime/bookmarklet di cleanTitle ora tolgono i marcatori di
//    stagione in altre lingue ("Naruto - Stage 1", "Misfits: Serie 3", "Mao S1",
//    "Grey's Anatomy - Staffel 9 [dt./OV]", …; vedi stripSeasonSuffix). Per quei profili
//    nuovo titolo = stripSeasonSuffix(vecchio titolo): si applica alle righe 'tv' già
//    salvate, così un reimport produce la stessa chiave UNIQUE. Escluse le fonti che
//    non usano quei profili (Netflix: pulizia propria; Stremio/Trakt: titolo TMDB/fonte)
//    e le righe manuali. tmdb_id e metadati restano come sono (un abbinamento corretto
//    non si perde; le righe senza id restano senza id e si possono riabbinare dalle
//    Impostazioni). Se il titolo nuovo collide con una riga esistente (stessa chiave
//    UNIQUE) è la stessa visione: si elimina la riga rinominata, dopo averne copiato
//    l'abbinamento TMDB sulla superstite se questa non ne ha uno.
//
// 2. Visioni Prime duplicate nello stesso giorno (regola di prime-dedup): stessa serie
//    (titolo normalizzato), stessi numeri di stagione ed episodio dichiarati
//    nell'episode_title. Nasce da un CSV Prime riscaricato in cui Amazon ha cambiato i
//    nomi degli episodi ("Episodio 5: Farma" → "Episodio 5: The Farm"). Si tiene la riga
//    più vecchia (id minore) e:
//    - se non ha un tmdb_id, riceve l'abbinamento (tmdb_id, media_type, metadati) della
//      prima duplicata che ce l'ha;
//    - riceve title ed episode_title della duplicata più recente (id maggiore): è la forma
//      che Amazon restituisce oggi, quindi un reimport la ritrova con la chiave esatta, e i
//      nomi sono quelli leggibili; si salta se la chiave UNIQUE è già occupata.
//
// Idempotente: una seconda esecuzione non trova titoli da cambiare né gruppi duplicati.
// Usa le funzioni di normalizzazione degli import (devono restare allineate alle chiavi
// prodotte dagli import, è il loro scopo).

const NON_CLEANED_PLATFORMS = "('netflix', 'stremio', 'trakt', 'manual')"

export const TMDB_COLUMNS = [
  'tmdb_id', 'media_type', 'tmdb_name', 'tmdb_genres', 'tmdb_overview', 'tmdb_keywords',
  'tmdb_networks', 'tmdb_watch_providers', 'tmdb_vote_avg', 'tmdb_status', 'enriched_at',
  'poster_path', 'backdrop_path', 'tmdb_number_of_episodes', 'tmdb_number_of_seasons',
  'tmdb_first_air_date',
]

/** Titolo che non nomina la serie: serie diverse si confonderebbero (vedi prime-dedup). */
const SEASON_ONLY_TITLE = /^(?:(?:stagione|season)\s*\d+)?$/i

interface ShowRow {
  id: number
  title: string
  platform: string
  watched_at: string | null
  episode_title: string | null
  tmdb_id: number | null
}

export interface NormalizeStats {
  renamed: number
  renameCollisions: number
  duplicateGroups: number
  duplicatesDeleted: number
  linksCopied: number
  namesCopied: number
}

export function normalizeSeriesTitles(db: Database.Database): NormalizeStats {
  const stats: NormalizeStats = {
    renamed: 0, renameCollisions: 0, duplicateGroups: 0, duplicatesDeleted: 0, linksCopied: 0, namesCopied: 0,
  }
  const copyLink = db.prepare(`
    UPDATE shows SET ${TMDB_COLUMNS.map(c => `${c} = (SELECT ${c} FROM shows WHERE id = @from)`).join(', ')}
    WHERE id = @to AND tmdb_id IS NULL
  `)
  const findKey = db.prepare(`
    SELECT id, tmdb_id FROM shows
    WHERE title = ? AND platform = ? AND watched_at = ? AND episode_title = ? AND id != ?
  `)
  const del = db.prepare('DELETE FROM shows WHERE id = ?')

  // ── 1. Titoli ─────────────────────────────────────────────────────────────
  const rows = db.prepare(`
    SELECT id, title, platform, watched_at, episode_title, tmdb_id FROM shows
    WHERE media_type = 'tv' AND is_manual = 0 AND platform NOT IN ${NON_CLEANED_PLATFORMS}
    ORDER BY id
  `).all() as ShowRow[]
  const rename = db.prepare('UPDATE shows SET title = ? WHERE id = ?')
  for (const row of rows) {
    const title = stripSeasonSuffix(row.title)
    if (!title || title === row.title) continue
    const twin = row.watched_at != null && row.episode_title != null
      ? findKey.get(title, row.platform, row.watched_at, row.episode_title, row.id) as { id: number; tmdb_id: number | null } | undefined
      : undefined
    if (twin) {
      if (!twin.tmdb_id && row.tmdb_id) stats.linksCopied += copyLink.run({ from: row.id, to: twin.id }).changes
      del.run(row.id)
      stats.renameCollisions++
      continue
    }
    rename.run(title, row.id)
    stats.renamed++
  }

  // ── 2. Visioni Prime duplicate nello stesso giorno ───────────────────────
  const prime = db.prepare(`
    SELECT id, title, platform, watched_at, episode_title, tmdb_id FROM shows
    WHERE platform = 'prime' AND media_type = 'tv' AND is_manual = 0 AND watched_at IS NOT NULL
    ORDER BY id
  `).all() as ShowRow[]
  const groups = new Map<string, ShowRow[]>()
  for (const row of prime) {
    const series = normalizePrimeTitle(row.title)
    if (SEASON_ONLY_TITLE.test(series)) continue
    const numbers = primeEpisodeNumbers(row.episode_title)
    if (!numbers) continue
    const key = `${row.watched_at}\u0000${series}\u0000${numbers.season}\u0000${numbers.episode}`
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }
  const rename2 = db.prepare('UPDATE shows SET title = ?, episode_title = ? WHERE id = ?')
  for (const group of groups.values()) {
    if (group.length < 2) continue
    stats.duplicateGroups++
    const [keep, ...dups] = group as [ShowRow, ...ShowRow[]]
    if (!keep.tmdb_id) {
      const donor = dups.find(d => d.tmdb_id)
      if (donor) stats.linksCopied += copyLink.run({ from: donor.id, to: keep.id }).changes
    }
    const newest = dups[dups.length - 1]!
    for (const d of dups) del.run(d.id)
    stats.duplicatesDeleted += dups.length
    if (newest.title !== keep.title || newest.episode_title !== keep.episode_title) {
      const taken = findKey.get(newest.title, keep.platform, keep.watched_at, newest.episode_title, keep.id)
      if (!taken) {
        rename2.run(newest.title, newest.episode_title, keep.id)
        stats.namesCopied++
      }
    }
  }
  return stats
}

export const normalizeSeriesTitlesMigration: Migration = {
  version: 5,
  name: 'normalize_series_titles',
  up(db) {
    const s = normalizeSeriesTitles(db)
    if (s.renamed || s.renameCollisions) {
      console.log(`[db] normalize_series_titles: ${s.renamed} series row(s) renamed, ${s.renameCollisions} duplicate(s) of an existing row removed`)
    }
    if (s.duplicateGroups) {
      console.log(`[db] normalize_series_titles: ${s.duplicatesDeleted} same-day Prime duplicate view(s) removed in ${s.duplicateGroups} group(s), ${s.namesCopied} episode name(s) updated`)
    }
    if (s.linksCopied) console.log(`[db] normalize_series_titles: ${s.linksCopied} TMDB link(s) kept from removed duplicates`)
  },
}
