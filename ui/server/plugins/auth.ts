import { configuredToken, isLoopbackHost } from '../utils/auth'

// Dopo 00.env.ts (che carica .env): avvisa se l'app è raggiungibile dalla rete senza token.
export default defineNitroPlugin(() => {
  if (configuredToken()) {
    console.log('[WatchSense] Authentication enabled (WATCHSENSE_TOKEN).')
    return
  }
  const host = process.env.NITRO_HOST || process.env.HOST
  if (isLoopbackHost(host)) return
  console.warn(`[WatchSense] Warning: WATCHSENSE_TOKEN is not set and the server listens on ${host || 'all interfaces'}: anyone who can reach the port gets in without logging in (see docs/CONFIGURATION.md).`)
})
