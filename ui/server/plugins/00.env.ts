import { existsSync } from 'fs'
import { join } from 'path'
import { findProjectRoot } from '../utils/paths'

// Carica <root>/.env (se esiste) prima degli altri plugin: così TMDB_API_KEY, LLM_* ecc.
// valgono anche per il server compilato e per `nuxt dev`, senza EnvironmentFile o export.
// process.loadEnvFile (Node ≥ 20.12) non sovrascrive le variabili già presenti
// nell'ambiente: Docker Compose, systemd o la shell hanno sempre la precedenza,
// quindi caricare lo stesso file due volte è innocuo.
export default defineNitroPlugin(() => {
  const envPath = join(findProjectRoot(), '.env')
  if (!existsSync(envPath)) return
  if (typeof process.loadEnvFile !== 'function') {
    console.warn(`[WatchSense] ${envPath} ignored: loading it requires Node.js ≥ 20.12.`)
    return
  }
  try {
    process.loadEnvFile(envPath)
  } catch (e: any) {
    console.error(`[WatchSense] Cannot read ${envPath}:`, e.message)
  }
})
