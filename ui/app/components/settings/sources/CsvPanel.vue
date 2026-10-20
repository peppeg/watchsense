<template>
  <SettingsCard :title="t('settings.csv.panelTitle')" :intro="t('settings.csv.panelIntro')" level="h3">
    <!-- Area di rilascio; "scegli un file" è il pulsante raggiungibile da tastiera -->
    <div
      class="flex flex-col items-center gap-2.5 rounded-2xl border-2 border-dashed px-6 py-9 text-center transition-colors"
      :class="isDragging ? 'border-emerald-500 bg-emerald-500/10' : 'border-[#2c2c40]'"
      @dragover.prevent="isDragging = true"
      @dragleave.prevent="isDragging = false"
      @drop.prevent="handleCsvDrop"
    >
      <input ref="csvFileInput" type="file" accept=".csv" class="hidden" @change="handleCsvFileSelect" />
      <UIcon
        :name="uploadingCsv ? 'i-lucide-loader-2' : 'i-lucide-upload'"
        class="text-3xl text-zinc-400"
        :class="{ 'animate-spin text-emerald-400': uploadingCsv }"
        aria-hidden="true"
      />
      <span class="text-base font-semibold text-white">{{ uploadingCsv ? t('settings.csv.uploading') : t('settings.csv.dropTitle') }}</span>
      <span class="text-sm text-zinc-400">
        <I18nT keypath="settings.csv.dropOr">
          <template #choose><button type="button" class="ws-link" :disabled="uploadingCsv" @click="csvFileInput?.click()">{{ t('settings.csv.choose') }}</button></template>
        </I18nT>
      </span>
    </div>
    <SettingsFeedback scope="csv" />

    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div class="ws-inset text-sm leading-relaxed text-zinc-300 ws-prose">
        <strong class="text-white">Netflix</strong><br>
        <I18nT keypath="settings.csv.netflixBox">
          <template #file><code>NetflixViewingHistory.csv</code></template>
        </I18nT>
      </div>
      <div class="ws-inset text-sm leading-relaxed text-zinc-300 ws-prose">
        <strong class="text-white">Prime Video</strong><br>
        <I18nT keypath="settings.csv.primeBox">
          <template #project><a href="https://github.com/twocaretcat/watch-history-exporter-for-amazon-prime-video" target="_blank" rel="noopener">Watch History Exporter</a></template>
        </I18nT>
      </div>
    </div>

    <SettingsDisclosure :label="t('settings.csv.advanced')" :open-label="t('settings.csv.hideAdvanced')">
      <div class="ws-inset flex flex-col gap-4 !p-4">
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div class="flex flex-col gap-2">
            <label for="csv-platform" class="text-sm text-zinc-300">{{ t('settings.csv.formatLabel') }}</label>
            <select id="csv-platform" v-model="csvPlatform" class="ws-input cursor-pointer">
              <option value="auto">{{ t('settings.csv.formatAuto') }}</option>
              <option value="netflix">{{ t('settings.csv.formatNetflix') }}</option>
              <option value="prime">{{ t('settings.csv.formatPrime') }}</option>
            </select>
          </div>
          <div v-if="csvPlatform !== 'prime'" class="flex flex-col gap-2">
            <label for="csv-date-format" class="text-sm text-zinc-300">{{ t('settings.csv.dateLabel') }}</label>
            <select id="csv-date-format" v-model="csvDateFormat" class="ws-input cursor-pointer">
              <option value="auto">{{ t('settings.csv.dateAuto') }}</option>
              <option value="DMY">{{ t('settings.csv.dateDMY') }}</option>
              <option value="MDY">{{ t('settings.csv.dateMDY') }}</option>
            </select>
          </div>
        </div>
        <p class="text-sm text-zinc-400">{{ t('settings.csv.advancedNote') }}</p>
        <p v-if="csvPlatform !== 'prime'" class="text-sm leading-relaxed text-zinc-400">
          <strong class="text-zinc-200">Netflix:</strong> {{ t('settings.csv.netflixNote') }}
        </p>
        <p class="text-sm leading-relaxed text-zinc-400 ws-prose">
          <strong class="text-zinc-200">Prime Video:</strong> <I18nT keypath="settings.csv.primeNote">
            <template #columns><code>Date Watched, Type, Title, Episode Title…</code></template>
            <template #project><a href="https://github.com/twocaretcat/watch-history-exporter-for-amazon-prime-video" target="_blank" rel="noopener">Watch History Exporter for Amazon Prime Video</a></template>
          </I18nT>
        </p>
        <p class="text-sm leading-relaxed text-zinc-400 ws-prose">
          <I18nT keypath="settings.csv.primeLegacy">
            <template #columns><code>Title, Date</code></template>
            <template #prime><strong class="text-zinc-200">Prime Video</strong></template>
          </I18nT>
        </p>
      </div>
    </SettingsDisclosure>
  </SettingsCard>
</template>

<script setup lang="ts">
const { t, translateServerMessage, serverErrorText } = useI18n()
const { loadStats, loadProfile, loadConfig, setFlash, clearFlash } = useSettings()

const uploadingCsv = ref(false)
const csvPlatform = ref<'auto' | 'netflix' | 'prime'>('auto')
const csvDateFormat = ref<'auto' | 'DMY' | 'MDY'>('auto')
const isDragging = ref(false)
const csvFileInput = ref<HTMLInputElement | null>(null)

async function uploadCsvFile(file: File) {
  uploadingCsv.value = true
  clearFlash()
  try {
    const text = await file.text()
    const res: any = await $fetch('/api/sync/csv', {
      method: 'POST',
      body: { csvContent: text, platform: csvPlatform.value, dateFormat: csvDateFormat.value },
    })
    setFlash('csv', 'success', translateServerMessage(res))
    await Promise.all([loadStats(), loadProfile(), loadConfig()])
  } catch (err: any) {
    setFlash('csv', 'error', serverErrorText(err))
  } finally {
    uploadingCsv.value = false
  }
}

function handleCsvDrop(e: DragEvent) {
  isDragging.value = false
  const files = e.dataTransfer?.files
  if (files && files.length > 0) uploadCsvFile(files[0]!)
}

function handleCsvFileSelect(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files && target.files.length > 0) uploadCsvFile(target.files[0]!)
  // Lo stesso file si può ricaricare (es. dopo aver cambiato formato)
  target.value = ''
}
</script>
