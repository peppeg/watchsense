<template>
  <div class="flex flex-col gap-4">
    <SettingsCard :title="t('settings.stremio.panelTitle')" level="h3">
      <template #intro>
        <I18nT keypath="settings.stremio.description">
          <template #host><code>api.strem.io</code></template>
        </I18nT>
      </template>
      <template #actions>
        <button
          type="button"
          class="ws-btn ws-btn-primary"
          :disabled="syncingStremio || !config.sync.stremio.has_auth_key"
          @click="syncStremio('stremio')"
        >
          <UIcon :name="syncingStremio ? 'i-lucide-loader-2' : 'i-lucide-refresh-cw'" :class="{ 'animate-spin': syncingStremio }" aria-hidden="true" />
          <span>{{ syncingStremio ? t('settings.syncing') : t('settings.stremio.syncNow') }}</span>
        </button>
      </template>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SettingsStat :label="t('settings.sources.stat.lastSync')" :value="lastSync.text" :tone="lastSync.tone" />
        <SettingsStat :label="t('settings.sources.stat.result')" :value="result" />
        <SettingsStat :label="t('settings.sources.stat.account')" :value="account" />
      </div>

      <div
        v-if="status && !status.ok"
        class="flex items-start gap-2 rounded-xl border border-amber-600/60 bg-amber-950/40 p-3 text-sm text-amber-200"
      >
        <UIcon name="i-lucide-alert-circle" class="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
        <div class="space-y-1">
          <p class="font-semibold text-amber-100">{{ t('settings.stremio.lastFailedTitle') }}</p>
          <p class="text-amber-300/90">{{ translateServerMessage(status) }}</p>
        </div>
      </div>
      <SettingsFeedback scope="stremio" />
    </SettingsCard>

    <!-- Collegamento: login con email e password (si salva solo la authKey) o authKey a mano -->
    <SettingsCard
      :title="t('settings.stremio.linkTitle')"
      :badge="config.sync.stremio.has_auth_key ? t('settings.stremio.connected') : t('settings.notConfigured')"
      :badge-tone="config.sync.stremio.has_auth_key ? 'ok' : 'neutral'"
    >
      <p class="text-[15px] text-zinc-300">{{ t('settings.stremio.loginIntro') }}</p>
      <form class="flex flex-col gap-4" @submit.prevent="login">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-2">
            <label for="ws-stremio-email" class="text-sm text-zinc-300">{{ t('settings.stremio.email') }}</label>
            <input id="ws-stremio-email" v-model="email" type="email" autocomplete="off" class="ws-input" />
          </div>
          <div class="flex flex-col gap-2">
            <label for="ws-stremio-password" class="text-sm text-zinc-300">{{ t('settings.stremio.password') }}</label>
            <input id="ws-stremio-password" v-model="password" type="password" autocomplete="off" class="ws-input" />
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-4">
          <button type="submit" class="ws-btn ws-btn-primary" :disabled="loggingIn || syncingStremio || !email.trim() || !password">
            <UIcon v-if="loggingIn || syncingStremio" name="i-lucide-loader-2" class="animate-spin" aria-hidden="true" />
            <span>{{ loggingIn ? t('settings.stremio.connecting') : t('settings.stremio.connect') }}</span>
          </button>
        </div>
      </form>
      <SettingsFeedback scope="stremioLink" />

      <SettingsDisclosure :label="t('settings.stremio.haveAuthKey')" :open-label="t('settings.stremio.hideAuthKey')">
        <div class="ws-inset flex flex-col gap-2">
          <label for="ws-stremio-authkey" class="text-sm text-zinc-300">authKey</label>
          <div class="flex flex-col gap-2 sm:flex-row">
            <input
              id="ws-stremio-authkey"
              v-model="authKey"
              type="password"
              autocomplete="off"
              :placeholder="t('settings.stremio.authKeyPlaceholder')"
              class="ws-input font-mono"
              aria-describedby="ws-stremio-authkey-help"
            />
            <button type="button" class="ws-btn" :disabled="savingKey || !authKey.trim()" @click="saveStremioKey">{{ t('settings.save') }}</button>
          </div>
          <p id="ws-stremio-authkey-help" class="text-sm text-zinc-400 ws-prose">
            <I18nT keypath="settings.stremio.authKeyHelp">
              <template #site><a href="https://web.stremio.com" target="_blank" rel="noopener">web.stremio.com</a></template>
              <template #code><code>JSON.parse(localStorage.getItem("profile")).auth.key</code></template>
            </I18nT>
          </p>
        </div>
      </SettingsDisclosure>
    </SettingsCard>
  </div>
</template>

<script setup lang="ts">
const { t, formatDateTime, translateServerMessage, serverErrorText } = useI18n()
const { config, flash, syncingStremio, syncStremio, loadConfig, setFlash, clearFlash } = useSettings()

const status = computed(() => config.value.sync.stremio.last_status)
const short = (at: string | null | undefined) => formatDateTime(at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const lastSync = computed(() => {
  const s = status.value
  if (!s) return { text: t('settings.sources.stat.never'), tone: 'neutral' as const }
  return s.ok
    ? { text: short(s.at), tone: 'ok' as const }
    : { text: t('settings.sources.stat.failedAt', { date: short(s.at) }), tone: 'error' as const }
})
// Risultato breve dai parametri dell'esito (sync.stremio.done: titles, episodes)
const result = computed(() => {
  const s = status.value
  if (!s) return '—'
  if (!s.ok) return t('settings.sources.stat.failed')
  const p = s.code === 'sync.stremio.done' ? s.params as { titles?: number; episodes?: number } | undefined : undefined
  return p ? t('settings.sources.result.stremio', { titles: p.titles ?? 0, count: p.episodes ?? 0 }) : t('settings.lastSyncOk')
})
const account = computed(() => (config.value.sync.stremio.has_auth_key
  ? t('settings.stremio.accountLinked', { masked: config.value.sync.stremio.masked_auth_key })
  : t('settings.stremio.accountNone')))

// ── Login: la password resta solo in questo campo e si svuota subito dopo la richiesta ──
const email = ref('')
const password = ref('')
const loggingIn = ref(false)
async function login() {
  if (!email.value.trim() || !password.value) return
  loggingIn.value = true
  clearFlash()
  let loginText = ''
  try {
    const res: any = await $fetch('/api/sync/stremio-login', { method: 'POST', body: { email: email.value, password: password.value } })
    loginText = translateServerMessage(res)
  } catch (err: any) {
    setFlash('stremioLink', 'error', serverErrorText(err))
    return
  } finally {
    password.value = ''
    loggingIn.value = false
  }
  email.value = ''
  // Collegato: prima sincronizzazione subito, come dopo il salvataggio della authKey
  await syncStremio('stremioLink')
  // Esito del login e della prima sincronizzazione nello stesso messaggio
  setFlash('stremioLink', flash.value.type, `${loginText} ${flash.value.text}`.trim())
}

// ── authKey incollata a mano ──
const authKey = ref('')
const savingKey = ref(false)
async function saveStremioKey() {
  if (!authKey.value.trim()) return
  savingKey.value = true
  clearFlash()
  try {
    await $fetch('/api/config', { method: 'POST', body: { stremio: { auth_key: authKey.value } } })
    authKey.value = ''
    await loadConfig()
    setFlash('stremioLink', 'success', t('settings.stremio.saved'))
  } catch (err: any) {
    setFlash('stremioLink', 'error', t('settings.saveError', { detail: serverErrorText(err) }))
  } finally {
    savingKey.value = false
  }
}
</script>
