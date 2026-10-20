import { configuredToken, isLoopbackHost } from '../utils/auth'

// Dopo 00.env.ts (che carica .env): avvisa se l'app è raggiungibile dalla rete senza token.
export default defineNitroPlugin(() => {
  if (configuredToken()) {
    console.log('[WatchSense] Autenticazione attiva (WATCHSENSE_TOKEN).')
    return
  }
  const host = process.env.NITRO_HOST || process.env.HOST
  if (isLoopbackHost(host)) return
  console.warn(`[WatchSense] Attenzione: WATCHSENSE_TOKEN non impostato e ascolto su ${host || 'tutte le interfacce'}: chi raggiunge la porta accede senza login (vedi docs/CONFIGURATION.md).`)
})
