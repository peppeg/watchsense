import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { chmodSync, closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { getDatabasePath } from './paths'

// Cifratura dei segreti salvati in `config` (cookie Netflix, authKey Stremio, chiavi API,
// token del bookmarklet): AES-256-GCM con IV casuale di 12 byte per valore e tag di 16 byte.
// Formato salvato: `enc:v1:<base64(iv | tag | ciphertext)>`.
//
// Chiave master (32 byte), in quest'ordine:
//  1. env WATCHSENSE_SECRET_KEY: 64 caratteri esadecimali oppure 32 byte in base64
//     (`openssl rand -base64 32`). Qualsiasi altro valore è un errore all'avvio: niente
//     derivazione da password, così una passphrase debole non diventa la chiave.
//  2. file WATCHSENSE_SECRET_KEY_FILE, default `<cartella del DB>/secret.key` (fuori dal glob
//     dei backup `watchsense.db*`). Se manca si genera (32 byte casuali in base64, 0600,
//     creazione atomica senza sovrascrivere); se c'è ma non è valido si fallisce: generarne
//     uno nuovo renderebbe illeggibili i segreti già salvati.
// La chiave non si scrive mai nei log.

export const SECRET_PREFIX = 'enc:v1:'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

export const SECRET_KEY_ENV = 'WATCHSENSE_SECRET_KEY'
export const SECRET_KEY_FILE_ENV = 'WATCHSENSE_SECRET_KEY_FILE'

export type SecretKeySource = 'env' | 'file' | 'generated'

let cached: { key: Buffer, source: SecretKeySource, path: string | null } | null = null

/** Chiave in formato testo → 32 byte (64 hex o base64 di 32 byte), altrimenti null. */
export function parseSecretKey(text: string): Buffer | null {
  const value = text.trim()
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex')
  if (/^[A-Za-z0-9+/_-]{43}={0,1}$/.test(value)) {
    const buf = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    if (buf.length === KEY_BYTES) return buf
  }
  return null
}

/** Percorso del file della chiave: WATCHSENSE_SECRET_KEY_FILE oppure `<cartella del DB>/secret.key`. */
export function getSecretKeyPath(): string {
  const fromEnv = process.env[SECRET_KEY_FILE_ENV]?.trim()
  return fromEnv ? resolve(fromEnv) : join(dirname(getDatabasePath()), 'secret.key')
}

function loadKeyFile(path: string): Buffer {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (e: any) {
    throw new Error(`Cannot read the secret key file ${path} (${e?.code || e?.message}). Fix its permissions or restore it from a backup; WatchSense will not create a new one over it.`)
  }
  const key = parseSecretKey(text)
  if (!key) {
    throw new Error(`The secret key file ${path} is not valid (expected 32 bytes in base64 or 64 hex characters). Restore it from a backup: a new key would make the saved secrets unreadable.`)
  }
  return key
}

/** Crea il file della chiave in modo atomico (0600, mai sovrascritto); se esiste già lo legge. */
function createKeyFile(path: string): { key: Buffer, created: boolean } {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const key = randomBytes(KEY_BYTES)
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
  const fd = openSync(tmp, 'wx', 0o600)
  try {
    writeSync(fd, `${key.toString('base64')}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    // link() fallisce se la destinazione esiste: due processi in gara non si sovrascrivono
    linkSync(tmp, path)
    return { key, created: true }
  } catch (e: any) {
    if (e?.code !== 'EEXIST') throw e
    return { key: loadKeyFile(path), created: false }
  } finally {
    try { unlinkSync(tmp) } catch {}
  }
}

/** Porta un file a 0600 se è del processo; EPERM e simili diventano un avviso. */
export function restrictFileMode(path: string, mode = 0o600): void {
  try {
    const st = statSync(path)
    if ((st.mode & 0o777) === mode) return
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
      console.warn(`[WatchSense] ${path} is not owned by this user: cannot set its permissions to ${mode.toString(8)}.`)
      return
    }
    chmodSync(path, mode)
  } catch (e: any) {
    if (e?.code === 'ENOENT') return
    console.warn(`[WatchSense] Cannot set the permissions of ${path} to ${mode.toString(8)}: ${e?.code || e?.message}`)
  }
}

/**
 * Chiave master (caricata una volta per processo). Lancia un errore esplicito se
 * WATCHSENSE_SECRET_KEY non è valida o se il file della chiave è illeggibile/corrotto.
 */
export function getSecretKey(): Buffer {
  return loadSecretKey().key
}

export function loadSecretKey(): { key: Buffer, source: SecretKeySource, path: string | null } {
  if (cached) return cached
  const fromEnv = process.env[SECRET_KEY_ENV]
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    const key = parseSecretKey(fromEnv)
    if (!key) {
      throw new Error(`${SECRET_KEY_ENV} is not valid: it must be 32 bytes in base64 (e.g. \`openssl rand -base64 32\`) or 64 hex characters.`)
    }
    cached = { key, source: 'env', path: null }
    return cached
  }
  const path = getSecretKeyPath()
  let key: Buffer
  let source: SecretKeySource = 'file'
  let exists = true
  try {
    statSync(path)
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw new Error(`Cannot access the secret key file ${path} (${e?.code || e?.message}).`)
    exists = false
  }
  if (exists) {
    key = loadKeyFile(path)
  } else {
    const res = createKeyFile(path)
    key = res.key
    if (res.created) {
      source = 'generated'
      console.log(`[WatchSense] Created the secret key file ${path}: back it up separately from the database.`)
    }
  }
  restrictFileMode(path)
  cached = { key, source, path }
  return cached
}

/** Solo per i test: dimentica la chiave in cache. */
export function resetSecretKeyCache(): void {
  cached = null
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(SECRET_PREFIX)
}

/** Cifra un valore (stringa vuota = resta vuota: niente da proteggere). */
export function encryptSecret(plain: string, key: Buffer = getSecretKey()): string {
  if (plain === '') return ''
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return SECRET_PREFIX + Buffer.concat([iv, tag, ct]).toString('base64')
}

export type DecryptResult = { ok: true, value: string, legacy: boolean } | { ok: false }

/**
 * Decifra un valore salvato. Senza prefisso è un valore in chiaro di prima della v13
 * (accettato così com'è). Chiave sbagliata o dati alterati: `{ ok: false }`, mai un'eccezione.
 */
export function decryptSecret(stored: string | null | undefined, key?: Buffer): DecryptResult {
  if (stored == null || stored === '') return { ok: true, value: '', legacy: false }
  if (!isEncryptedSecret(stored)) return { ok: true, value: stored, legacy: true }
  // Errori di caricamento della chiave (file corrotto) si propagano: non sono "valore illeggibile"
  const k = key ?? getSecretKey()
  try {
    const raw = Buffer.from(stored.slice(SECRET_PREFIX.length), 'base64')
    if (raw.length < IV_BYTES + TAG_BYTES) return { ok: false }
    const iv = raw.subarray(0, IV_BYTES)
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
    const ct = raw.subarray(IV_BYTES + TAG_BYTES)
    const decipher = createDecipheriv('aes-256-gcm', k, iv)
    decipher.setAuthTag(tag)
    const value = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
    return { ok: true, value, legacy: false }
  } catch {
    return { ok: false }
  }
}
