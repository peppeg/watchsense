#!/usr/bin/env node
/**
 * WatchSense — demo database seeder (for README screenshots and local demos).
 *
 * Creates a NEW database with fictional data only: ~30 well-known TV series with a
 * plausible viewing history over the last two years on several platforms, a few
 * 👍/👎, a few saved series and one recommendation batch with hand-written reasons
 * (the "For you" page is populated without calling any LLM). No credentials, no
 * cookies, no LLM settings are stored.
 *
 * The schema comes from the app's own migrations (server/utils/db.ts) and TMDB
 * metadata from the app's enrichment code (server/utils/sync-helpers.ts), loaded
 * with jiti (shipped with Nuxt).
 *
 * Usage (from ui/):
 *   TMDB_API_KEY=... node scripts/seed-demo.mjs [--locale en|it] [path/to/demo.db]
 *   # or DEMO_DATABASE_PATH=/tmp/ws-demo/watchsense.db TMDB_API_KEY=... node scripts/seed-demo.mjs
 *
 * --locale (default `en`) sets the demo language: `en` → app in English, TMDB `en-US`,
 * region `US`; `it` → app in Italian, TMDB `it-IT`, region `IT`. Titles, overviews,
 * episode names and genres come from TMDB in that language; recommendation reasons and
 * the taste summary are hand-written in both languages.
 *
 * Default path: <os tmpdir>/watchsense-demo/watchsense.db. The script refuses to
 * write to the project's data/watchsense.db and to overwrite an existing database
 * that it did not create itself (marker `config.demo_database`); an existing demo
 * database is replaced.
 *
 * Then start the app on it, e.g.:
 *   DATABASE_PATH=/tmp/watchsense-demo/watchsense.db TMDB_API_KEY=... \
 *   HOST=127.0.0.1 PORT=4400 node .output/server/index.mjs
 *
 * History dates are relative to the day the script runs; the data is otherwise
 * deterministic (fixed pseudo-random seed).
 */
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(here, '..', '..')
const DEMO_MARKER = 'demo_database'

// ── Series: TMDB tv id, platform, start (days ago), episodes to watch (null = all), pace, feedback ──
// pace = average days between viewing sessions; per session 1–3 episodes.
const SERIES = [
  { id: 1396, platform: 'netflix', start: 720, episodes: null, pace: 2, feedback: 1 },     // Breaking Bad
  { id: 60059, platform: 'netflix', start: 650, episodes: null, pace: 3, feedback: 1 },    // Better Call Saul
  { id: 66732, platform: 'netflix', start: 600, episodes: null, pace: 2, feedback: 0 },    // Stranger Things
  { id: 70523, platform: 'netflix', start: 560, episodes: null, pace: 2, feedback: 1 },    // Dark
  { id: 65494, platform: 'netflix', start: 520, episodes: 28, pace: 4, feedback: 0 },      // The Crown
  { id: 71446, platform: 'netflix', start: 480, episodes: null, pace: 2, feedback: 0 },    // La casa di carta
  { id: 71912, platform: 'netflix', start: 300, episodes: 5, pace: 6, feedback: -1 },      // The Witcher
  { id: 60574, platform: 'netflix', start: 440, episodes: null, pace: 3, feedback: 1 },    // Peaky Blinders
  { id: 87739, platform: 'netflix', start: 400, episodes: null, pace: 1, feedback: 1 },    // La regina degli scacchi
  { id: 67744, platform: 'netflix', start: 360, episodes: null, pace: 2, feedback: 0 },    // Mindhunter
  { id: 119051, platform: 'netflix', start: 250, episodes: null, pace: 2, feedback: 0 },   // Mercoledì
  { id: 42009, platform: 'netflix', start: 200, episodes: 14, pace: 7, feedback: 0 },      // Black Mirror
  { id: 96677, platform: 'netflix', start: 140, episodes: null, pace: 2, feedback: 0 },    // Lupin
  { id: 76479, platform: 'prime', start: 540, episodes: null, pace: 3, feedback: 1 },      // The Boys
  { id: 67070, platform: 'prime', start: 330, episodes: null, pace: 1, feedback: 1 },      // Fleabag
  { id: 82856, platform: 'disney', start: 460, episodes: null, pace: 4, feedback: 0 },     // The Mandalorian
  { id: 83867, platform: 'disney', start: 280, episodes: null, pace: 3, feedback: 1 },     // Andor
  { id: 84958, platform: 'disney', start: 380, episodes: 6, pace: 5, feedback: 0 },        // Loki
  { id: 136315, platform: 'disney', start: 120, episodes: 19, pace: 2, feedback: 1 },      // The Bear
  { id: 126308, platform: 'disney', start: 90, episodes: null, pace: 3, feedback: 1 },     // Shōgun
  { id: 87108, platform: 'nowtv', start: 690, episodes: null, pace: 1, feedback: 1 },      // Chernobyl
  { id: 76331, platform: 'nowtv', start: 620, episodes: null, pace: 3, feedback: 1 },      // Succession
  { id: 1399, platform: 'nowtv', start: 500, episodes: 46, pace: 3, feedback: 0 },         // Il Trono di Spade
  { id: 100088, platform: 'nowtv', start: 230, episodes: null, pace: 3, feedback: 0 },     // The Last of Us
  { id: 94997, platform: 'nowtv', start: 170, episodes: 10, pace: 7, feedback: -1 },       // House of the Dragon
  { id: 111803, platform: 'nowtv', start: 60, episodes: 9, pace: 3, feedback: 0 },         // The White Lotus
  { id: 61068, platform: 'nowtv', start: 420, episodes: 24, pace: 4, feedback: 0 },        // Gomorra
  { id: 97546, platform: 'appletv', start: 350, episodes: null, pace: 3, feedback: 1 },    // Ted Lasso
  { id: 95396, platform: 'appletv', start: 75, episodes: 14, pace: 3, feedback: 1 },       // Scissione
  { id: 95480, platform: 'appletv', start: 45, episodes: 16, pace: 2, feedback: 1 },       // Slow Horses
]

