import { regenerateIngestToken } from '../../../utils/ingest-token'

// Endpoint della UI: protetto dal middleware CSRF e, se attiva, dall'autenticazione (non è tra le esenzioni)
export default defineEventHandler(() => {
  return { ok: true, token: regenerateIngestToken() }
})
