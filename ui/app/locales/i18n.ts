/**
 * Nucleo dell'i18n (ADR-001 §2): traduzione, plurali, formattazione con Intl e messaggi
 * del server. Funzioni pure, senza Nuxt: le usano il composable useI18n, i test e il
 * server (che compone qui il testo italiano dei messaggi con codice, utils/user-message.ts).
 */
import { en } from './en'
import { it } from './it'

export const SUPPORTED_APP_LOCALES = ['en', 'it'] as const
export type AppLocale = typeof SUPPORTED_APP_LOCALES[number]
export const DEFAULT_APP_LOCALE: AppLocale = 'en'

/** Forme plurali di una voce: bastano per en e it (`count === 1` → one). */
export interface PluralForms {
  one: string
  other: string
}

type Dictionary = typeof en
/** Forma dei dizionari: quella di en.ts con valori stringa (it.ts deve averla identica). */
export type Messages = Dictionary

/**
 * Chiavi valide di `t()`, ricavate da en.ts: le foglie (`nav.home`) e le voci plurali
 * (`match.applied`, non `match.applied.one`). Una chiave sbagliata è un errore di tipo.
 */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends PluralForms
      ? K
      : `${K}.${Leaves<T[K]>}`
}[keyof T & string]
export type MessageKey = Leaves<Dictionary>

export type TranslateParams = Record<string, string | number>

export const dictionaries: Record<AppLocale, Messages> = { en, it }

/** `en` | `it` (maiuscole e spazi tollerati); null se non supportata. */
export function normalizeLocale(value: unknown): AppLocale | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  return (SUPPORTED_APP_LOCALES as readonly string[]).includes(v) ? v as AppLocale : null
}

function lookup(dict: unknown, key: string): unknown {
  let node: unknown = dict
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

function isPlural(value: unknown): value is PluralForms {
  return !!value && typeof value === 'object'
    && typeof (value as PluralForms).one === 'string' && typeof (value as PluralForms).other === 'string'
}

/** Sostituisce `{nome}` con i parametri; i segnaposto senza parametro restano come sono. */
export function interpolate(text: string, params?: TranslateParams): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]))
}

/**
 * Divide un testo già tradotto sui segnaposto rimasti (`{nome}` senza parametro): le parti
 * di testo restano stringhe, i segnaposto diventano `{ slot }`. Serve a mettere link,
 * `<code>` o `<strong>` dentro una frase senza v-html (componente I18nT).
 */
