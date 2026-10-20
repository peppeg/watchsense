/**
 * Sezioni della Home, nell'ordine in cui compaiono: prima la parte personale (serie del
 * giorno, consigli, profilo gusti), poi le classifiche. L'utente può nasconderle dalle
 * Impostazioni (config `home_hidden_sections`: elenco delle chiavi nascoste, così una
 * sezione aggiunta in futuro compare di default).
 */
import { getDb } from './db'
import { getLocaleConfig } from './locale'

export interface HomeSection {
  /** Chiave della sezione; il nome mostrato è nel dizionario della UI (home.sections.<key>). */
  key: string
  /** Classifica TMDB: partecipa alla deduplica tra file. */
  chart: boolean
}

export const HOME_SECTIONS: HomeSection[] = [
  { key: 'hero', chart: false },
  { key: 'recommendations', chart: false },
  { key: 'taste', chart: false },
  { key: 'trending', chart: true },
  { key: 'netflix', chart: true },
  { key: 'prime', chart: true },
  { key: 'max', chart: true },
  { key: 'disney', chart: true },
  { key: 'paramount', chart: true },
  { key: 'appletv', chart: true },
  { key: 'nowtv', chart: true },
  { key: 'trakt', chart: false },
]

const HIDDEN_KEY = 'home_hidden_sections'
const KNOWN = new Set(HOME_SECTIONS.map(s => s.key))

/**
 * Classifiche delle piattaforme per regione TMDB (ADR-001 §3): tabella statica, nessuna
 * scoperta dinamica dei provider. Verificata su /watch/providers/tv?watch_region=XX e
 * /discover/tv (ottobre 2026). Lo stesso servizio può avere id diversi per regione
 * (Prime Video: 119 in IT/FR/ES…, 9 in US/GB/DE/JP; Paramount+: 531, 2303 in US).
 * Una regione non in tabella ha solo i servizi presenti ovunque (Netflix, Disney+, Apple TV+).
 *
 * HBO / Max si legge dai network (HBO 49 | Max Originals 3186), che non dipendono dalla
 * regione: la fila compare solo dove HBO Max è distribuito (provider 1899 su TMDB), così
 * non si propongono serie che nella regione non si possono vedere in streaming.
 */
export type ChartSource =
  | { kind: 'trending' }
  | { kind: 'provider'; providerId: number; platform: string }
  | { kind: 'network'; networkIds: string; platform: string }

const NETFLIX = 8
const DISNEY = 337
const APPLE_TV = 350
const PRIME = 119
const PRIME_9 = 9
const PARAMOUNT = 531
const PARAMOUNT_US = 2303
const NOW = 39
const HBO_MAX_NETWORKS = '49|3186'

/** id del provider per regione; `max`: HBO Max distribuito; `disney: false`: eccezione (India). */
interface RegionCharts {
  prime?: number
  paramount?: number
  nowtv?: number
  max?: boolean
  disney?: boolean
}

const REGION_CHARTS: Record<string, RegionCharts> = {
  IT: { prime: PRIME, paramount: PARAMOUNT, nowtv: NOW, max: true },
  US: { prime: PRIME_9, paramount: PARAMOUNT_US, max: true },
  GB: { prime: PRIME_9, paramount: PARAMOUNT, nowtv: NOW, max: true },
  DE: { prime: PRIME_9, paramount: PARAMOUNT, max: true },
  FR: { prime: PRIME, paramount: PARAMOUNT, max: true },
  ES: { prime: PRIME, max: true },
  NL: { prime: PRIME, max: true },
  SE: { prime: PRIME, max: true },
  PL: { prime: PRIME, max: true },
  AU: { prime: PRIME, paramount: PARAMOUNT, max: true },
  BR: { prime: PRIME, paramount: PARAMOUNT, max: true },
  MX: { prime: PRIME, paramount: PARAMOUNT, max: true },
  CA: { prime: PRIME, paramount: PARAMOUNT },
  JP: { prime: PRIME_9 },
  IN: { prime: PRIME, disney: false },
}

