<template>
  <div class="ws-settings mx-auto max-w-7xl pb-12 fade-in">
    <!-- Titolo della pagina: sul telefono solo nell'elenco delle sezioni -->
    <div :class="section ? 'hidden md:block' : ''" class="mb-6 md:mb-7">
      <h1 class="font-display text-4xl leading-tight text-white md:text-[44px]">{{ t('settings.title') }}</h1>
      <p class="mt-1 text-[15px] text-zinc-400 md:text-base">
        <span class="hidden md:inline">{{ t('settings.subtitle') }}</span>
        <span class="md:hidden">{{ t('settings.nav.chooseSection') }}</span>
      </p>
    </div>

    <div class="flex flex-col items-start gap-8 md:flex-row">
      <!-- Desktop: barra laterale con le sezioni -->
      <nav :aria-label="t('settings.nav.label')" class="hidden w-64 shrink-0 flex-col gap-1 md:sticky md:top-20 md:flex lg:w-[280px]">
        <a
          v-for="item in navItems"
          :key="item.id"
          :href="hrefFor(item.id)"
          class="ws-nav-item"
          :aria-current="item.id === currentSection ? 'page' : undefined"
          @click.prevent="openSection(item.id)"
        >
          <span class="flex-1">{{ item.label }}</span>
          <span v-if="item.badge" class="text-[13px] font-semibold" :class="`ws-tone-${item.tone}`">{{ item.badge }}</span>
        </a>
        <div class="mt-5 rounded-xl border border-[var(--ws-border)] bg-[var(--ws-bg-card)] p-3.5 text-[13px] leading-relaxed text-zinc-400 ws-prose">
          <a :href="configDocsUrl(locale)" target="_blank" rel="noopener">{{ t('settings.nav.docs') }}</a>
        </div>
      </nav>

      <!-- Telefono: elenco delle sezioni con lo stato, tocco = apre la sezione -->
      <nav v-if="!section" :aria-label="t('settings.nav.label')" class="w-full md:hidden">
        <ul class="ws-card overflow-hidden !p-0">
          <li v-for="(item, i) in navItems" :key="item.id" :class="i < navItems.length - 1 ? 'border-b border-[#1f1f2e]' : ''">
            <a :href="hrefFor(item.id)" class="flex min-h-16 items-center gap-3 px-4 py-2 text-white !no-underline" @click.prevent="openSection(item.id)">
              <span class="min-w-0 flex-1">
                <span class="block text-base font-semibold">{{ item.label }}</span>
                <span class="block text-[13px]" :class="item.summaryTone ? `ws-tone-${item.summaryTone}` : 'text-zinc-400'">{{ item.summary }}</span>
              </span>
              <UIcon name="i-lucide-chevron-right" class="shrink-0 text-lg text-zinc-400" aria-hidden="true" />
            </a>
          </li>
        </ul>
        <p class="mt-2 text-center text-[13px] text-zinc-400 ws-prose">
          <a :href="configDocsUrl(locale)" target="_blank" rel="noopener" class="inline-flex min-h-11 items-center">{{ t('settings.nav.docs') }}</a>
        </p>
      </nav>

      <!-- Contenuto della sezione -->
      <div
        :id="contentId"
        class="w-full min-w-0 flex-1 focus:outline-none"
        :class="section ? '' : 'hidden md:block'"
        tabindex="-1"
      >
        <a
          :href="hrefFor(null)"
          class="ws-btn mb-4 !px-3 md:!hidden"
          @click.prevent="openSection(null)"
        >
          <UIcon name="i-lucide-arrow-left" aria-hidden="true" />
          <span>{{ t('settings.nav.allSections') }}</span>
        </a>
        <SettingsFeedback v-if="currentSection !== 'sources'" scope="global" class="mb-4" />

        <SettingsGeneralSection v-if="currentSection === 'general'" />
        <SettingsSourcesSection v-else-if="currentSection === 'sources'" v-model:source="source" />
        <SettingsAiSection v-else-if="currentSection === 'ai'" />
        <SettingsMetadataSection v-else-if="currentSection === 'metadata'" />
        <SettingsAccessSection v-else-if="currentSection === 'access'" />
        <SettingsSystemSection v-else-if="currentSection === 'system'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  SETTINGS_SECTIONS, SETTINGS_SOURCES, sourceName, type SettingsSection, type SettingsSource,
} from '~/composables/useSettings'

const { t, locale } = useI18n()
const store = provideSettings()
const { config, configLoaded, authStatus, activeSources } = store

