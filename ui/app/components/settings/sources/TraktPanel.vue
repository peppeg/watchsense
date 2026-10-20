<template>
  <SettingsCard :title="t('settings.trakt.panelTitle')" :intro="t('settings.trakt.intro')" level="h3">
    <ol class="flex flex-col gap-4">
      <SettingsStep :n="1">
        <I18nT keypath="settings.trakt.stepExport">
          <template #export><strong class="text-white">{{ t('settings.trakt.exportLabel') }}</strong></template>
        </I18nT>
      </SettingsStep>
      <SettingsStep :n="2">
        <I18nT keypath="settings.trakt.stepCopy">
          <template #files><code>watched-history-*.json</code></template>
          <template #folder><code>exports/trakt</code></template>
          <template #compose><code>docker-compose.yml</code></template>
        </I18nT>
      </SettingsStep>
      <SettingsStep :n="3" center>
        <button type="button" class="ws-btn ws-btn-primary" :disabled="importingTrakt" @click="importTrakt">
          <UIcon :name="importingTrakt ? 'i-lucide-loader-2' : 'i-lucide-download'" :class="{ 'animate-spin': importingTrakt }" aria-hidden="true" />
          <span>{{ importingTrakt ? t('settings.trakt.importing') : t('settings.trakt.import') }}</span>
        </button>
      </SettingsStep>
    </ol>
    <SettingsFeedback scope="trakt" />
    <div class="ws-inset text-sm text-zinc-300">
      {{ traktEpisodes > 0 ? t('settings.trakt.imported', { count: traktEpisodes }) : t('settings.trakt.notImported') }}
    </div>

    <SettingsDisclosure :label="t('settings.guide.show')" :open-label="t('settings.guide.hide')">
      <div class="ws-inset text-sm leading-relaxed text-zinc-300 ws-prose">
        <p class="font-semibold text-white">{{ t('settings.trakt.whereTitle') }}</p>
        <ol class="mt-1.5 list-decimal space-y-1.5 pl-5">
          <li>{{ t('settings.trakt.step1') }}</li>
          <li>
            <I18nT keypath="settings.trakt.step2">
              <template #files><code>watched-history-*.json</code></template>
              <template #file><code>watched-history.json</code></template>
              <template #folder><code>exports/trakt/</code></template>
              <template #composeFolder><code>./exports/trakt/</code></template>
              <template #composeFile><code>docker-compose.yml</code></template>
              <template #envVar><code>EXPORTS_PATH</code></template>
              <template #sub><code>trakt/</code></template>
            </I18nT>
          </li>
          <li>{{ t('settings.trakt.step3', { button: t('settings.trakt.import') }) }}</li>
        </ol>
      </div>
    </SettingsDisclosure>
  </SettingsCard>
</template>

<script setup lang="ts">
const { t, translateServerMessage, serverErrorText } = useI18n()
const { platformEpisodes, loadStats, loadProfile, loadConfig, setFlash, clearFlash } = useSettings()

const traktEpisodes = computed(() => platformEpisodes('trakt'))
const importingTrakt = ref(false)

async function importTrakt() {
  importingTrakt.value = true
  clearFlash()
  try {
    const res: any = await $fetch('/api/import/trakt', { method: 'POST' })
    setFlash('trakt', 'success', translateServerMessage(res))
    await Promise.all([loadStats(), loadProfile(), loadConfig()])
  } catch (err: any) {
    setFlash('trakt', 'error', serverErrorText(err))
  } finally {
    importingTrakt.value = false
  }
}
</script>
