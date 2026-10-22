/**
 * Safe parser for the Netflix "viewing activity" page.
 *
 * The page embeds its state as a JavaScript object literal:
 *   netflix.reactContext = {...};</script>
 * The literal is JSON-like but uses JS-only string escapes (mainly `\xNN`).
 * It is treated strictly as data: extracted by brace matching, its string
 * escapes are normalised to valid JSON, and it is parsed with JSON.parse.
 * No remote code is ever evaluated.
 */
import { userMessage, UserMessageError } from './user-message'

const MARKER = /netflix\.reactContext\s*=\s*/g

/** Returns the source of the object literal assigned to netflix.reactContext, or null. */
export function extractReactContextLiteral(html: string): string | null {
  MARKER.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MARKER.exec(html)) !== null) {
    const start = m.index + m[0].length
    if (html[start] !== '{') continue

    let depth = 0
    let quote: string | null = null
    for (let i = start; i < html.length; i++) {
      const ch = html[i]
      if (quote) {
        if (ch === '\\') { i++; continue }
        if (ch === quote) quote = null
        else if (ch === '\n' || ch === '\r') break // unterminated string: malformed
        continue
      }
      if (ch === '"' || ch === '\'') { quote = ch; continue }
      if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') {
        depth--
        if (depth === 0) return html.slice(start, i + 1)
        if (depth < 0) break
      }
    }
  }
  return null
}

function hex4(code: number): string {
  return '\\u' + code.toString(16).padStart(4, '0')
}

/**
 * Converts a JSON-like JS object literal into strict JSON by rewriting string
 * literals: JS-only escapes (\xNN, \', \v, \0, line continuations, identity
 * escapes) become JSON escapes; single-quoted strings become double-quoted.
 * Content outside strings is left untouched (JSON.parse rejects anything
 * that is not plain data, e.g. identifiers or function calls).
 */
export function jsLiteralToJson(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const ch = src[i]
    if (ch !== '"' && ch !== '\'') { out += ch; i++; continue }

    const quote = ch
    out += '"'
    i++
    let closed = false
    while (i < n) {
      const c = src[i]
      if (c === quote) { out += '"'; i++; closed = true; break }
      if (c === '"') { out += '\\"'; i++; continue } // only possible inside '...'
      if (c !== '\\') {
        const code = c.charCodeAt(0)
        out += code < 0x20 ? hex4(code) : c
        i++
        continue
      }

      const e = src[i + 1]
      if (e === undefined) throw new Error('unterminated escape')
      switch (e) {
        case '"': case '\\': case '/': case 'b': case 'f': case 'n': case 'r': case 't':
          out += '\\' + e; i += 2; break
        case 'u': {
          const hex = src.slice(i + 2, i + 6)
          if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += '\\u' + hex; i += 6; break }
          if (src[i + 2] === '{') {
            const close = src.indexOf('}', i + 3)
            const cp = close > 0 ? parseInt(src.slice(i + 3, close), 16) : NaN
            if (!Number.isFinite(cp) || cp > 0x10ffff) throw new Error('invalid \\u{} escape')
            out += JSON.stringify(String.fromCodePoint(cp)).slice(1, -1)
            i = close + 1
            break
          }
          throw new Error('invalid \\u escape')
        }
        case 'x': {
          const hex = src.slice(i + 2, i + 4)
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new Error('invalid \\x escape')
          out += '\\u00' + hex.toLowerCase()
          i += 4
          break
        }
        case '\'': out += '\''; i += 2; break
        case 'v': out += '\\u000b'; i += 2; break
        case '0':
          if (/[0-9]/.test(src[i + 2] || '')) throw new Error('octal escapes are not supported')
          out += '\\u0000'; i += 2; break
        case '\r':
          i += src[i + 2] === '\n' ? 3 : 2; break // line continuation
        case '\n': case ' ': case ' ':
          i += 2; break
        default:
          // identity escape (e.g. \- \&): keep the character itself
          if (/[0-9]/.test(e)) throw new Error('octal escapes are not supported')
          out += e.charCodeAt(0) < 0x20 ? hex4(e.charCodeAt(0)) : e
          i += 2
      }
    }
    if (!closed) throw new Error('unterminated string')
  }
  return out
}

/**
 * Extracts `models.vaModel.data.viewedItems` from the Netflix viewing activity HTML.
 * Throws a descriptive Error if the data cannot be found or parsed.
 */
export function parseNetflixViewingActivity(html: string): any[] {
  const literal = extractReactContextLiteral(html)
  if (!literal) {
    throw new UserMessageError(userMessage('sync.netflix.historyNotFound'))
  }

  let ctx: any
  try {
    ctx = JSON.parse(jsLiteralToJson(literal))
  } catch (err: any) {
    throw new UserMessageError(userMessage('sync.netflix.pageFormat', { detail: String(err?.message || 'parse failed') }))
  }

  const items = ctx?.models?.vaModel?.data?.viewedItems
  return Array.isArray(items) ? items : []
}

/**
 * Accept-Language per la pagina attività di Netflix dalla lingua TMDB.
 * `it-IT` dà l'intestazione storica; le altre la lingua scelta con l'inglese di riserva.
 */
export function netflixAcceptLanguage(tmdbLanguage: string): string {
  const [lang = 'en'] = tmdbLanguage.split('-')
  if (lang === 'en') return `${tmdbLanguage},en;q=0.9`
  return `${tmdbLanguage},${lang};q=0.9,en-US;q=0.8,en;q=0.7`
}

/**
 * Header Cookie dai cookie incollati nelle Impostazioni. Formati accettati:
 * - stringa header `NetflixId=…; SecureNetflixId=…` (anche "Header String" di Cookie-Editor,
 *   con tutti i cookie del sito: si inviano così come sono), eventualmente preceduta da `Cookie:`;
 * - JSON di Cookie-Editor (array di { name, value }) o oggetto { nome: valore };
 * - un cookie per riga (`nome=valore`, `nome: valore` o separato da tab, es. copiato da DevTools).
 */
export function netflixCookieHeader(raw: string): string {
  const cookieString = raw.trim().replace(/^cookie:\s*/i, '')
  if (cookieString.startsWith('{') || cookieString.startsWith('[')) {
    try {
      const parsed = JSON.parse(cookieString)
      if (Array.isArray(parsed)) {
        return parsed
          .filter((c: any) => c && c.name && c.value)
          .map((c: any) => `${c.name}=${c.value}`)
          .join('; ')
      }
      return Object.entries(parsed)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
    } catch {
      return cookieString
    }
  }
  if (cookieString.includes('\n')) {
    return cookieString
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.replace(/^([a-zA-Z0-9_\-\.]+)\s*[:=\t]\s*(.*)$/, '$1=$2'))
      .join('; ')
  }
  return cookieString
}
