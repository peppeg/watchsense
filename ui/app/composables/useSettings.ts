/**
 * Stato condiviso della pagina Impostazioni: config (GET /api/config), statistiche, profilo
 * gusti, stato del login e messaggi di esito. SettingsView lo crea con `provideSettings()`,
 * le sezioni (components/settings/*) lo leggono con `useSettings()`.
 */
import type { InjectionKey } from 'vue'
import type { ServerMessage } from '~/locales/i18n'

export const SETTINGS_SECTIONS = ['general', 'sources', 'ai', 'metadata', 'access', 'system'] as const
export type SettingsSection = typeof SETTINGS_SECTIONS[number]
export const SETTINGS_SOURCES = ['netflix', 'prime', 'stremio', 'trakt', 'csv'] as const
export type SettingsSource = typeof SETTINGS_SOURCES[number]

export type SyncStatus = ServerMessage & { ok: boolean; at: string; message: string; reason?: 'auth' | 'error' }

/** Dove compare un messaggio: in cima alla pagina o dentro un pannello. */
export type FlashScope = 'global' | 'netflix' | 'netflixLink' | 'stremio' | 'stremioLink' | 'prime' | 'trakt' | 'csv' | 'llm' | 'profile' | 'access'

function emptyConfig() {
  return {
    llm: {
      base_url: 'https://api.kilo.ai/api/gateway',
      model: 'kilo-auto/free',
      has_api_key: false,
      masked_api_key: '',
      configured: false,
    },
    tmdb: {
      has_api_key: false,
      masked_api_key: '',
      source: 'none' as 'db' | 'env' | 'none',
    },
    sync: {
      stremio: {
        has_auth_key: false,
        masked_auth_key: '',
        last_status: null as SyncStatus | null,
        next_run_at: null as string | null,
      },
      netflix: {
        has_cookies: false,
        masked_cookies: '',
        last_status: null as SyncStatus | null,
        interval_hours: 12,
        interval_source: 'default' as 'db' | 'env' | 'default',
        interval_choices: [6, 12, 24] as number[],
        env_interval_hours: null as number | null,
        next_run_at: null as string | null,
      },
      bookmarklet: { ingest_token: '', last_status: null as SyncStatus | null },
      platforms: {} as Record<string, { episodes: number; last_watched: string | null }>,
      last_sync_timestamp: null as string | null,
      last_sync_result: null as any,
    },
    home: [] as Array<{ key: string; label: string; visible: boolean }>,
    locale: {
      app_locale: 'en',
      tmdb_language: 'en-US',
      tmdb_region: 'US',
      configured: false,
      supported_locales: ['en', 'it'] as string[],
      chart_regions: [] as string[],
    },
    onboarding: { dismissed: false },
    taste: {
      custom_notes: '',
      ai_summary: '',
      ai_summary_updated_at: null as string | null,
    },
  }
}

export type SettingsConfig = ReturnType<typeof emptyConfig>