// One recommendation batch (hand-written, no LLM): series not in the history above.
// `reason` is Italian, `reasonEn` English.
const RECOMMENDATIONS = [
  { id: 60622, score: 0.96, where: 'Netflix', reasonEn: 'Absurd crimes in small-town America, pitch-black humour and a stellar cast every season: if you liked Breaking Bad and Better Call Saul, you will find the same taste for characters sinking deeper and deeper.', reason: 'Crimini assurdi nella provincia americana, humour nerissimo e cast stellare a ogni stagione: se ti sono piaciuti Breaking Bad e Better Call Saul, qui trovi lo stesso gusto per i personaggi che sprofondano.' },
  { id: 66980, reasonEn: '1920s Berlin between cabarets, corrupt police and political unrest: a blockbuster-scale period drama with the same dark mood you loved in Peaky Blinders and Dark.', score: 0.94, where: 'NOW', reason: 'La Berlino degli anni Venti tra cabaret, polizia corrotta e tensioni politiche: ricostruzione storica da kolossal e la stessa atmosfera cupa che hai amato in Peaky Blinders e Dark.' },
  { id: 19885, reasonEn: 'Brilliant investigations in modern London and a sharp, prickly genius at the centre: feature-length episodes with the pace and British wit you enjoyed in Slow Horses and Fleabag.', score: 0.92, where: 'Disney+', reason: 'Indagini brillanti in una Londra moderna e un protagonista geniale e spigoloso: episodi lunghi come film, con il ritmo e l\'ironia britannica che hai apprezzato in Slow Horses e Fleabag.' },
  { id: 63639, reasonEn: 'Hard science fiction with interplanetary politics and believable characters: it has the ambition of Andor and the same tight pace, without losing the human tension.', score: 0.9, where: 'Prime Video', reason: 'Fantascienza "dura" con politica interplanetaria e personaggi credibili: ha l\'ambizione di Andor e lo stesso ritmo serrato, senza perdere di vista la tensione umana.' },
  { id: 115004, reasonEn: 'A superbly written small-town mystery and an outstanding Kate Winslet: intimate drama and investigation woven together with the attention to detail of Chernobyl and The White Lotus.', score: 0.89, where: 'HBO Max', reason: 'Un giallo di provincia scritto benissimo e una Kate Winslet straordinaria: dramma intimo e indagine si intrecciano con la cura per i dettagli di Chernobyl e The White Lotus.' },
  { id: 63351, reasonEn: 'The rise and fall of Pablo Escobar told as a thriller: organised crime, power and corruption, in the wake of Gomorrah and Money Heist.', score: 0.87, where: 'Netflix', reason: 'L\'ascesa e la caduta di Pablo Escobar raccontate come un thriller: crimine organizzato, potere e corruzione, nella scia di Gomorra e La casa di carta.' },
]

// Saved series ("Saved"), outside the batch.
const BOOKMARKS = [
  { id: 1438, where: 'HBO Max' },   // The Wire
  { id: 4613, where: 'Prime Video' },   // Band of Brothers
  { id: 1920, where: 'Paramount+' }, // Twin Peaks
]

