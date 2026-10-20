<template>
  <div class="flex flex-col gap-5">
    <SettingsSectionHeader :title="t('settings.sections.ai.title')" :intro="t('settings.sections.ai.intro')" />

    <!-- Gateway LLM (qualsiasi provider compatibile OpenAI) -->
    <SettingsCard :title="t('settings.llm.title')" :intro="t('settings.llm.intro')" :badge="llmBadge.label" :badge-tone="llmBadge.tone">
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div class="flex flex-col gap-2">
          <label for="ws-llm-provider" class="text-sm text-zinc-300">{{ t('settings.llm.provider') }}</label>
          <select id="ws-llm-provider" v-model="selectedProvider" class="ws-input cursor-pointer" @change="handleProviderChange">
            <option v-for="p in llmProviders" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>

        <div class="flex flex-col gap-2">
          <label for="ws-llm-model" class="text-sm text-zinc-300">{{ t('settings.llm.model') }}</label>
          <!-- Elenco modelli del provider -->
          <select id="ws-llm-model" v-model="selectedModelPreset" class="ws-input cursor-pointer font-mono" @change="handlePresetChange">
            <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
            <option value="custom">{{ t('settings.llm.customModel') }}</option>
          </select>
        </div>

        <div class="flex flex-col gap-2">
          <label for="ws-llm-key" class="text-sm text-zinc-300">{{ t('settings.llm.apiKey') }}</label>
          <input
            id="ws-llm-key"
            v-model="form.api_key"
            type="password"
            autocomplete="off"
            :placeholder="config.llm.has_api_key ? config.llm.masked_api_key : t('settings.llm.apiKeyPlaceholder')"
            class="ws-input font-mono placeholder:font-sans"
            aria-describedby="ws-llm-key-help"
          />
        </div>
      </div>

      <!-- Modello personalizzato / attuale -->
      <div class="flex flex-col gap-2">
        <label for="ws-llm-model-name" class="text-sm text-zinc-300">{{ t('settings.llm.modelName') }}</label>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            id="ws-llm-model-name"
            v-model="form.model"
            type="text"
            :placeholder="t('settings.llm.modelPlaceholder')"
            class="ws-input font-mono sm:max-w-md"
            @input="syncModelSelect"
          />
          <button type="button" class="ws-link inline-flex items-center gap-1.5" :disabled="loadingModels" @click="loadModels()">
            <UIcon :name="loadingModels ? 'i-lucide-loader-2' : 'i-lucide-refresh-cw'" :class="{ 'animate-spin': loadingModels }" aria-hidden="true" />
            <span>{{ loadingModels ? t('settings.llm.loadingModels') : t('settings.llm.loadModels') }}</span>
          </button>
        </div>
        <p v-if="modelsError" class="text-sm text-amber-400">{{ t('settings.llm.modelsErrorHint', { error: modelsError }) }}</p>
        <p v-else-if="availableModels.length" class="text-sm text-zinc-400">{{ t('settings.llm.modelsAvailable', { count: availableModels.length }) }}</p>
        <p id="ws-llm-key-help" class="text-sm text-zinc-400">
          <span v-if="config.llm.has_api_key">{{ t('settings.llm.keySaved', { masked: config.llm.masked_api_key }) }} · </span>{{ t('settings.llm.apiKeyHelp') }}
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <button type="button" class="ws-btn ws-btn-primary" :disabled="saving" @click="saveLlmConfig">
          <UIcon v-if="saving" name="i-lucide-loader-2" class="animate-spin" aria-hidden="true" />
          <span>{{ t('settings.llm.save') }}</span>
        </button>
        <button type="button" class="ws-btn" :disabled="testingLlm" @click="testLlmConnection">
          <UIcon :name="testingLlm ? 'i-lucide-loader-2' : 'i-lucide-plug'" :class="{ 'animate-spin': testingLlm }" aria-hidden="true" />
          <span>{{ testingLlm ? t('settings.llm.testing') : t('settings.llm.test') }}</span>
        </button>
        <span v-if="testResult.status" class="text-sm" :class="testResult.status === 'ok' ? 'text-emerald-400' : 'text-red-400'" role="status">
          {{ testResult.message }}
        </span>
      </div>

      <!-- URL base: aperto da solo con il provider personalizzato -->
      <SettingsDisclosure v-model:open="advancedOpen" :label="t('settings.llm.advanced')" :open-label="t('settings.llm.hideAdvanced')">
        <div class="ws-inset flex flex-col gap-2">
          <label for="ws-llm-base-url" class="text-sm text-zinc-300">{{ t('settings.llm.baseUrl') }}</label>
          <input
            id="ws-llm-base-url"
            v-model="form.base_url"
            type="text"
            placeholder="https://api.kilo.ai/api/gateway"
            class="ws-input font-mono"
            @change="syncProviderFromUrl"
          />
          <p class="text-sm text-zinc-400">
            <I18nT keypath="settings.llm.baseUrlHelp">
              <template #v1><code class="ws-code">/v1</code></template>
            </I18nT>
          </p>
        </div>
      </SettingsDisclosure>
      <SettingsSecretUnreadable :show="config.llm.secret_unreadable" />
      <SettingsFeedback scope="llm" />
    </SettingsCard>

    <!-- Profilo gusti: sintesi AI, note personali, generi -->
    <SettingsCard :title="t('settings.profile.summaryTitle')">
      <div v-if="profile.ai_summary" class="ws-inset text-[15px] leading-relaxed text-zinc-300">
        <p class="whitespace-pre-line">{{ profile.ai_summary }}</p>
      </div>
      <p v-else class="ws-inset text-sm text-zinc-400">{{ t('settings.profile.noSummary', { button: t('settings.profile.regenerate') }) }}</p>
      <div class="flex flex-wrap items-center gap-3">
        <button type="button" class="ws-btn" :disabled="generatingAiSummary" @click="generateAiTasteSummary">
          <UIcon :name="generatingAiSummary ? 'i-lucide-loader-2' : 'i-lucide-sparkles'" :class="{ 'animate-spin': generatingAiSummary }" aria-hidden="true" />
          <span>{{ generatingAiSummary ? t('settings.profile.analyzing') : t('settings.profile.regenerate') }}</span>
        </button>
        <span class="text-sm text-zinc-400">
          <template v-if="profile.ai_summary_updated_at">{{ t('settings.profile.generatedAt', { date: formatDateTime(profile.ai_summary_updated_at) }) }} · </template>{{ t('settings.profile.feedbackCount', { count: profile.feedbackCount || 0 }) }}
        </span>
      </div>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div class="ws-inset">
          <div class="text-[13px] text-zinc-400">{{ t('settings.profile.topGenres') }}</div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span v-for="g in profile.topGenres" :key="g.name" class="ws-badge neutral">{{ g.name }} <span class="ml-1 text-red-400">{{ g.weight }}</span></span>
            <span v-if="!profile.topGenres?.length" class="text-sm text-zinc-500">{{ t('settings.profile.noData') }}</span>
          </div>
        </div>
        <div class="ws-inset">
          <div class="text-[13px] text-zinc-400">{{ t('settings.profile.avoidGenres') }}</div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <span v-for="g in profile.avoidGenres" :key="g.name" class="ws-badge neutral">{{ g.name }}</span>
            <span v-if="!profile.avoidGenres?.length" class="text-sm text-zinc-500">{{ t('settings.profile.noAvoided') }}</span>
          </div>
        </div>
        <div class="ws-inset flex flex-col gap-2 text-sm text-zinc-400">
          <div class="flex justify-between gap-3"><span>{{ t('settings.profile.showsAnalyzed') }}</span><span class="font-semibold text-white">{{ profile.totalShows || 0 }}</span></div>
          <div class="flex justify-between gap-3"><span>{{ t('settings.profile.votes') }}</span><span class="font-semibold text-white">{{ profile.feedbackCount || 0 }}</span></div>
        </div>
      </div>
      <SettingsFeedback scope="profile" />
    </SettingsCard>

    <SettingsCard :title="t('settings.profile.notesTitle')">
      <p class="text-sm leading-relaxed text-zinc-400">
        <I18nT keypath="settings.profile.notesIntro">
          <template #example><em>{{ t('settings.profile.notesExample') }}</em></template>
        </I18nT>
      </p>
      <label for="ws-taste-notes" class="sr-only">{{ t('settings.profile.notesTitle') }}</label>
      <textarea
        id="ws-taste-notes"
        v-model="tasteNotes"
        rows="4"
        :placeholder="t('settings.profile.notesPlaceholder')"
        class="ws-input !font-sans !text-[15px] leading-relaxed"
        aria-describedby="ws-taste-notes-help"
      ></textarea>
      <p id="ws-taste-notes-help" class="text-sm text-zinc-400">{{ t('settings.profile.notesHelp') }}</p>
      <div>
        <button type="button" class="ws-btn ws-btn-primary" :disabled="savingNotes" @click="saveTasteNotes">
          <UIcon v-if="savingNotes" name="i-lucide-loader-2" class="animate-spin" aria-hidden="true" />
          <span>{{ t('settings.profile.saveNotes') }}</span>
        </button>
      </div>
    </SettingsCard>
  </div>
