<template>
  <div class="flex flex-col gap-4">
    <!-- Cookie rifiutati da Netflix (401/403, redirect al login) -->
    <div
      v-if="netflixCookiesExpired"
      role="alert"
      class="flex flex-wrap items-center gap-4 rounded-[14px] border border-red-900 bg-[#2a1215] px-5 py-4"
    >
      <div class="min-w-0 flex-[1_1_300px]">
        <strong class="text-[15px] text-white">{{ t('settings.netflix.expiredTitle') }}</strong>
        <p class="mt-0.5 text-sm text-red-300">{{ t('settings.netflix.expiredText') }}</p>
        <p v-if="status" class="mt-1 text-sm text-red-300/80">{{ translateServerMessage(status) }}</p>
      </div>
      <button type="button" class="ws-btn ws-btn-primary" @click="focusCookies">{{ t('settings.netflix.updateCookies') }}</button>
    </div>

    <SettingsCard :title="t('settings.netflix.panelTitle')" :intro="t('settings.netflix.panelIntro')" level="h3">
      <template #actions>
        <button
          type="button"
          class="ws-btn ws-btn-primary"
          :disabled="syncingNetflix || !config.sync.netflix.has_cookies"
          @click="syncNetflix('netflix')"
        >
          <UIcon :name="syncingNetflix ? 'i-lucide-loader-2' : 'i-lucide-refresh-cw'" :class="{ 'animate-spin': syncingNetflix }" aria-hidden="true" />
          <span>{{ syncingNetflix ? t('settings.syncing') : t('settings.netflix.syncNow') }}</span>
        </button>
      </template>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SettingsStat :label="t('settings.sources.stat.lastSync')" :value="lastSync.text" :tone="lastSync.tone" />
        <SettingsStat :label="t('settings.sources.stat.result')" :value="result" />
        <SettingsStat :label="t('settings.sources.stat.next')" :value="nextRun" />
      </div>

      <div
        v-if="status && !status.ok && !netflixCookiesExpired"
        class="flex items-start gap-2 rounded-xl border border-amber-600/60 bg-amber-950/40 p-3 text-sm text-amber-200"
      >
        <UIcon name="i-lucide-alert-circle" class="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
        <div class="space-y-1">
          <p class="font-semibold text-amber-100">{{ t('settings.netflix.lastFailedTitle') }}</p>
          <p class="text-amber-300/90">{{ translateServerMessage(status) }}</p>
          <p class="text-amber-300/70">{{ t('settings.netflix.notRejected') }}</p>
        </div>
      </div>

      <!-- Intervallo della sync automatica: salvato subito, lo scheduler lo usa dal controllo successivo -->
      <div class="flex flex-wrap items-center gap-3">
        <label for="ws-netflix-interval" class="text-[15px] text-zinc-300">{{ t('settings.netflix.interval') }}</label>
        <select
          id="ws-netflix-interval"
          class="ws-input !w-44 cursor-pointer"
          :value="config.sync.netflix.interval_hours"
          :disabled="savingInterval"
          aria-describedby="ws-netflix-interval-note"
          @change="saveInterval(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="h in intervalChoices" :key="h" :value="h">{{ intervalLabel(h) }}</option>
        </select>
        <span id="ws-netflix-interval-note" class="text-sm text-zinc-400">{{ t('settings.netflix.intervalNote') }}</span>
      </div>
      <SettingsFeedback scope="netflix" />
    </SettingsCard>

    <!-- Collegamento: cookie della sessione Netflix -->
    <SettingsCard :title="t('settings.netflix.linkTitle')" :badge="cookieBadge.label" :badge-tone="cookieBadge.tone">
      <ol class="flex flex-col gap-4">
        <SettingsStep :n="1">
          <I18nT keypath="settings.netflix.step1">
            <template #site><a href="https://www.netflix.com" target="_blank" rel="noopener">netflix.com</a></template>
            <template #cookie1><code>NetflixId</code></template>
            <template #cookie2><code>SecureNetflixId</code></template>
            <template #extension><a href="https://cookie-editor.com" target="_blank" rel="noopener">Cookie-Editor</a></template>
          </I18nT>
          <SettingsDisclosure class="mt-1.5" :label="t('settings.guide.show')" :open-label="t('settings.guide.hide')">
            <div class="ws-inset flex flex-col gap-2 text-sm leading-relaxed text-zinc-300">
              <p>
                <I18nT keypath="settings.netflix.guideHeader">
                  <template #export><strong class="text-white">Export</strong></template>
                  <template #header><strong class="text-white">Header String</strong></template>
                </I18nT>
              </p>
              <p>{{ t('settings.netflix.guideFormats') }}</p>
              <p>{{ t('settings.netflix.guideExpiry') }}</p>
            </div>
          </SettingsDisclosure>
        </SettingsStep>
        <SettingsStep :n="2">
          <label for="ws-netflix-cookies">{{ t('settings.netflix.pasteLabel') }}</label>
          <textarea
            id="ws-netflix-cookies"
            ref="cookiesInput"
            v-model="cookies"
            class="ws-input mt-2"
            autocomplete="off"
            spellcheck="false"
            placeholder="NetflixId=…; SecureNetflixId=…"
          ></textarea>
        </SettingsStep>
        <SettingsStep :n="3" center>
          <div class="flex flex-wrap items-center gap-3">
            <button
              type="button"
              class="ws-btn ws-btn-primary"
              :disabled="savingCookies || syncingNetflix || !cookies.trim()"
              @click="saveAndTest"
            >
              <UIcon v-if="savingCookies || syncingNetflix" name="i-lucide-loader-2" class="animate-spin" aria-hidden="true" />
              <span>{{ savingCookies || syncingNetflix ? t('settings.netflix.testing') : t('settings.netflix.saveAndTest') }}</span>
            </button>
            <span class="text-sm text-zinc-400">{{ t('settings.netflix.saveAndTestHint') }}</span>
          </div>
        </SettingsStep>
      </ol>
      <SettingsFeedback scope="netflixLink" />
      <p class="border-t border-[#1f1f2e] pt-3.5 text-sm text-zinc-400">
        <I18nT keypath="settings.netflix.noCookies">
          <template #bookmarklet><button type="button" class="ws-link" @click="emit('goSource', 'prime')">{{ t('settings.netflix.bookmarkletLink') }}</button></template>
        </I18nT>
      </p>
    </SettingsCard>
  </div>