// Per-locale settings and the few hand-written texts that are not recommendation reasons.
const LOCALES = {
  en: {
    appLocale: 'en', tmdbLanguage: 'en-US', tmdbRegion: 'US',
    episode: (season, n, name) => `Season ${season}: ${name || `Episode ${n}`}`,
    savedFallback: 'Saved from the show page',
    tasteSummary: 'You love tightly written crime and prestige drama with morally grey characters (Breaking Bad, Succession, Peaky Blinders), British humour and spy stories, and smart, grounded science fiction. Big fantasy sagas leave you cold.',
  },
  it: {
    appLocale: 'it', tmdbLanguage: 'it-IT', tmdbRegion: 'IT',
    episode: (season, n, name) => `Stagione ${season}: ${name || `Episodio ${n}`}`,
    savedFallback: 'Salvata dalla scheda serie',
    tasteSummary: 'Ami il crime e i drammi di qualità scritti con cura, con personaggi moralmente ambigui (Breaking Bad, Succession, Peaky Blinders), l\'umorismo britannico, le spy story e la fantascienza intelligente e concreta. Le grandi saghe fantasy ti lasciano freddo.',
  },
}

// ── Helpers ──

function fail(msg) {
  console.error(`seed-demo: ${msg}`)
  process.exit(1)
}

// Deterministic PRNG (mulberry32)
let seed = 20240917
function rand() {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1))

function isoDay(date) {
  return date.toISOString().slice(0, 10)
}

async function tmdb(path, key) {
  const url = new URL(`https://api.themoviedb.org/3${path}`)
  url.searchParams.set('api_key', key)
  url.searchParams.set('language', L.tmdbLanguage)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`TMDB ${path}: HTTP ${res.status}`)
  return res.json()
}

// Episodes in airing order (regular seasons only, aired episodes only).
async function listEpisodes(details, key) {
  const today = isoDay(new Date())
  const episodes = []
  for (const season of details.seasons || []) {
    if (!season.season_number) continue // skip "Specials"
    const data = await tmdb(`/tv/${details.id}/season/${season.season_number}`, key)
    for (const ep of data.episodes || []) {
      if (ep.air_date && ep.air_date > today) continue
      episodes.push(L.episode(season.season_number, ep.episode_number, ep.name?.trim()))
    }
  }
  return episodes
}

// ── Main ──

// Arguments: [--locale en|it] [path]
const args = process.argv.slice(2)
let localeArg = 'en'
const positional = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--locale') localeArg = args[++i]
  else if (args[i].startsWith('--locale=')) localeArg = args[i].slice('--locale='.length)
  else positional.push(args[i])
}
const L = LOCALES[localeArg]
if (!L) fail(`unsupported --locale ${localeArg} (use en or it)`)

const key = process.env.TMDB_API_KEY?.trim()
if (!key) fail('TMDB_API_KEY is required (posters and metadata come from TMDB).')

const target = resolve(positional[0] || process.env.DEMO_DATABASE_PATH || join(tmpdir(), 'watchsense-demo', 'watchsense.db'))
if (target === resolve(projectRoot, 'data', 'watchsense.db')) {
  fail(`refusing to write to the project database ${target}`)
}

const jiti = createJiti(import.meta.url)

if (existsSync(target)) {
  const { default: Database } = await jiti.import('better-sqlite3')
  let isDemo = false
  try {
    const db = new Database(target, { readonly: true, fileMustExist: true })
    try {
      isDemo = !!db.prepare('SELECT value FROM config WHERE key = ?').get(DEMO_MARKER)
    } finally {
      db.close()
    }
  } catch {
    isDemo = false
  }
  if (!isDemo) fail(`${target} exists and is not a demo database: refusing to overwrite it`)
  for (const suffix of ['', '-wal', '-shm']) rmSync(target + suffix, { force: true })
  console.log(`Replacing existing demo database ${target}`)
}
mkdirSync(dirname(target), { recursive: true })

// The app's own modules: getDb() applies all migrations to the new file.
process.env.DATABASE_PATH = target
process.env.SCHEMA_PATH ||= join(projectRoot, 'db', 'schema.sql')
const { getDb } = await jiti.import(join(here, '..', 'server', 'utils', 'db.ts'))
const { fetchTmdbEnrichment, applyTmdbEnrichment } = await jiti.import(join(here, '..', 'server', 'utils', 'sync-helpers.ts'))

const db = getDb()
const setConfig = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
setConfig.run(DEMO_MARKER, '1')
// Language and region before any TMDB enrichment (the app's helpers read them from config)
setConfig.run('app_locale', L.appLocale)
setConfig.run('tmdb_language', L.tmdbLanguage)
setConfig.run('tmdb_region', L.tmdbRegion)

