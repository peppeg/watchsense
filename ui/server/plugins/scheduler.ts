import { getDb } from '../utils/db'
import { setSyncStatus, getNetflixSyncIntervalHours, STREMIO_SYNC_INTERVAL_HOURS } from '../utils/sync-helpers'
import { internalAuthHeaders } from '../utils/auth'
import { getSecretConfig } from '../utils/secrets'

export default defineNitroPlugin(() => {
  // Background sync worker (runs inside the Nitro server).
  // Netflix: ogni N ore (Impostazioni → env SYNC_INTERVAL_HOURS → 12; riletto a ogni controllo,
  // quindi un cambio dalle Impostazioni vale dal controllo successivo, senza riavvio).
  // La pagina restituisce solo le ultime 20 visioni.
  // Stremio: giornaliera (la libreria è letta per intero, una sync in più non duplica nulla).
  const ONE_HOUR = 60 * 60 * 1000
  let running = false

  async function checkAndRunScheduledSync() {
    if (running) return
    running = true
    try {
      const db = getDb()
      const getConfig = (key: string) =>
        (db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined)?.value
      const setConfig = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')

      // Migrazione dal vecchio timestamp unico: evita una sync doppia al primo avvio
      const legacy = getConfig('last_weekly_cron')
      if (legacy) {
        if (!getConfig('last_cron_netflix')) setConfig.run('last_cron_netflix', legacy)
        if (!getConfig('last_cron_stremio')) setConfig.run('last_cron_stremio', legacy)
      }

      const isDue = (key: string, intervalMs: number) => {
        const value = getConfig(key)
        const last = value ? new Date(value).getTime() : 0
        return !Number.isFinite(last) || Date.now() - last >= intervalMs
      }

      // ── Netflix ──
      if (isDue('last_cron_netflix', getNetflixSyncIntervalHours() * ONE_HOUR)) {
        const cookies = getSecretConfig('netflix_cookies', db).value
        if (cookies) {
          console.log('[WatchSense Scheduler] Avvio sincronizzazione Netflix automatica...')
          try {
            await $fetch('/api/sync/netflix', { method: 'POST', body: { cookies }, headers: internalAuthHeaders() })
            console.log('[WatchSense Scheduler] Sincronizzazione Netflix completata.')
          } catch (err: any) {
            const message = err.data?.message || err.message
            // L'endpoint indica se Netflix ha rifiutato i cookie ('auth'); ogni altro errore è generico.
            // Il codice del messaggio (err.data.data.code) si conserva per la traduzione nella UI.
            const data = err.data?.data
            setSyncStatus('netflix', false, typeof data?.code === 'string'
              ? { message, code: data.code, params: data.params, notes: data.notes }
              : message, data?.reason === 'auth' ? 'auth' : 'error')
            console.error('[WatchSense Scheduler] Errore sync Netflix:', message)
          }
        }
        setConfig.run('last_cron_netflix', new Date().toISOString())
      }

      // ── Stremio ──
      if (isDue('last_cron_stremio', STREMIO_SYNC_INTERVAL_HOURS * ONE_HOUR)) {
        const authKey = getSecretConfig('stremio_auth_key', db).value
        if (authKey) {
          console.log('[WatchSense Scheduler] Avvio sincronizzazione Stremio automatica...')
          try {
            await $fetch('/api/sync/stremio', { method: 'POST', body: { authKey }, headers: internalAuthHeaders() })
            console.log('[WatchSense Scheduler] Sincronizzazione Stremio completata.')
          } catch (err: any) {
            console.error('[WatchSense Scheduler] Errore sync Stremio:', err.data?.message || err.message)
          }
        }
        setConfig.run('last_cron_stremio', new Date().toISOString())
      }
    } catch (e: any) {
      console.error('[WatchSense Scheduler] Errore nel worker scheduler:', e.message)
    } finally {
      running = false
    }
  }

  // Initial check after 30 seconds from startup
  setTimeout(() => {
    checkAndRunScheduledSync()
  }, 30000)

  // Periodic check every hour
  setInterval(() => {
    checkAndRunScheduledSync()
  }, ONE_HOUR)
})