export function splitPlaceholders(text: string): Array<string | { slot: string }> {
  const out: Array<string | { slot: string }> = []
  let last = 0
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    out.push({ slot: m[1]! })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * Testo tradotto come espressione JavaScript, per il codice del bookmarklet: le parti di
 * testo diventano stringhe JSON, i segnaposto le espressioni di `exprs`
 * (`'Trovati {count} titoli'` + `{ count: 'items.length' }` → `"Trovati "+(items.length)+" titoli"`).
 */
export function bookmarkletJsText(text: string, exprs: Record<string, string> = {}): string {
  const parts = splitPlaceholders(text).map(part => typeof part === 'string'
    ? JSON.stringify(part)
    : exprs[part.slot] !== undefined ? `(${exprs[part.slot]})` : JSON.stringify(`{${part.slot}}`))
  return parts.length ? parts.join('+') : '""'
}

/** Testo di una voce già trovata: sceglie la forma plurale con `params.count`. */
function resolveEntry(entry: unknown, params?: TranslateParams): string | null {
  if (typeof entry === 'string') return interpolate(entry, params)
  if (isPlural(entry)) {
    return interpolate(Number(params?.count) === 1 ? entry.one : entry.other, params)
  }
  return null
}

/**
 * Traduce `key` nella lingua `locale`: chiave mancante in `it` → testo `en`; mancante anche
 * in `en` → la chiave stessa (con un avviso solo in sviluppo). Le chiavi arrivate dal server
 * non sono tipizzate: per quelle c'è `translateKey`.
 */
export function translate(locale: AppLocale, key: MessageKey, params?: TranslateParams): string {
  return translateKey(locale, key, params)
}

/** Come `translate`, con una chiave qualunque (codici dei messaggi del server). */
export function translateKey(locale: AppLocale, key: string, params?: TranslateParams): string {
  const text = resolveEntry(lookup(dictionaries[locale], key), params)
    ?? (locale !== DEFAULT_APP_LOCALE ? resolveEntry(lookup(dictionaries[DEFAULT_APP_LOCALE], key), params) : null)
  if (text !== null) return text
  if (import.meta.dev) console.warn(`[i18n] chiave mancante: ${key}`)
  return key
}

/** true se `key` esiste (stringa o plurale) almeno nel dizionario inglese. */
export function hasKey(key: string): boolean {
  return resolveEntry(lookup(dictionaries[DEFAULT_APP_LOCALE], key)) !== null
}

// ── Formattazione ──

/** Locale Intl predefinita di ogni lingua dell'app. */
const INTL_DEFAULTS: Record<AppLocale, string> = { en: 'en-US', it: 'it-IT' }

/**
 * Locale Intl per date e numeri: la lingua TMDB se è una variante della lingua dell'app
 * (`en` + `en-GB` → `en-GB`, giorno/mese e 24 ore), altrimenti la predefinita
 * (`en-US`, `it-IT`). Così la regione scelta per TMDB decide anche il formato.
 */
export function intlLocale(locale: AppLocale, tmdbLanguage?: string | null): string {
  if (tmdbLanguage && /^[a-z]{2}-[A-Z]{2}$/.test(tmdbLanguage) && tmdbLanguage.startsWith(`${locale}-`)) {
    return tmdbLanguage
  }
  return INTL_DEFAULTS[locale]
}

type DateInput = Date | string | number | null | undefined

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Data (senza ora); stringa vuota se assente o non valida. Default come toLocaleDateString. */
export function formatDateIn(intl: string, value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const d = toDate(value)
  return d ? d.toLocaleDateString(intl, options) : ''
}

/** Data e ora; stringa vuota se assente o non valida. Default come toLocaleString. */
export function formatDateTimeIn(intl: string, value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const d = toDate(value)
  return d ? d.toLocaleString(intl, options) : ''
}

/** Numero con i separatori della lingua; stringa vuota se non è un numero finito. */
export function formatNumberIn(intl: string, value: number | null | undefined, options?: Intl.NumberFormatOptions): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(intl, options) : ''
}

// ── Messaggi del server ──

export type ServerMessageParam = string | number | ServerMessagePart
export interface ServerMessagePart {
  code: string
  params?: Record<string, ServerMessageParam>
}

/**
 * Messaggio del server (esiti delle sync e degli import, errori): `code` + `params` da
 * tradurre, `message` è il testo italiano (unico campo dei messaggi salvati prima dei codici).
 * Un parametro può essere a sua volta un messaggio; `notes` sono frasi accodate.
 */
export interface ServerMessage {
  code?: string
  params?: Record<string, ServerMessageParam>
  notes?: ServerMessagePart[]
  message?: string
}

function renderPart(locale: AppLocale, part: ServerMessagePart): string {
  const params: TranslateParams = {}
  for (const [name, value] of Object.entries(part.params || {})) {
    params[name] = value && typeof value === 'object' ? renderPart(locale, value) : value
  }
  return translateKey(locale, part.code, params)
}

function isKnownPart(part: unknown): part is ServerMessagePart {
  if (!part || typeof part !== 'object') return false
  const { code, params } = part as ServerMessagePart
  if (typeof code !== 'string' || !hasKey(code)) return false
  return Object.values(params || {}).every(v => typeof v !== 'object' || isKnownPart(v))
}

/**
 * Testo di un messaggio del server nella lingua `locale`: dal codice se è noto (anche i
 * parametri annidati e le note), altrimenti `message` (esiti vecchi, codici sconosciuti).
 */
export function renderServerMessage(locale: AppLocale, msg: ServerMessage | null | undefined): string {
  if (!msg) return ''
  const notes = Array.isArray(msg.notes) ? msg.notes : []
  const fallback = msg.message ?? ''
  if (!isKnownPart(msg) || !notes.every(isKnownPart)) return fallback
  return renderPart(locale, msg) + notes.map(n => ` ${renderPart(locale, n)}`).join('')
}

/**
 * Messaggio di un errore di $fetch: il server mette il codice in `data` (createError) e il
 * testo italiano in `message`; senza testo dal server vale `fallback`, se c'è, altrimenti
 * il messaggio dell'errore (come i vecchi `err.data?.message || …`).
 */
export function fetchErrorMessage(err: any, fallback?: string): ServerMessage {
  const body = err?.data
  const data = body?.data && typeof body.data === 'object' ? body.data : {}
  return { ...data, message: body?.message || fallback || err?.message || '' }
}
