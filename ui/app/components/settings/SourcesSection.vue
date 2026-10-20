<template>
  <div class="flex flex-col gap-5">
    <SettingsSectionHeader :title="t('settings.sections.sources.title')" :intro="t('settings.sources.intro')">
      <button
        v-if="canSyncAll"
        type="button"
        class="ws-btn"
        :disabled="syncingAll || syncingNetflix || syncingStremio"
        @click="syncAll"
      >
        <UIcon :name="syncingAll ? 'i-lucide-loader-2' : 'i-lucide-refresh-cw'" :class="{ 'animate-spin': syncingAll }" aria-hidden="true" />
        <span>{{ syncingAll ? t('settings.syncing') : t('settings.sources.syncAll') }}</span>
      </button>
    </SettingsSectionHeader>
    <SettingsFeedback scope="global" />

    <!-- Griglia delle fonti: un riquadro per fonte, quello scelto apre il suo pannello -->
    <div role="group" :aria-label="t('settings.sources.tilesLabel')" class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <button
        v-for="tile in tiles"
        :key="tile.id"
        type="button"
        class="ws-tile"
        :aria-pressed="tile.id === source ? 'true' : 'false'"
        @click="source = tile.id"
      >
        <span class="flex items-center gap-2.5">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] font-display text-xl text-white" :style="{ background: tile.color }" aria-hidden="true">{{ tile.initial }}</span>
          <span class="text-base font-semibold">{{ tile.name }}</span>
        </span>
        <span class="text-[13px] text-zinc-400">{{ tile.method }}</span>
        <span class="mt-auto flex items-center gap-1.5 text-[13px] font-semibold" :class="`ws-tone-${tile.tone}`">
          <span class="h-2 w-2 shrink-0 rounded-full bg-current" aria-hidden="true"></span>
          <span>{{ tile.status }}</span>
        </span>
      </button>
    </div>

    <SettingsSourcesNetflixPanel v-if="source === 'netflix'" @go-source="source = $event" />
    <SettingsSourcesPrimePanel v-else-if="source === 'prime'" />
    <SettingsSourcesStremioPanel v-else-if="source === 'stremio'" />
    <SettingsSourcesTraktPanel v-else-if="source === 'trakt'" />
    <SettingsSourcesCsvPanel v-else-if="source === 'csv'" />

    <SettingsSourcesOtherPlatforms @go-source="source = $event" />

    <p class="text-[13px] leading-relaxed text-zinc-400">{{ t('settings.syncInfo.text') }}</p>
  </div>
</template>

<script setup lang="ts">
import { sourceName, type SettingsSource } from '~/composables/useSettings'

const source = defineModel<SettingsSource>('source', { required: true })

const { t, formatDate } = useI18n()
const {
  config, flash, setFlash, netflixCookiesExpired, platformEpisodes, syncingNetflix, syncingStremio, syncNetflix, syncStremio,
} = useSettings()

// Nei riquadri basta il giorno (data e ora complete nel pannello della fonte)
const short = (at: string | null | undefined) => formatDate(at, { day: 'numeric', month: 'short' })

type Tone = 'ok' | 'warn' | 'error' | 'neutral'
function syncTileStatus(status: { ok: boolean; at: string } | null, linked: boolean, platform: string): { status: string; tone: Tone } {
  if (status && !status.ok) return { status: t('settings.sources.status.lastFailed'), tone: 'warn' }
  if (status?.ok && linked) return { status: t('settings.sources.status.activeAt', { date: short(status.at) }), tone: 'ok' }
  if (linked) return { status: t('settings.sources.status.connected'), tone: 'ok' }
  const episodes = platformEpisodes(platform)
  if (episodes > 0) return { status: t('settings.sources.status.episodes', { count: episodes }), tone: 'neutral' }
  return { status: t('settings.sources.status.notConnected'), tone: 'neutral' }
}

// Stato di ogni fonte dai dati della config (esiti delle sync, visioni per piattaforma)
const tiles = computed(() => {
  const sync = config.value.sync
  const netflix = netflixCookiesExpired.value
    ? { status: t('settings.sources.status.cookiesExpired'), tone: 'error' as Tone }
    : syncTileStatus(sync.netflix.last_status, sync.netflix.has_cookies, 'netflix')
  const stremio = syncTileStatus(sync.stremio.last_status, sync.stremio.has_auth_key, 'stremio')
  const primeEpisodes = platformEpisodes('prime')
  const bookmarklet = sync.bookmarklet.last_status
  const prime = primeEpisodes > 0
    ? { status: t('settings.sources.status.episodes', { count: primeEpisodes }), tone: 'ok' as Tone }
    : bookmarklet?.ok
      ? { status: t('settings.sources.status.lastSent', { date: short(bookmarklet.at) }), tone: 'ok' as Tone }
      : { status: t('settings.sources.status.notConnected'), tone: 'neutral' as Tone }
  const traktEpisodes = platformEpisodes('trakt')
  const trakt = traktEpisodes > 0
    ? { status: t('settings.sources.status.imported', { count: traktEpisodes }), tone: 'neutral' as Tone }
    : { status: t('settings.sources.status.notImported'), tone: 'neutral' as Tone }
  return [
    { id: 'netflix' as const, initial: 'N', color: 'var(--ws-netflix)', method: t('settings.sources.method.netflix'), ...netflix },
    { id: 'prime' as const, initial: 'P', color: 'var(--ws-prime)', method: t('settings.sources.method.prime'), ...prime },
    { id: 'stremio' as const, initial: 'S', color: '#7b5bf5', method: t('settings.sources.method.stremio'), ...stremio },
    { id: 'trakt' as const, initial: 'T', color: 'var(--ws-trakt)', method: t('settings.sources.method.trakt'), ...trakt },
    { id: 'csv' as const, initial: 'C', color: '#3f3f56', method: t('settings.sources.method.csv'), status: t('settings.sources.status.csvHint'), tone: 'neutral' as Tone },
  ].map(tile => ({ ...tile, name: sourceName(tile.id, t) }))
})

// "Sincronizza tutto": le fonti automatiche collegate, una dopo l'altra
const canSyncAll = computed(() => config.value.sync.netflix.has_cookies || config.value.sync.stremio.has_auth_key)
const syncingAll = ref(false)
async function syncAll() {
  syncingAll.value = true
  const results: string[] = []
  let failed = false
  try {
    for (const [linked, run] of [
      [config.value.sync.netflix.has_cookies, syncNetflix],
      [config.value.sync.stremio.has_auth_key, syncStremio],
    ] as const) {
      if (!linked) continue
      failed = !(await run('global')) || failed
      results.push(flash.value.text)
    }
    // Un solo messaggio con gli esiti di tutte le fonti
    setFlash('global', failed ? 'error' : 'success', results.filter(Boolean).join(' '))
  } finally {
    syncingAll.value = false
  }
}
</script>