const insertView = db.prepare(`
  INSERT OR IGNORE INTO shows (title, platform, watched_at, episode_title, tmdb_id, media_type)
  VALUES (?, ?, ?, ?, ?, 'tv')
`)
const insertFeedback = db.prepare(`
  INSERT OR REPLACE INTO show_feedback (tmdb_id, media_type, feedback) VALUES (?, 'tv', ?)
`)

const now = new Date()
const lastDay = new Date(now.getTime() - 86400000) // history ends yesterday
const liked = []
const disliked = []
let totalViews = 0

for (const s of SERIES) {
  const details = await tmdb(`/tv/${s.id}`, key)
  const enrichment = await fetchTmdbEnrichment(s.id, 'tv')
  if (!enrichment) fail(`TMDB enrichment failed for tv/${s.id}`)
  const title = details.name
  const all = await listEpisodes(details, key)
  const episodes = s.episodes == null ? all : all.slice(0, s.episodes)

  // Sessions of 1–3 episodes every ~pace days, starting `start` days ago, never after yesterday.
  let day = new Date(now.getTime() - s.start * 86400000)
  let i = 0
  const rows = []
  while (i < episodes.length && day <= lastDay) {
    const perSession = randInt(1, 3)
    for (let k = 0; k < perSession && i < episodes.length; k++, i++) {
      rows.push([title, s.platform, isoDay(day), episodes[i], s.id])
    }
    day = new Date(day.getTime() + randInt(Math.max(1, s.pace - 1), s.pace + 2) * 86400000)
  }
  db.transaction(() => { for (const r of rows) insertView.run(...r) })()
  applyTmdbEnrichment(enrichment, s.id, 'tv', s.platform)
  totalViews += rows.length

  if (s.feedback) {
    insertFeedback.run(s.id, s.feedback)
    ;(s.feedback > 0 ? liked : disliked).push(title)
  }
  console.log(`  ${title} [${s.platform}] ${rows.length}/${all.length} episodes`)
}

// Taste snapshot stored with the batch, same shape as /api/generate.
const genreCounts = {}
for (const row of db.prepare("SELECT tmdb_genres FROM shows WHERE tmdb_genres IS NOT NULL").all()) {
  for (const g of JSON.parse(row.tmdb_genres)) genreCounts[g] = (genreCounts[g] || 0) + 1
}
const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
  .map(([name, count]) => ({ name, weight: Math.round(count / 10) / 10, liked: 0, disliked: 0, neutral: 0 }))
const tasteSnapshot = JSON.stringify({ topGenres, avoidGenres: [], likedShows: liked, dislikedShows: disliked, feedbackCount: liked.length + disliked.length })

const batchAt = new Date(now.getTime() - 2 * 86400000).toISOString().replace('T', ' ').slice(0, 19)
const batchId = db.prepare(`
  INSERT INTO recommendation_batches (created_at, genre_filter, taste_snapshot, prompt_snapshot)
  VALUES (?, NULL, ?, ?)
`).run(batchAt, tasteSnapshot, '(demo data: recommendations written by hand, no LLM call)').lastInsertRowid

const insertRec = db.prepare(`
  INSERT INTO recommendations (title, tmdb_id, media_type, reason, where_to_watch, score, poster_path, batch_id, bookmarked, created_at)
  VALUES (?, ?, 'tv', ?, ?, ?, ?, ?, ?, ?)
`)
for (const r of RECOMMENDATIONS) {
  const d = await tmdb(`/tv/${r.id}`, key)
  insertRec.run(d.name, r.id, L.appLocale === 'it' ? r.reason : r.reasonEn, r.where, r.score, d.poster_path || null, batchId, 0, batchAt)
  console.log(`  recommendation: ${d.name}`)
}
const savedAt = new Date(now.getTime() - 20 * 86400000).toISOString().replace('T', ' ').slice(0, 19)
for (const b of BOOKMARKS) {
  const d = await tmdb(`/tv/${b.id}`, key)
  insertRec.run(d.name, b.id, d.overview || L.savedFallback, b.where, null, d.poster_path || null, null, 1, savedAt)
  console.log(`  bookmark: ${d.name}`)
}

// Taste summary (Settings → Taste profile), hand-written instead of an LLM call
setConfig.run('taste_ai_summary', L.tasteSummary)
setConfig.run('taste_ai_summary_updated_at', new Date(now.getTime() - 2 * 86400000).toISOString())

db.pragma('wal_checkpoint(TRUNCATE)')
db.close()
console.log(`Demo database ready (${localeArg}): ${target} (${SERIES.length} series, ${totalViews} views, ${liked.length} 👍, ${disliked.length} 👎)`)
