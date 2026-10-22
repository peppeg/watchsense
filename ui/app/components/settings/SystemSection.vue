<template>
  <div class="flex flex-col gap-5">
    <SettingsSectionHeader :title="t('settings.sections.system.title')" :intro="t('settings.sections.system.intro')" />

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="ws-card !p-5">
        <div class="text-sm text-zinc-400">{{ t('settings.system.episodesTile') }}</div>
        <div class="mt-1 font-display text-4xl text-white">{{ formatNumber(stats.totalEpisodes || 0) }}</div>
      </div>
      <div class="ws-card !p-5">
        <div class="text-sm text-zinc-400">{{ t('settings.system.showsTile') }}</div>
        <div class="mt-1 font-display text-4xl text-white">{{ formatNumber(stats.uniqueShows || 0) }}</div>
        <div class="text-[13px] text-zinc-400">{{ t('settings.system.enrichedTile', { count: stats.enrichedShows || 0 }) }}</div>
      </div>
      <div class="ws-card !p-5">
        <div class="text-sm text-zinc-400">{{ t('settings.system.database') }}</div>
        <div class="mt-1 font-display text-4xl text-white">SQLite · WAL</div>
      </div>
    </div>

    <SettingsCard :title="t('settings.system.autoSync')">
      <ul class="flex flex-col gap-1 text-[15px] leading-relaxed text-zinc-300">
        <li>{{ t('settings.system.schedulerNetflix', { count: config.sync.netflix.interval_hours }) }}</li>
        <li>{{ t('settings.system.schedulerStremio') }}</li>
      </ul>
      <p class="text-sm text-zinc-400">
        {{ config.sync.last_sync_timestamp
          ? t('settings.system.autoSyncActive', { date: formatDateTime(config.sync.last_sync_timestamp) })
          : t('settings.system.schedulerNone') }}
      </p>
    </SettingsCard>

    <SettingsCard :title="t('settings.system.privacyTitle')">
      <p class="text-[15px] leading-relaxed text-zinc-300">{{ t('settings.system.privacyText') }}</p>
    </SettingsCard>

    <!-- Esporta i tuoi dati: download diretti (il cookie di sessione viaggia con il link) -->
    <SettingsCard :title="t('settings.system.exportTitle')" :intro="t('settings.system.exportIntro')">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="flex flex-col items-start gap-2">
          <a href="/api/export/history.csv" download class="ws-btn">
            <UIcon name="i-lucide-file-spreadsheet" aria-hidden="true" />
            <span>{{ t('settings.system.exportHistory') }}</span>
          </a>
          <p class="text-sm leading-relaxed text-zinc-400">{{ t('settings.system.exportHistoryHelp') }}</p>
        </div>
        <div class="flex flex-col items-start gap-2">
          <a href="/api/export/profile.json" download class="ws-btn">
            <UIcon name="i-lucide-file-json" aria-hidden="true" />
            <span>{{ t('settings.system.exportProfile') }}</span>
          </a>
          <p class="text-sm leading-relaxed text-zinc-400">{{ t('settings.system.exportProfileHelp') }}</p>
        </div>
      </div>
    </SettingsCard>

    <!-- Lista "Per iniziare" nascosta dalla Home: si può riportare -->
    <SettingsCard v-if="config.onboarding?.dismissed" :title="t('settings.system.onboardingTitle')" :intro="t('settings.system.onboardingText')">
      <div>
        <button type="button" class="ws-btn" :disabled="restoringOnboarding" @click="showOnboardingAgain">
          <UIcon name="i-lucide-list-checks" aria-hidden="true" />
          <span>{{ t('settings.system.onboardingShow') }}</span>
        </button>
      </div>
    </SettingsCard>

    <SettingsCard :title="t('settings.system.title')" :intro="t('settings.system.intro')">
      <dl class="divide-y divide-[#1f1f2e] text-sm">
        <div class="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
          <dt class="text-zinc-400">{{ t('settings.system.database') }}</dt>
          <dd class="font-mono text-white">{{ t('settings.system.databaseValue', { count: stats.totalEpisodes || 0 }) }}</dd>
        </div>
        <div class="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
          <dt class="text-zinc-400">{{ t('settings.system.uniqueShows') }}</dt>
          <dd class="font-mono text-white">{{ t('settings.system.uniqueShowsValue', { shows: stats.uniqueShows || 0, count: stats.enrichedShows || 0 }) }}</dd>
        </div>
        <div class="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
          <dt class="text-zinc-400">{{ t('settings.system.metadataSource', { country: regionName(config.locale.tmdb_region, intlLocale) }) }}</dt>
          <dd class="font-mono text-white">The Movie Database (TMDB v3 {{ config.locale.tmdb_region }})</dd>
        </div>
        <div class="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
          <dt class="text-zinc-400">{{ t('settings.system.engine') }}</dt>
          <dd class="font-mono text-white">LLM Profile Feedback Loop</dd>
        </div>
        <div class="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
          <dt class="text-zinc-400">{{ t('settings.system.uiVersion') }}</dt>
          <dd class="font-mono text-white">v{{ appVersion }}</dd>
        </div>
      </dl>
      <p class="text-sm text-zinc-400">{{ t('settings.system.footer') }}</p>
    </SettingsCard>
  </div>
</template>

<script setup lang="ts">
const { t, formatDateTime, formatNumber, intlLocale, serverErrorText } = useI18n()
const { config, stats, loadConfig, setFlash } = useSettings()
const appVersion = useRuntimeConfig().public.appVersion

const restoringOnboarding = ref(false)
async function showOnboardingAgain() {
  restoringOnboarding.value = true
  try {
    await $fetch('/api/config', { method: 'POST', body: { onboarding: { dismissed: false } } })
    await loadConfig()
    setFlash('global', 'success', t('settings.system.onboardingShown'))
  } catch (err: any) {
    setFlash('global', 'error', t('settings.saveError', { detail: serverErrorText(err) }))
  } finally {
    restoringOnboarding.value = false
  }
}
</script>
