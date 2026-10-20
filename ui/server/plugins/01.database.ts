import { getDb } from '../utils/db'

// Dopo 00.env.ts: apre il DB all'avvio, così la chiave dei segreti (WATCHSENSE_SECRET_KEY o
// secret.key, generata se manca) e le migrazioni si verificano subito. Un file della chiave
// corrotto o una WATCHSENSE_SECRET_KEY non valida compaiono nel log all'avvio, non alla
// prima richiesta; le richieste che usano il DB falliscono finché non si corregge.
export default defineNitroPlugin(() => {
  try {
    getDb()
  } catch (e: any) {
    console.error(`[WatchSense] Cannot open the database: ${e?.message ?? e}`)
  }
})