</template>

<script setup lang="ts">
import type { SettingsSource } from '~/composables/useSettings'

const emit = defineEmits<{ goSource: [SettingsSource] }>()
const { t, formatDateTime, translateServerMessage, serverErrorText } = useI18n()
const { config, netflixCookiesExpired, syncingNetflix, syncNetflix, loadConfig, setFlash, clearFlash } = useSettings()

const status = computed(() => config.value.sync.netflix.last_status)
const short = (at: string | null | undefined) => formatDateTime(at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const lastSync = computed(() => {
  const s = status.value
  if (!s) return { text: t('settings.sources.stat.never'), tone: 'neutral' as const }
  return s.ok
    ? { text: short(s.at), tone: 'ok' as const }
    : { text: t('settings.sources.stat.failedAt', { date: short(s.at) }), tone: 'error' as const }
})
// Risultato breve dai parametri dell'esito (sync.netflix.done: viewed, episodes)
const result = computed(() => {
  const s = status.value
  if (!s) return '—'
  if (!s.ok) return netflixCookiesExpired.value ? t('settings.sources.stat.cookiesRejected') : t('settings.sources.stat.failed')
  const p = s.code === 'sync.netflix.done' ? s.params as { viewed?: number; episodes?: number } | undefined : undefined
  return p ? t('settings.sources.result.netflix', { viewed: p.viewed ?? 0, count: p.episodes ?? 0 }) : t('settings.lastSyncOk')
})
const nextRun = computed(() => {
  const n = config.value.sync.netflix
  if (!n.has_cookies) return '—'
  return n.next_run_at ? t('settings.sources.stat.around', { date: short(n.next_run_at) }) : t('settings.sources.stat.soon')
})

const cookieBadge = computed(() => {
  if (netflixCookiesExpired.value) return { label: t('settings.netflix.needsUpdate'), tone: 'error' as const }
  if (config.value.sync.netflix.has_cookies) return { label: t('settings.netflix.cookiesSaved'), tone: 'ok' as const }
  return { label: t('settings.notConfigured'), tone: 'neutral' as const }
})

// ── Intervallo ──
const intervalChoices = computed(() => {
  const n = config.value.sync.netflix
  const list = [...n.interval_choices]
  if (!list.includes(n.interval_hours)) list.push(n.interval_hours)
  return list.sort((a, b) => a - b)
})
const intervalLabel = (h: number) => {
  const label = t('settings.netflix.intervalOption', { count: h })
  const envHours = config.value.sync.netflix.env_interval_hours
  return h === envHours && ![6, 12, 24].includes(h) ? `${label} (${t('settings.netflix.intervalEnv')})` : label
}
const savingInterval = ref(false)
async function saveInterval(value: string) {
  savingInterval.value = true
  clearFlash()
  try {
    await $fetch('/api/config', { method: 'POST', body: { netflix: { sync_interval_hours: Number(value) } } })
    await loadConfig()
    setFlash('netflix', 'success', t('settings.netflix.intervalSaved', { count: Number(value) }))
  } catch (err: any) {
    setFlash('netflix', 'error', t('settings.saveError', { detail: serverErrorText(err) }))
    await loadConfig()
  } finally {
    savingInterval.value = false
  }
}

// ── Cookie: "Salva e prova" salva e fa subito una sync con i cookie salvati ──
const cookies = ref('')
const cookiesInput = ref<HTMLTextAreaElement | null>(null)
const savingCookies = ref(false)

function focusCookies() {
  cookiesInput.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  cookiesInput.value?.focus({ preventScroll: true })
}

async function saveAndTest() {
  if (!cookies.value.trim()) return
  savingCookies.value = true
  clearFlash()
  try {
    await $fetch('/api/config', { method: 'POST', body: { netflix: { cookies: cookies.value } } })
    cookies.value = ''
  } catch (err: any) {
    setFlash('netflixLink', 'error', t('settings.saveError', { detail: serverErrorText(err) }))
    return
  } finally {
    savingCookies.value = false
  }
  await syncNetflix('netflixLink')
}
</script>
