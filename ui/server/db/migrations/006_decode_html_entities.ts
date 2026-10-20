import type Database from 'better-sqlite3'
import type { Migration } from '../migrate'
import { decodeHtmlEntities, hasHtmlEntity } from '../../utils/ingest-normalize'

// v6 — entità HTML nei titoli. Solo dati, nessuna chiamata TMDB.
//
// Gli import Prime (CSV e bookmarklet) hanno salvato titoli come "Agatha Christie&#39;s
// Poirot": ora cleanTitle e la pipeline degli import decodificano le entità (numeriche e
// &amp; &quot; &apos; &lt; &gt; &nbsp;, un solo passaggio). Qui si decodificano title,
// episode_title e tmdb_name delle righe di `shows` già salvate (tutte le piattaforme e
// tipi), così un reimport produce la stessa chiave UNIQUE(title, platform, watched_at,
// episode_title).
//
// - Si toccano solo le righe con '&' seguito da un'entità riconosciuta.
// - tmdb_id e metadati restano come sono; una riga senza id resta senza id (si riabbina
//   dalle Impostazioni o a mano dalla Libreria).
// - Se la chiave decodificata coincide con quella di un'altra riga è la stessa visione: si
//   tiene la riga più vecchia (id minore) e si elimina l'altra, dopo averne copiato
//   l'abbinamento TMDB sulla superstite se questa non ne ha uno (come la v5).
//
// Idempotente: una seconda esecuzione non trova entità da decodificare (salvo testi che
// dopo la decodifica contengono ancora un'entità, es. "&amp;amp;": per scelta si decodifica
// un livello per esecuzione, come gli import).

const TMDB_COLUMNS = [
  'tmdb_id', 'media_type', 'tmdb_name', 'tmdb_genres', 'tmdb_overview', 'tmdb_keywords',
  'tmdb_networks', 'tmdb_watch_providers', 'tmdb_vote_avg', 'tmdb_status', 'enriched_at',
  'poster_path', 'backdrop_path', 'tmdb_number_of_episodes', 'tmdb_number_of_seasons',
  'tmdb_first_air_date',
]

interface EntityRow {
  id: number
  title: string
  platform: string
  watched_at: string | null
  episode_title: string | null
  tmdb_id: number | null
  tmdb_name: string | null
}

export interface DecodeStats {
  /** Righe con title/episode_title/tmdb_name cambiati (comprese quelle che hanno assorbito un duplicato). */
  updated: number
  /** Righe eliminate perché, decodificate, duplicavano una visione già presente. */
  duplicatesDeleted: number
  /** Abbinamenti TMDB copiati da una riga eliminata alla superstite. */
  linksCopied: number
}

export function decodeShowEntities(db: Database.Database): DecodeStats {
  const stats: DecodeStats = { updated: 0, duplicatesDeleted: 0, linksCopied: 0 }
  const copyLink = db.prepare(`
    UPDATE shows SET ${TMDB_COLUMNS.map(c => `${c} = (SELECT ${c} FROM shows WHERE id = @from)`).join(', ')}
    WHERE id = @to AND tmdb_id IS NULL
  `)
  const findKey = db.prepare(`
    SELECT id, tmdb_id FROM shows
    WHERE title = ? AND platform = ? AND watched_at = ? AND episode_title = ? AND id != ?
  `)
  const del = db.prepare('DELETE FROM shows WHERE id = ?')
  const updateKey = db.prepare('UPDATE shows SET title = ?, episode_title = ? WHERE id = ?')
  const updateName = db.prepare('UPDATE shows SET tmdb_name = ? WHERE id = ?')
  const touched = new Set<number>()

  // ── 1. Chiave (title, episode_title) ──────────────────────────────────
  // Prefiltro SQL largo ('&' … ';'), poi la regex delle entità in JS
  const rows = (db.prepare(`
    SELECT id, title, platform, watched_at, episode_title, tmdb_id, tmdb_name FROM shows
    WHERE title LIKE '%&%;%' OR episode_title LIKE '%&%;%'
    ORDER BY id
  `).all() as EntityRow[]).filter(r => hasHtmlEntity(r.title) || hasHtmlEntity(r.episode_title))

  const deleted = new Set<number>()
  for (const row of rows) {
    if (deleted.has(row.id)) continue
    const title = decodeHtmlEntities(row.title)
    const episodeTitle = row.episode_title == null ? null : decodeHtmlEntities(row.episode_title)

    // Con NULL nella chiave il vincolo UNIQUE non scatta (e la v5 non le considera duplicate)
    const twin = row.watched_at != null && episodeTitle != null
      ? findKey.get(title, row.platform, row.watched_at, episodeTitle, row.id) as { id: number; tmdb_id: number | null } | undefined
      : undefined
    if (twin && twin.id < row.id) {
      // La riga esistente è più vecchia: si tiene quella
      if (!twin.tmdb_id && row.tmdb_id) stats.linksCopied += copyLink.run({ from: row.id, to: twin.id }).changes
      del.run(row.id)
      deleted.add(row.id)
      stats.duplicatesDeleted++
      continue
    }
    if (twin) {
      // La riga decodificata è più vecchia: si elimina la gemella più recente
      if (!row.tmdb_id && twin.tmdb_id) stats.linksCopied += copyLink.run({ from: twin.id, to: row.id }).changes
      del.run(twin.id)
      deleted.add(twin.id)
      stats.duplicatesDeleted++
    }
    updateKey.run(title, episodeTitle, row.id)
    touched.add(row.id)
  }

  // ── 2. tmdb_name (dopo le copie di abbinamento del passo 1) ──────────────
  const names = (db.prepare("SELECT id, tmdb_name FROM shows WHERE tmdb_name LIKE '%&%;%'").all() as
    { id: number; tmdb_name: string }[]).filter(r => hasHtmlEntity(r.tmdb_name))
  for (const row of names) {
    updateName.run(decodeHtmlEntities(row.tmdb_name), row.id)
    touched.add(row.id)
  }
  stats.updated = touched.size
  return stats
}

export const decodeHtmlEntitiesMigration: Migration = {
  version: 6,
  name: 'decode_html_entities',
  up(db) {
    const s = decodeShowEntities(db)
    if (s.updated || s.duplicatesDeleted) {
      console.log(`[db] decode_html_entities: ${s.updated} row(s) decoded, ${s.duplicatesDeleted} duplicate(s) of an existing row removed`)
    }
    if (s.linksCopied) console.log(`[db] decode_html_entities: ${s.linksCopied} TMDB link(s) kept from removed duplicates`)
  },
}