/** Regioni con le classifiche verificate in tabella (le propone la scelta della regione). */
export const CHART_REGIONS = Object.keys(REGION_CHARTS)

/** Fonti delle classifiche disponibili nella regione, per chiave di sezione. */
export function chartSources(region: string): Map<string, ChartSource> {
  const r = REGION_CHARTS[region] ?? {}
  const out = new Map<string, ChartSource>()
  out.set('trending', { kind: 'trending' })
  out.set('netflix', { kind: 'provider', providerId: NETFLIX, platform: 'netflix' })
  if (r.prime) out.set('prime', { kind: 'provider', providerId: r.prime, platform: 'prime' })
  if (r.max) out.set('max', { kind: 'network', networkIds: HBO_MAX_NETWORKS, platform: 'max' })
  if (r.disney !== false) out.set('disney', { kind: 'provider', providerId: DISNEY, platform: 'disney' })
  if (r.paramount) out.set('paramount', { kind: 'provider', providerId: r.paramount, platform: 'paramount' })
  out.set('appletv', { kind: 'provider', providerId: APPLE_TV, platform: 'appletv' })
  if (r.nowtv) out.set('nowtv', { kind: 'provider', providerId: r.nowtv, platform: 'now' })
  return out
}

/** Sezioni della Home esistenti nella regione: le classifiche non disponibili non ci sono. */
export function homeSectionsForRegion(region: string): HomeSection[] {
  const charts = chartSources(region)
  return HOME_SECTIONS.filter(s => !s.chart || charts.has(s.key))
}

function currentRegion(): string {
  return getLocaleConfig().tmdbRegion
}

/** Chiavi nascoste valide (le sconosciute si ignorano). */
export function getHiddenHomeSections(): Set<string> {
  const row = getDb().prepare('SELECT value FROM config WHERE key = ?').get(HIDDEN_KEY) as { value: string } | undefined
  try {
    const list = JSON.parse(row?.value || '[]')
    return new Set(Array.isArray(list) ? list.filter((k: unknown) => typeof k === 'string' && KNOWN.has(k)) : [])
  } catch {
    return new Set()
  }
}

/**
 * Salva le sezioni nascoste; null se l'elenco non è valido. Le Impostazioni mostrano solo le
 * sezioni della regione attiva: quelle di altre regioni già nascoste restano nascoste.
 */
export function setHiddenHomeSections(value: unknown, region: string = currentRegion()): string[] | null {
  if (!Array.isArray(value) || value.some(k => typeof k !== 'string' || !KNOWN.has(k))) return null
  const available = new Set(homeSectionsForRegion(region).map(s => s.key))
  const previous = getHiddenHomeSections()
  const list = HOME_SECTIONS.map(s => s.key)
    .filter(k => value.includes(k) || (!available.has(k) && previous.has(k)))
  getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(HIDDEN_KEY, JSON.stringify(list))
  return list
}

/** Le sezioni della regione attiva con il loro stato, per le Impostazioni. */
export function getHomeLayout(region: string = currentRegion()): Array<HomeSection & { visible: boolean }> {
  const hidden = getHiddenHomeSections()
  return homeSectionsForRegion(region).map(s => ({ ...s, visible: !hidden.has(s.key) }))
}

/**
 * Ogni serie compare in una sola classifica: la prima, nell'ordine dato, che la contiene.
 * Le file vengono poi tagliate a `size` (le liste in ingresso possono essere più lunghe,
 * così chi perde un titolo si riempie con i successivi).
 */
export function dedupeChartRows<T extends { tmdb_id?: number | null; media_type?: string | null }>(
  rows: Array<[string, T[]]>,
  size: number,
): Record<string, T[]> {
  const seen = new Set<string>()
  const out: Record<string, T[]> = {}
  for (const [key, items] of rows) {
    const kept: T[] = []
    for (const item of items) {
      if (kept.length >= size) break
      const id = item.tmdb_id ? `${item.media_type || 'tv'}:${item.tmdb_id}` : null
      if (id && seen.has(id)) continue
      if (id) seen.add(id)
      kept.push(item)
    }
    out[key] = kept
  }
  return out
}
