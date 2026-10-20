<template>
  <div class="flex flex-col gap-5">
    <SettingsSectionHeader :title="t('settings.sections.general.title')" :intro="t('settings.sections.general.intro')" />

    <!-- Lingua e regione (ADR-001 §1) -->
    <SettingsCard :title="t('settings.language.title')" :intro="t('settings.language.intro')">
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div class="flex flex-col gap-2">
          <label for="ws-app-locale" class="text-sm text-zinc-300">{{ t('settings.language.appLanguage') }}</label>
          <select id="ws-app-locale" v-model="localeForm.app_locale" class="ws-input cursor-pointer" aria-describedby="ws-app-locale-help">
            <option v-for="code in config.locale.supported_locales" :key="code" :value="code">{{ nativeLanguageName(code) }}</option>
          </select>
          <p id="ws-app-locale-help" class="text-sm text-zinc-400">{{ t('settings.language.appLanguageHelp') }}</p>
        </div>

        <div class="flex flex-col gap-2">
          <label for="ws-tmdb-language" class="text-sm text-zinc-300">{{ t('settings.language.tmdbLanguage') }}</label>
          <select id="ws-tmdb-language" v-model="localeForm.tmdb_language" class="ws-input cursor-pointer" aria-describedby="ws-tmdb-language-help">
            <option v-for="o in tmdbLanguageChoices" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <p id="ws-tmdb-language-help" class="text-sm text-zinc-400">{{ t('settings.language.tmdbLanguageHelp') }}</p>
        </div>

        <div class="flex flex-col gap-2">
          <label for="ws-tmdb-region" class="text-sm text-zinc-300">{{ t('settings.language.region') }}</label>
          <select id="ws-tmdb-region" v-model="localeForm.region" class="ws-input cursor-pointer" aria-describedby="ws-tmdb-region-help">
            <optgroup :label="t('settings.language.regionsVerified')">
              <option v-for="o in verifiedRegionChoices" :key="o.value" :value="o.value">{{ o.label }}</option>
            </optgroup>
            <option v-if="savedRegionChoice" :value="savedRegionChoice.value">{{ savedRegionChoice.label }}</option>
            <option :value="OTHER_REGION">{{ t('settings.language.regionOther') }}</option>
          </select>
          <div v-if="localeForm.region === OTHER_REGION" class="flex items-center gap-3">
            <input
              v-model="localeForm.regionOther"
              type="text"
              maxlength="2"
              :placeholder="t('settings.language.regionCodePlaceholder')"
              :aria-label="t('settings.language.regionCode')"
              class="ws-input !w-24 font-mono uppercase placeholder:normal-case"
            />
            <span class="text-sm text-zinc-400">{{ otherRegionName }}</span>
          </div>
          <p id="ws-tmdb-region-help" class="text-sm text-zinc-400">{{ t('settings.language.regionHelp') }}</p>
        </div>
      </div>

      <p class="text-sm leading-relaxed text-zinc-400">{{ t('settings.language.note') }}</p>

      <div>
        <button type="button" class="ws-btn ws-btn-primary" :disabled="savingLocale || !localeSavable" @click="saveLocale">
          <UIcon v-if="savingLocale" name="i-lucide-loader-2" class="animate-spin" aria-hidden="true" />
          <span>{{ savingLocale ? t('settings.language.saving') : t('settings.language.save') }}</span>
        </button>
      </div>
    </SettingsCard>

    <!-- Sezioni della Home: ogni interruttore salva subito -->
    <SettingsCard :title="t('settings.home.title')" :intro="t('settings.home.intro')">
      <ul class="-mt-1">
        <li
          v-for="section in config.home"
          :key="section.key"
          class="flex min-h-12 items-center justify-between gap-4 border-t border-[#1f1f2e] py-2"
        >
          <span :id="`ws-home-${section.key}`" class="text-[15px]" :class="section.visible ? 'text-zinc-100' : 'text-zinc-500'">{{ homeSectionLabel(section.key) }}</span>
          <button
            type="button"
            role="switch"
            class="ws-switch"
            :aria-checked="section.visible ? 'true' : 'false'"
            :aria-labelledby="`ws-home-${section.key}`"
            :disabled="savingHome"
            @click="toggleHomeSection(section.key, !section.visible)"
          >
            <span aria-hidden="true"></span>
          </button>
        </li>
      </ul>
    </SettingsCard>
  </div>
