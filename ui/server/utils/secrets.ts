import type Database from 'better-sqlite3'
import { getDb } from './db'
import { decryptSecret, encryptSecret } from './secret-key'

// Lettura e scrittura dei segreti in `config`, sempre cifrati (vedi secret-key.ts).
// Ogni lettore/scrittore di queste chiavi passa da qui; le altre righe di `config`
// (lingua, intervalli, stato delle sync, ...) restano in chiaro.

/** Righe di `config` che contengono un segreto per intero. */
export const SECRET_CONFIG_KEYS = ['tmdb_api_key', 'stremio_auth_key', 'netflix_cookies', 'ingest_token'] as const
export type SecretConfigKey = typeof SECRET_CONFIG_KEYS[number]

/** `llm_config` è JSON in chiaro (base_url, model): solo il campo `api_key` è cifrato. */
export const LLM_CONFIG_KEY = 'llm_config'

export interface SecretRead {
  /** Valore in chiaro ('' se assente o non decifrabile). */
  value: string
  /** Salvato ma non decifrabile (chiave cambiata o mancante): va reinserito. */
  unreadable: boolean
}

// Un avviso per segreto e processo, non uno per lettura
const warned = new Set<string>()

/** Avviso nel log per un segreto non decifrabile: solo il nome, mai il valore. */
export function warnUnreadableSecret(name: string): void {
  if (warned.has(name)) return
  warned.add(name)
  console.warn(`[WatchSense] The saved secret "${name}" cannot be decrypted (encryption key changed or missing): it is treated as not configured until it is entered again.`)
}

/** Decifra un valore salvato (anche in chiaro, di prima della cifratura). */
export function readSecretValue(name: string, stored: string | null | undefined): SecretRead {
  const res = decryptSecret(stored)
  if (res.ok) {
    warned.delete(name)
    return { value: res.value, unreadable: false }
  }
  warnUnreadableSecret(name)
  return { value: '', unreadable: true }
}

export function getSecretConfig(key: SecretConfigKey, db: Database.Database = getDb()): SecretRead {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined
  return readSecretValue(key, row?.value)
}

/** Salva un segreto cifrato ('' resta '': segreto cancellato). */
export function setSecretConfig(key: SecretConfigKey, value: string, db: Database.Database = getDb()): void {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, encryptSecret(value))
  warned.delete(key)
}

export function clearSecretConfig(key: SecretConfigKey, db: Database.Database = getDb()): void {
  db.prepare('DELETE FROM config WHERE key = ?').run(key)
  warned.delete(key)
}
