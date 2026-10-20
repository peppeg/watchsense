import { randomBytes, timingSafeEqual } from 'crypto'
import { getDb } from './db'

const KEY = 'ingest_token'
const TOKEN_RE = /^[0-9a-f]{64}$/

function newToken(): string {
  return randomBytes(32).toString('hex')
}

/** Token del bookmarklet (32 byte hex); generato e salvato alla prima lettura. */
export function getIngestToken(): string {
  const db = getDb()
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(KEY) as { value: string } | undefined
  if (row && TOKEN_RE.test(row.value)) return row.value
  const token = newToken()
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(KEY, token)
  return token
}

/** Genera un nuovo token: i bookmarklet installati in precedenza smettono di funzionare. */
export function regenerateIngestToken(): string {
  const token = newToken()
  getDb().prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(KEY, token)
  return token
}

/** Confronto a tempo costante con il token dell'istanza. */
export function isValidIngestToken(candidate: unknown): boolean {
  if (typeof candidate !== 'string' || !TOKEN_RE.test(candidate)) return false
  const expected = Buffer.from(getIngestToken(), 'utf8')
  const given = Buffer.from(candidate, 'utf8')
  return given.length === expected.length && timingSafeEqual(given, expected)
}
