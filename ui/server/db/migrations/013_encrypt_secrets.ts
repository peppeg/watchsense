import type { Migration } from '../migrate'
import { encryptSecret, isEncryptedSecret } from '../../utils/secret-key'

// v13 — segreti cifrati a riposo (AES-256-GCM, vedi server/utils/secret-key.ts).
//
// Cifra al loro posto i valori in chiaro di tmdb_api_key, stremio_auth_key, netflix_cookies,
// ingest_token e il campo api_key di llm_config (JSON: base_url e model restano in chiaro).
// Idempotente: i valori già con prefisso `enc:v1:` e quelli vuoti si saltano. La chiave
// master è già caricata (o generata) da getDb() prima delle migrazioni; se manca, lancia e
// la migrazione va in rollback. Nessun valore finisce nel log.
//
// Elenco delle chiavi copiato qui (non importato da utils/secrets.ts) perché una migrazione
// non cambi se cambia il codice dell'app.
const SECRET_KEYS = ['tmdb_api_key', 'stremio_auth_key', 'netflix_cookies', 'ingest_token']

export const encryptSecretsMigration: Migration = {
  version: 13,
  name: 'encrypt_secrets',
  up(db) {
    const get = db.prepare('SELECT value FROM config WHERE key = ?')
    const set = db.prepare('UPDATE config SET value = ? WHERE key = ?')
    for (const key of SECRET_KEYS) {
      const row = get.get(key) as { value: string | null } | undefined
      const value = row?.value
      if (typeof value !== 'string' || value === '' || isEncryptedSecret(value)) continue
      set.run(encryptSecret(value), key)
    }

    const llm = get.get('llm_config') as { value: string | null } | undefined
    if (typeof llm?.value === 'string' && llm.value) {
      let parsed: any
      try {
        parsed = JSON.parse(llm.value)
      } catch {
        return // JSON non valido: l'app lo ignora già (getStoredLlmConfig)
      }
      const apiKey = parsed && typeof parsed === 'object' ? parsed.api_key : undefined
      if (typeof apiKey === 'string' && apiKey !== '' && !isEncryptedSecret(apiKey)) {
        parsed.api_key = encryptSecret(apiKey)
        set.run(JSON.stringify(parsed), 'llm_config')
      }
    }
  },
}
