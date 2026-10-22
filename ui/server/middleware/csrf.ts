// Protezione anti-CSRF per le API mutanti (/api/**, metodi diversi da GET/HEAD/OPTIONS):
// - se il browser invia Origin (o Referer), il suo host deve coincidere con quello della richiesta;
// - sono ammessi solo body JSON (multipart solo per l'upload CSV) o body vuoti.
// Richieste senza Origin/Referer (curl, $fetch interno dello scheduler) restano consentite.

import { isApiPath, normalizePath } from '../utils/request-path'
import { userError, userMessage } from '../utils/user-message'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
// Bookmarklet cross-origin (fetch CORS + fallback form POST): gestito a parte
const EXEMPT_PATHS = new Set(['/api/sync/ingest'])
const MULTIPART_PATHS = new Set(['/api/sync/csv'])

/** host[:port] normalizzato (porta di default rimossa) a partire da un URL completo. */
function urlHost(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.host.toLowerCase() : null
  } catch {
    return null
  }
}

/** Host della richiesta (Host o X-Forwarded-Host), normalizzato con lo schema dell'Origin. */
function requestHosts(event: any, protocol: string): string[] {
  const raw = [
    getRequestHeader(event, 'host'),
    ...(getRequestHeader(event, 'x-forwarded-host') || '').split(','),
  ]
  const hosts: string[] = []
  for (const h of raw) {
    const host = urlHost(`${protocol}//${(h || '').trim()}`)
    if (host) hosts.push(host)
  }
  return hosts
}

export default defineEventHandler((event) => {
  const method = (event.method || event.node.req.method || 'GET').toUpperCase()
  if (SAFE_METHODS.has(method)) return

  const path = normalizePath(event.path)
  if (!isApiPath(path) || EXEMPT_PATHS.has(path)) return

  // 1) Stessa origine
  const source = getRequestHeader(event, 'origin') || getRequestHeader(event, 'referer')
  if (source) {
    const sourceHost = urlHost(source)
    const protocol = (() => {
      try { return new URL(source).protocol } catch { return 'http:' }
    })()
    if (!sourceHost || !requestHosts(event, protocol).includes(sourceHost)) {
      throw userError(403, userMessage('errors.csrf.crossOrigin'))
    }
  }

  // 2) Content-Type ammessi
  const contentType = (getRequestHeader(event, 'content-type') || '').split(';')[0]!.trim().toLowerCase()
  if (!contentType) {
    const length = getRequestHeader(event, 'content-length')
    const chunked = getRequestHeader(event, 'transfer-encoding')
    if (!chunked && (!length || Number(length) === 0)) return
  } else if (contentType === 'application/json') {
    return
  } else if (contentType === 'multipart/form-data' && MULTIPART_PATHS.has(path)) {
    return
  }
  throw userError(415, userMessage('errors.csrf.contentType'))
})