</template>

<script setup lang="ts">
import { hasKey, type MessageKey } from '~/locales/i18n'

const { t, locale, setLocale, serverErrorText } = useI18n()
const { tmdbLanguage: tmdbLanguageState } = useLocaleState()
const { config, configLoaded, loadConfig, setFlash, onConfigLoaded } = useSettings()

// Nome di una sezione della Home (il server manda solo la chiave)
const homeSectionLabel = (key: string) => {
  const k = `home.sections.${key}`
  return hasKey(k) ? t(k as MessageKey) : key
}

const savingHome = ref(false)

// Mostra/nasconde una sezione della Home: si salva subito l'elenco delle sezioni nascoste
async function toggleHomeSection(key: string, visible: boolean) {
  const previous = config.value.home.map(s => ({ ...s }))
  config.value.home = config.value.home.map(s => (s.key === key ? { ...s, visible } : s))
  savingHome.value = true
  try {
    await $fetch('/api/config', {
      method: 'POST',
      body: { home: { hidden: config.value.home.filter(s => !s.visible).map(s => s.key) } },
    })
  } catch (err: any) {
    config.value.home = previous
    setFlash('global', 'error', serverErrorText(err))
  } finally {
    savingHome.value = false
  }
}

// ── Lingua e regione ──
const OTHER_REGION = '__other'
const localeForm = ref({ app_locale: 'en', tmdb_language: 'en-US', region: 'US', regionOther: '' })
const savingLocale = ref(false)

const tmdbLanguageChoices = computed(() => tmdbLanguageOptions(config.value.locale.tmdb_language, locale.value))
const verifiedRegionChoices = computed(() => regionOptions(config.value.locale.chart_regions, null, locale.value))
// Regione salvata fuori dalla tabella delle classifiche: resta selezionabile
const savedRegionChoice = computed(() => {
  const r = config.value.locale.tmdb_region
  return !r || config.value.locale.chart_regions.includes(r) ? null : { value: r, label: `${regionName(r, locale.value)} · ${r}` }
})
const selectedRegion = computed(() => (localeForm.value.region === OTHER_REGION
  ? normalizeRegionInput(localeForm.value.regionOther)
  : localeForm.value.region))
const otherRegionName = computed(() => {
  const code = normalizeRegionInput(localeForm.value.regionOther)
  return code ? regionName(code, locale.value) : ''
})
const localeDirty = computed(() => {
  const saved = config.value.locale
  return localeForm.value.app_locale !== saved.app_locale
    || localeForm.value.tmdb_language !== saved.tmdb_language
    || selectedRegion.value !== saved.tmdb_region
})

// Mai salvate (solo i default): si possono confermare così come sono (lista "Per iniziare")
const localeSavable = computed(() => localeDirty.value || (configLoaded.value && !config.value.locale.configured))

function fillLocaleForm() {
  const saved = config.value.locale
  localeForm.value = { app_locale: saved.app_locale, tmdb_language: saved.tmdb_language, region: saved.tmdb_region, regionOther: '' }
}

// Solo al primo caricamento: le altre ricariche non devono perdere una scelta non salvata
onConfigLoaded((_data, first) => {
  if (first) fillLocaleForm()
})
// Sezione aperta dopo il caricamento (es. da un'altra sezione)
if (configLoaded.value) fillLocaleForm()

// La lingua dell'app cambia subito (senza ricaricare); la config riletta porta le sezioni
// della Home della nuova regione
async function saveLocale() {
  const region = selectedRegion.value
  if (!region) {
    setFlash('global', 'error', t('errors.config.invalidTmdbRegion'))
    return
  }
  savingLocale.value = true
  try {
    const { app_locale, tmdb_language } = localeForm.value
    await $fetch('/api/config', { method: 'POST', body: { locale: { app_locale, tmdb_language, tmdb_region: region } } })
    setLocale(app_locale)
    tmdbLanguageState.value = tmdb_language
    await loadConfig()
    fillLocaleForm()
    setFlash('global', 'success', t('settings.language.saved'))
  } catch (err: any) {
    setFlash('global', 'error', t('settings.saveError', { detail: serverErrorText(err) }))
  } finally {
    savingLocale.value = false
  }
}
</script>
