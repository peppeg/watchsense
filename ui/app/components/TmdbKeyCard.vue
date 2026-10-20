<template>
  <!-- Chiave TMDB (DB → env): card autonoma, il genitore passa lo stato da GET /api/config -->
  <section class="ws-card flex flex-col gap-4" aria-labelledby="tmdb-key-title">
    <div class="flex flex-wrap items-center gap-2.5">
      <h3 id="tmdb-key-title" class="text-lg font-semibold text-white">{{ t('settings.tmdb.title') }}</h3>
      <span class="ws-badge" :class="status.has_api_key ? 'ok' : 'warn'">{{ statusLabel }}</span>
    </div>

    <div class="flex flex-col gap-2">
      <label for="tmdb-api-key" class="text-sm text-zinc-300">{{ t('settings.tmdb.apiKey') }}</label>
      <p v-if="status.has_api_key" class="text-sm text-zinc-400">
        {{ t('settings.tmdb.currentKey', { masked: status.masked_api_key }) }}
      </p>
      <input
        id="tmdb-api-key"
        v-model="apiKey"
        type="password"
        autocomplete="off"
        spellcheck="false"
        :placeholder="t('settings.tmdb.apiKeyPlaceholder')"
        class="ws-input font-mono sm:max-w-xl"
        aria-describedby="tmdb-api-key-help"
        @keydown.enter="save"
      />
      <p id="tmdb-api-key-help" class="text-sm text-zinc-400">{{ t('settings.tmdb.apiKeyHelp') }}</p>
      <SettingsSecretUnreadable :show="status.secret_unreadable" />
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <button type="button" class="ws-btn ws-btn-primary" :disabled="busy || !apiKey.trim()" @click="save">
        <UIcon v-if="saving" name="i-lucide-loader-2" class="animate-spin" aria-hidden="true" />
        <span>{{ t('settings.tmdb.save') }}</span>
      </button>
      <button type="button" class="ws-btn" :disabled="busy || (!apiKey.trim() && !status.has_api_key)" @click="test">
        <UIcon :name="testing ? 'i-lucide-loader-2' : 'i-lucide-plug'" :class="{ 'animate-spin': testing }" aria-hidden="true" />
        <span>{{ testing ? t('settings.tmdb.testing') : t('settings.tmdb.test') }}</span>
      </button>
      <button v-if="status.source === 'db'" type="button" class="ws-btn text-red-300" :disabled="busy" @click="clear">
        <UIcon name="i-lucide-trash-2" aria-hidden="true" />
        <span>{{ t('settings.tmdb.clear') }}</span>
      </button>
    </div>

    <div
      v-if="feedback.text"
      class="flex items-start gap-2 rounded-xl border p-3 text-sm"
      :class="feedback.ok ? 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300' : 'border-red-900/60 bg-red-950/40 text-red-300'"
      role="status"
    >
      <UIcon :name="feedback.ok ? 'i-lucide-check-circle-2' : 'i-lucide-alert-triangle'" class="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{{ feedback.text }}</span>
    </div>

    <p class="text-sm leading-relaxed text-zinc-400 ws-prose">
      <I18nT keypath="settings.tmdb.intro">
        <template #link><a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener noreferrer">themoviedb.org/settings/api</a></template>
      </I18nT>
    </p>
  </section>
</template>

<script setup lang="ts">
export interface TmdbKeyStatus {
  has_api_key: boolean
  masked_api_key: string
  source: 'db' | 'env' | 'none'
  /** Chiave salvata ma non decifrabile: va reinserita */
  secret_unreadable?: boolean
}

const props = defineProps<{ status: TmdbKeyStatus }>()
// Il genitore ricarica la config dopo un salvataggio o una cancellazione
const emit = defineEmits<{ changed: [] }>()

const { t, translateServerMessage, serverErrorText } = useI18n()

const apiKey = ref('')
const saving = ref(false)
const testing = ref(false)
const busy = computed(() => saving.value || testing.value)
const feedback = ref<{ ok: boolean; text: string }>({ ok: true, text: '' })

const statusLabel = computed(() => {
  if (props.status.source === 'db') return t('settings.tmdb.statusDb')
  if (props.status.source === 'env') return t('settings.tmdb.statusEnv')
  return t('settings.tmdb.statusMissing')
})

async function save() {
  if (!apiKey.value.trim() || busy.value) return
  saving.value = true
  try {
    await $fetch('/api/config', { method: 'POST', body: { tmdb: { api_key: apiKey.value } } })
    apiKey.value = ''
    feedback.value = { ok: true, text: t('settings.tmdb.saved') }
    emit('changed')
  } catch (err: any) {
    feedback.value = { ok: false, text: serverErrorText(err) }
  } finally {
    saving.value = false
  }
}

async function test() {
  testing.value = true
  try {
    const res: any = await $fetch('/api/tmdb/test', { method: 'POST', body: { api_key: apiKey.value } })
    feedback.value = { ok: true, text: translateServerMessage(res) }
  } catch (err: any) {
    feedback.value = { ok: false, text: serverErrorText(err) }
  } finally {
    testing.value = false
  }
}

async function clear() {
  if (typeof window !== 'undefined' && !window.confirm(t('settings.tmdb.clearConfirm'))) return
  saving.value = true
  try {
    await $fetch('/api/config', { method: 'POST', body: { tmdb: { api_key: '', clear_api_key: true } } })
    feedback.value = { ok: true, text: t('settings.tmdb.cleared') }
    emit('changed')
  } catch (err: any) {
    feedback.value = { ok: false, text: serverErrorText(err) }
  } finally {
    saving.value = false
  }
}
</script>
