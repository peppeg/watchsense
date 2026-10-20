/** Guida alla configurazione (docs/CONFIGURATION*.md su GitHub) nella lingua dell'app. */
const DOCS_BASE = 'https://github.com/peppeg/watchsense/blob/main/docs'

/** Capitoli della guida: ancora inglese e italiana. */
const ANCHORS = {
  top: ['', ''],
  access: ['access-and-security', 'accesso-e-sicurezza'],
  sync: ['sync-methods', 'metodi-di-sincronizzazione'],
} as const

export function configDocsUrl(locale: string, section: keyof typeof ANCHORS = 'top'): string {
  const it = locale === 'it'
  const anchor = ANCHORS[section][it ? 1 : 0]
  return `${DOCS_BASE}/${it ? 'CONFIGURATION.it.md' : 'CONFIGURATION.md'}${anchor ? `#${anchor}` : ''}`
}
