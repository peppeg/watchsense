// Normalizzazione del percorso delle richieste per i middleware (CSRF, auth): toglie la query,
// decodifica i caratteri codificati, comprime le barre doppie, toglie la barra finale e
// porta tutto in minuscolo, così '/API//stats/' o '/api/%73tats' non aggirano i controlli.
// I segmenti '.'/'..' NON vengono risolti: '/api/shows/..%2Fhealth' deve restare sotto /api/shows
// (il router non decodifica %2F e lo instraderebbe a /api/shows/:id), non diventare '/api/health'.

/** Percorso normalizzato (vedi sopra); decodifica ripetuta fino a stabilità (max 3 volte). */
export function normalizePath(path: string): string {
  let pathname = (path || '').split('?')[0]!.split('#')[0] || '/'
  for (let i = 0; i < 3; i++) {
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      break
    }
    if (decoded === pathname) break
    pathname = decoded
  }
  return pathname.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1').toLowerCase()
}

/** Vero se il percorso normalizzato contiene un segmento 'api' (es. '/api/...', '/./api/...'). */
export function isApiPath(normalized: string): boolean {
  return /(^|\/)api(\/|$)/.test(normalized)
}