</template>

<script setup lang="ts">
const { t, formatDateTime, serverErrorText } = useI18n()
const { config, configLoaded, profile, loadConfig, loadProfile, setFlash, clearFlash, onConfigLoaded } = useSettings()

const saving = ref(false)
const savingNotes = ref(false)
const testingLlm = ref(false)
const generatingAiSummary = ref(false)
const advancedOpen = ref(false)
const testResult = ref<{ status: 'ok' | 'error' | null; message: string }>({ status: null, message: '' })
const form = ref({ base_url: '', api_key: '', model: '' })
const tasteNotes = ref('')

const selectedModelPreset = ref('kilo-auto/free')

// Preset provider OpenAI-compatibili (base URL salvata così com'è)
const llmProviders = computed(() => [
  { id: 'kilo', label: 'Kilo Gateway', base_url: 'https://api.kilo.ai/api/gateway' },
  { id: 'openrouter', label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1' },
  { id: 'openai', label: 'OpenAI', base_url: 'https://api.openai.com/v1' },
  { id: 'groq', label: 'Groq', base_url: 'https://api.groq.com/openai/v1' },
  { id: 'deepseek', label: 'DeepSeek', base_url: 'https://api.deepseek.com/v1' },
  { id: 'mistral', label: 'Mistral', base_url: 'https://api.mistral.ai/v1' },
  { id: 'ollama', label: t('settings.llm.providerLocal', { name: 'Ollama' }), base_url: 'http://localhost:11434/v1' },
  { id: 'lmstudio', label: t('settings.llm.providerLocal', { name: 'LM Studio' }), base_url: 'http://localhost:1234/v1' },
  { id: 'custom', label: t('settings.llm.providerCustom'), base_url: '' },
])
const selectedProvider = ref('kilo')
const availableModels = ref<string[]>([])
const loadingModels = ref(false)
const modelsError = ref('')

// Stato del gateway: chiave salvata, provider locale (chiave facoltativa) o da configurare
const isLocalProvider = computed(() => selectedProvider.value === 'ollama' || selectedProvider.value === 'lmstudio')
const llmBadge = computed(() => {
  if (config.value.llm.has_api_key) return { label: t('settings.llm.statusKey'), tone: 'ok' as const }
  if (config.value.llm.secret_unreadable) return { label: t('settings.secretUnreadableBadge'), tone: 'warn' as const }
  // Provider locale scelto qui, o salvato con un indirizzo di rete locale (llm.configured)
  if (isLocalProvider.value || config.value.llm.configured) return { label: t('settings.llm.statusLocal'), tone: 'ok' as const }
  return { label: t('settings.notConfigured'), tone: 'warn' as const }
})

// Opzioni tendina: modelli del provider, più quello attuale se manca
const modelOptions = computed(() => {
  const list = [...availableModels.value]
  const current = form.value.model?.trim()
  if (current && !list.includes(current)) list.unshift(current)
  return list
})

function fillFromConfig() {
  const data = config.value
  form.value.base_url = data.llm.base_url || 'https://api.kilo.ai/api/gateway'
  form.value.model = data.llm.model || 'kilo-auto/free'
  tasteNotes.value = profile.value.custom_notes || data.taste.custom_notes || ''
  syncProviderFromUrl()
  syncModelSelect()
}
onConfigLoaded(fillFromConfig)
if (configLoaded.value) fillFromConfig()
// Le note salvate arrivano anche dal profilo (GET /api/taste-profile)
watch(() => profile.value.custom_notes, (notes) => {
  if (notes) tasteNotes.value = notes
})

function handlePresetChange() {
  if (selectedModelPreset.value !== 'custom') {
    form.value.model = selectedModelPreset.value
  }
}

function normalizeUrl(url: string) {
  return (url || '').trim().replace(/\/+$/, '').toLowerCase()
}

function syncProviderFromUrl() {
  const url = normalizeUrl(form.value.base_url)
  const match = llmProviders.value.find(p => p.base_url && normalizeUrl(p.base_url) === url)
  selectedProvider.value = match ? match.id : 'custom'
  if (selectedProvider.value === 'custom') advancedOpen.value = true
  availableModels.value = []
  modelsError.value = ''
}

function syncModelSelect() {
  selectedModelPreset.value = modelOptions.value.includes(form.value.model) ? form.value.model : 'custom'
}

function handleProviderChange() {
  const preset = llmProviders.value.find(p => p.id === selectedProvider.value)
  if (!preset || !preset.base_url) {
    // Personalizzato: l'URL base si scrive a mano
    advancedOpen.value = true
    return
  }
  form.value.base_url = preset.base_url
  availableModels.value = []
  modelsError.value = ''
  loadModels(true)
}

async function loadModels(pickFirst = false) {
  loadingModels.value = true
  modelsError.value = ''
  try {
    const res: any = await $fetch('/api/llm/models', {
      method: 'POST',
      body: { base_url: form.value.base_url, api_key: form.value.api_key },
    })
    availableModels.value = res.models || []
    if (!availableModels.value.length) modelsError.value = t('settings.llm.noModels')
    // Cambio provider: se il modello attuale non è offerto, propone il primo disponibile
    if (pickFirst && availableModels.value.length && !availableModels.value.includes(form.value.model)) {
      form.value.model = availableModels.value[0] || ''
    }
    syncModelSelect()
  } catch (err: any) {
    availableModels.value = []
    modelsError.value = t('settings.llm.modelsFailed', { detail: serverErrorText(err) })
  } finally {
    loadingModels.value = false
  }
}

async function saveLlmConfig() {
  saving.value = true
  clearFlash()
  try {
    await $fetch('/api/config', {
      method: 'POST',
      body: { llm: { base_url: form.value.base_url, api_key: form.value.api_key, model: form.value.model } },
    })
    form.value.api_key = ''
    await loadConfig()
    setFlash('llm', 'success', t('settings.llm.saved'))
  } catch (err: any) {
    setFlash('llm', 'error', t('settings.llm.saveFailed', { detail: serverErrorText(err) }))
  } finally {
    saving.value = false
  }
}

async function testLlmConnection() {
  testingLlm.value = true
  testResult.value = { status: null, message: '' }
  try {
    const res: any = await $fetch('/api/llm/test', {
      method: 'POST',
      body: { base_url: form.value.base_url, api_key: form.value.api_key, model: form.value.model },
    })
    testResult.value = { status: 'ok', message: t('settings.llm.testOk', { ms: res.latencyMs, reply: res.reply }) }
  } catch (err: any) {
    testResult.value = { status: 'error', message: t('settings.llm.testFailed', { detail: serverErrorText(err) }) }
  } finally {
    testingLlm.value = false
  }
}

async function saveTasteNotes() {
  savingNotes.value = true
  clearFlash()
  try {
    await $fetch('/api/config', { method: 'POST', body: { taste: { custom_notes: tasteNotes.value } } })
    await loadProfile()
    setFlash('profile', 'success', t('settings.profile.notesSaved'))
  } catch (err: any) {
    setFlash('profile', 'error', t('settings.profile.notesSaveFailed', { detail: serverErrorText(err) }))
  } finally {
    savingNotes.value = false
  }
}

async function generateAiTasteSummary() {
  generatingAiSummary.value = true
  clearFlash()
  try {
    const res: any = await $fetch('/api/taste-profile/synthesize', { method: 'POST' })
    profile.value.ai_summary = res.summary
    profile.value.ai_summary_updated_at = res.updated_at
    setFlash('profile', 'success', t('settings.profile.summaryGenerated'))
  } catch (err: any) {
    setFlash('profile', 'error', serverErrorText(err))
  } finally {
    generatingAiSummary.value = false
  }
}
</script>