function createSettingsStore() {
  const { t, serverErrorText, translateServerMessage } = useI18n()

  const config = ref(emptyConfig())
  const configLoaded = ref(false)
  const stats = ref({ totalEpisodes: 0, uniqueShows: 0, enrichedShows: 0 })
  const profile = ref({
    topGenres: [] as any[],
    avoidGenres: [] as any[],
    totalShows: 0,
    feedbackCount: 0,
    ai_summary: '',
    ai_summary_updated_at: null as string | null,
    custom_notes: '',
  })
  // Stesso dato (e stessa chiave) dell'header in app.vue: nessuna richiesta in più
  const { data: authStatus } = useFetch('/api/auth/status', { key: 'auth-status' })

  // Esito dell'ultima azione, mostrato nel punto in cui è stata avviata
  const flash = ref<{ scope: FlashScope; type: 'success' | 'error'; text: string }>({ scope: 'global', type: 'success', text: '' })
  function setFlash(scope: FlashScope, type: 'success' | 'error', text: string) {
    flash.value = { scope, type, text }
  }
  function clearFlash() {
    flash.value = { ...flash.value, text: '' }
  }

  // Richiamata dopo ogni caricamento della config (la sezione AI riallinea il suo form)
  const configListeners: Array<(data: SettingsConfig, first: boolean) => void> = []
  function onConfigLoaded(fn: (data: SettingsConfig, first: boolean) => void) {
    configListeners.push(fn)
    // Le sezioni si montano e smontano cambiando sezione: il listener se ne va con loro
    if (getCurrentScope()) {
      onScopeDispose(() => {
        const i = configListeners.indexOf(fn)
        if (i >= 0) configListeners.splice(i, 1)
      })
    }
  }

  async function loadConfig() {
    try {
      const data: any = await $fetch('/api/config')
      config.value = { ...emptyConfig(), ...data, sync: { ...emptyConfig().sync, ...data.sync } }
      const first = !configLoaded.value
      configLoaded.value = true
      for (const fn of configListeners) fn(config.value, first)
    } catch (err: any) {
      console.error('Errore caricamento config:', err)
    }
  }

  async function loadStats() {
    try {
      stats.value = await $fetch('/api/stats') as any
    } catch (err: any) {
      console.error('Errore caricamento statistiche:', err)
    }
  }

  async function loadProfile() {
    try {
      const data: any = await $fetch('/api/taste-profile')
      if (data?.profile) profile.value = data.profile
    } catch (err: any) {
      console.error('Errore caricamento profilo:', err)
    }
  }

  // ── Sync (usate da più pannelli e da "Sincronizza tutto") ──
  const syncingStremio = ref(false)
  const syncingNetflix = ref(false)

  /** Sync Stremio con la authKey salvata (o `authKey` non ancora salvata). true se riuscita. */
  async function syncStremio(scope: FlashScope = 'stremio', authKey?: string): Promise<boolean> {
    syncingStremio.value = true
    clearFlash()
    try {
      const res: any = await $fetch('/api/sync/stremio', { method: 'POST', body: { authKey: authKey || undefined } })
      setFlash(scope, 'success', translateServerMessage(res))
      await Promise.all([loadStats(), loadProfile(), loadConfig()])
      return true
    } catch (err: any) {
      setFlash(scope, 'error', serverErrorText(err))
      await loadConfig()
      return false
    } finally {
      syncingStremio.value = false
    }
  }

  /** Sync Netflix con i cookie salvati (o `cookies` non ancora salvati). true se riuscita. */
  async function syncNetflix(scope: FlashScope = 'netflix', cookies?: string): Promise<boolean> {
    syncingNetflix.value = true
    clearFlash()
    try {
      const res: any = await $fetch('/api/sync/netflix', { method: 'POST', body: { cookies: cookies || undefined } })
      setFlash(scope, 'success', translateServerMessage(res))
      await Promise.all([loadStats(), loadProfile(), loadConfig()])
      return true
    } catch (err: any) {
      setFlash(scope, 'error', serverErrorText(err))
      await loadConfig()
      return false
    } finally {
      syncingNetflix.value = false
    }
  }

  // ── Token del bookmarklet (pannello Prime Video e sezione Accesso) ──
  const regeneratingToken = ref(false)
  async function regenerateIngestToken(scope: FlashScope) {
    if (typeof window !== 'undefined' && !window.confirm(t('settings.bookmarklet.regenerateConfirm'))) return
    regeneratingToken.value = true
    try {
      const res: any = await $fetch('/api/sync/ingest-token/regenerate', { method: 'POST' })
      config.value.sync.bookmarklet = { ...config.value.sync.bookmarklet, ingest_token: res.token }
      setFlash(scope, 'success', t('settings.bookmarklet.regenerated'))
    } catch (err: any) {
      setFlash(scope, 'error', t('settings.bookmarklet.regenerateFailed', { detail: serverErrorText(err) }))
    } finally {
      regeneratingToken.value = false
    }
  }

  // ── Stato delle fonti (riquadri, barra laterale) ──
  /** Avviso "cookie scaduti" solo se Netflix ha rifiutato i cookie (401/403, redirect al login).
   *  Gli esiti salvati prima del campo `reason` si riconoscono dal messaggio. */
  const netflixCookiesExpired = computed(() => {
    const status = config.value.sync.netflix.last_status
    if (!status || status.ok) return false
    if (status.reason) return status.reason === 'auth'
    return /cookie netflix scaduti/i.test(status.message || '')
  })

  const platformEpisodes = (platform: string) => config.value.sync.platforms?.[platform]?.episodes || 0

  /** Fonti collegate o con visioni importate, nell'ordine dei riquadri (il CSV non è una fonte). */
  const activeSources = computed(() => {
    const s = config.value.sync
    const active: SettingsSource[] = []
    if (s.netflix.has_cookies || platformEpisodes('netflix') > 0) active.push('netflix')
    if (platformEpisodes('prime') > 0) active.push('prime')
    if (s.stremio.has_auth_key || platformEpisodes('stremio') > 0) active.push('stremio')
    if (platformEpisodes('trakt') > 0) active.push('trakt')
    return active
  })

  return {
    config,
    configLoaded,
    stats,
    profile,
    authStatus,
    flash,
    setFlash,
    clearFlash,
    onConfigLoaded,
    loadConfig,
    loadStats,
    loadProfile,
    syncingStremio,
    syncingNetflix,
    syncStremio,
    syncNetflix,
    regeneratingToken,
    regenerateIngestToken,
    netflixCookiesExpired,
    platformEpisodes,
    activeSources,
  }
}

export type SettingsStore = ReturnType<typeof createSettingsStore>
const SETTINGS_KEY: InjectionKey<SettingsStore> = Symbol('ws-settings')

/** Crea lo stato delle Impostazioni e lo rende disponibile alle sezioni (solo in SettingsView). */
export function provideSettings(): SettingsStore {
  const store = createSettingsStore()
  provide(SETTINGS_KEY, store)
  return store
}

/** Stato delle Impostazioni creato da SettingsView. */
export function useSettings(): SettingsStore {
  const store = inject(SETTINGS_KEY)
  if (!store) throw new Error('useSettings() fuori da SettingsView')
  return store
}

/** Nome visibile di una fonte (marchi: non si traducono, tranne "File CSV"). */
export function sourceName(id: SettingsSource, t: (key: any) => string): string {
  if (id === 'netflix') return 'Netflix'
  if (id === 'prime') return 'Prime Video'
  if (id === 'stremio') return 'Stremio'
  if (id === 'trakt') return 'Trakt'
  return t('settings.sources.csvName')
}
