<template>
  <!-- Limite dichiarato: servizi senza collegamento e alternative -->
  <SettingsCard :title="t('settings.sources.other.title')" :intro="t('settings.sources.other.intro')" level="h3">
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div class="ws-inset text-sm leading-relaxed text-zinc-300">
        <strong class="text-white">{{ t('settings.sources.other.manualTitle') }}</strong><br>
        {{ t('settings.sources.other.manualText', { inProgress: t('show.watchButton.markInProgress'), completed: t('show.watchButton.markCompleted') }) }}
      </div>
      <div class="ws-inset text-sm leading-relaxed text-zinc-300 ws-prose">
        <strong class="text-white">{{ t('settings.sources.other.traktTitle') }}</strong><br>
        <I18nT keypath="settings.sources.other.traktText">
          <template #scrobbler><a href="https://github.com/trakt-tools/universal-trakt-scrobbler" target="_blank" rel="noopener">Universal Trakt Scrobbler</a></template>
          <template #import><button type="button" class="ws-link" @click="emit('goSource', 'trakt')">{{ t('settings.sources.other.traktImport') }}</button></template>
        </I18nT>
      </div>
    </div>
  </SettingsCard>
</template>

<script setup lang="ts">
import type { SettingsSource } from '~/composables/useSettings'

const emit = defineEmits<{ goSource: [SettingsSource] }>()
const { t } = useI18n()
</script>