// ── Sezione e fonte nell'URL (?section=sources&source=netflix): link e ricarica funzionano ──
function parseUrl(params: URLSearchParams): { section: SettingsSection | null; source: SettingsSource | null } {
  const s = params.get('section')
  const src = params.get('source')
  return {
    section: (SETTINGS_SECTIONS as readonly string[]).includes(s || '') ? s as SettingsSection : null,
    source: (SETTINGS_SOURCES as readonly string[]).includes(src || '') ? src as SettingsSource : null,
  }
}

const initial = parseUrl(useRequestURL().searchParams)
// null = nessuna sezione scelta: elenco sul telefono, Generale sul desktop
const section = ref<SettingsSection | null>(initial.section)
const source = ref<SettingsSource>(initial.source || 'netflix')
const currentSection = computed<SettingsSection>(() => section.value || 'general')
const contentId = useId()

function hrefFor(sec: SettingsSection | null): string {
  if (!sec) return '?'
  const params = new URLSearchParams({ section: sec })
  if (sec === 'sources') params.set('source', source.value)
  return `?${params}`
}

function writeUrl(replace = false) {
  if (!import.meta.client) return
  const url = new URL(window.location.href)
  url.searchParams.delete('section')
  url.searchParams.delete('source')
  if (section.value) {
    url.searchParams.set('section', section.value)
    if (section.value === 'sources') url.searchParams.set('source', source.value)
  }
  const next = `${url.pathname}${url.search}${url.hash}`
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return
  if (replace) window.history.replaceState(window.history.state, '', next)
  else window.history.pushState(window.history.state, '', next)
}

function openSection(sec: SettingsSection | null) {
  section.value = sec
  writeUrl()
  // Telefono: la sezione aperta (o l'elenco) parte dall'alto
  if (import.meta.client && window.matchMedia('(max-width: 767px)').matches) {
    window.scrollTo({ top: 0 })
    if (sec) nextTick(() => document.getElementById(contentId)?.focus({ preventScroll: true }))
  }
}

// Cambio di fonte: stesso punto della cronologia (non serve un "indietro" per ogni riquadro)
watch(source, () => writeUrl(true))

function onPopState() {
  const parsed = parseUrl(new URLSearchParams(window.location.search))
  section.value = parsed.section
  if (parsed.source) source.value = parsed.source
}

onMounted(async () => {
  window.addEventListener('popstate', onPopState)
  await Promise.all([store.loadConfig(), store.loadStats(), store.loadProfile()])
})
onBeforeUnmount(() => window.removeEventListener('popstate', onPopState))

// ── Voci di navigazione con lo stato (badge sul desktop, sottotitolo sul telefono) ──
type Tone = 'ok' | 'warn' | 'error' | 'neutral'
const navItems = computed(() => {
  const sources = activeSources.value
  const loginEnabled = !!authStatus.value?.enabled
  const tmdbMissing = configLoaded.value && !config.value.tmdb.has_api_key
  const items: Array<{ id: SettingsSection; label: string; badge?: string; tone?: Tone; summary: string; summaryTone?: Tone }> = [
    { id: 'general', label: t('settings.sections.general.title'), summary: t('settings.sections.general.summary') },
    {
      id: 'sources',
      label: t('settings.sections.sources.title'),
      ...(configLoaded.value
        ? sources.length
          ? {
              badge: t('settings.status.activeCount', { count: sources.length }),
              tone: 'ok' as Tone,
              summary: t('settings.status.activeList', { count: sources.length, names: sources.map(s => sourceName(s, t)).join(', ') }),
              summaryTone: 'ok' as Tone,
            }
          : { badge: t('settings.status.none'), tone: 'warn' as Tone, summary: t('settings.status.noneConnected'), summaryTone: 'warn' as Tone }
        : { summary: t('settings.sections.sources.summary') }),
    },
    { id: 'ai', label: t('settings.sections.ai.title'), summary: t('settings.sections.ai.summary') },
    {
      id: 'metadata',
      label: t('settings.sections.metadata.title'),
      ...(tmdbMissing
        ? { badge: t('settings.status.keyMissing'), tone: 'warn' as Tone, summary: t('settings.status.keyMissing'), summaryTone: 'warn' as Tone }
        : { summary: t('settings.sections.metadata.summary') }),
    },
    {
      id: 'access',
      label: t('settings.sections.access.title'),
      badge: loginEnabled ? t('settings.status.loginOn') : t('settings.status.loginOff'),
      tone: loginEnabled ? 'ok' : 'warn',
      summary: loginEnabled ? t('settings.status.loginEnabled') : t('settings.status.loginDisabled'),
      summaryTone: loginEnabled ? 'ok' : 'warn',
    },
    { id: 'system', label: t('settings.sections.system.title'), summary: t('settings.sections.system.summary') },
  ]
  return items
})
</script>
