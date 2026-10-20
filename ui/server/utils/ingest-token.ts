import { randomBytes, timingSafeEqual } from 'crypto'
import { getSecretConfig, setSecretConfig, type SecretRead } from './secrets'

const KEY = 'ingest_token'
const TOKEN_RE = /^[0-9a-f]{64}$/

function newToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Token del bookmarklet (32 byte hex, salvato cifrato); generato alla prima lettura.
 * Se il token salvato non si decifra (chiave dei segreti cambiata) NON si rigenera da solo:
 * resta '' con unreadable, finché l'utente non lo rigenera dalle Impostazioni (con la
 * chiave giusta ripristinata, il bookmarklet già installato torna a funzionare).
 */
export function getIngestTokenState(): SecretRead {
  const stored = getSecretConfig(KEY)
  if (stored.unreadable) return stored
  if (TOKEN_RE.test(stored.value)) return stored
  const token = newToken()
  setSecretConfig(KEY, token)
  return { value: token, unreadable: false }
}

export function getIngestToken(): string {
  return getIngestTokenState().value
}

/** Genera un nuovo token: i bookmarklet installati in precedenza smettono di funzionare. */
export function regenerateIngestToken(): string {
  const token = newToken()
  setSecretConfig(KEY, token)
  return token
}

/** Confronto a tempo costante (dopo la decifratura) con il token dell'istanza. */
export function isValidIngestToken(candidate: unknown): boolean {
  if (typeof candidate !== 'string' || !TOKEN_RE.test(candidate)) return false
  const current = getIngestToken()
  if (!TOKEN_RE.test(current)) return false
  const expected = Buffer.from(current, 'utf8')
  const given = Buffer.from(candidate, 'utf8')
  return given.length === expected.length && timingSafeEqual(given, expected)
}
