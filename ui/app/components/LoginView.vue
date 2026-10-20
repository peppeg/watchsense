<template>
  <div class="min-h-screen flex items-center justify-center px-4" style="background: var(--ws-bg);">
    <form
      class="w-full max-w-sm rounded-xl p-6 space-y-5"
      style="background: var(--ws-bg-card); border: 1px solid var(--ws-border);"
      @submit.prevent="submit"
    >
      <div class="flex items-center gap-2">
        <span class="text-2xl font-display font-bold tracking-wider text-white">WatchSense</span>
        <img src="/icon.svg" alt="" aria-hidden="true" width="32" height="32" class="h-8 w-8 shrink-0">
      </div>
      <p class="text-sm text-zinc-400">
        {{ introParts[0] }}<code class="text-zinc-300">WATCHSENSE_TOKEN</code>{{ introParts[1] }}
      </p>
      <div class="space-y-2">
        <label for="ws-token" class="text-xs font-semibold text-zinc-300 uppercase tracking-wider block">
          {{ t('login.tokenLabel') }}
        </label>
        <input
          id="ws-token"
          v-model="token"
          type="password"
          autocomplete="current-password"
          autofocus
          class="w-full text-sm bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-red-600"
        />
      </div>
      <p v-if="error" class="text-xs text-red-400">{{ error }}</p>
      <button
        type="submit"
        class="btn-primary w-full text-sm py-2 px-4 flex items-center justify-center gap-2"
        :disabled="loading || !token.trim()"
      >
        <UIcon :name="loading ? 'i-lucide-loader-2' : 'i-lucide-log-in'" :class="{ 'animate-spin': loading }" />
        <span>{{ loading ? t('login.submitting') : t('login.submit') }}</span>
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{ authenticated: [] }>()

const token = ref('')
const loading = ref(false)
const error = ref('')
const { t, serverErrorText } = useI18n()
// Il nome della variabile va in <code>: la frase si divide sul segnaposto {token}
const introParts = computed(() => {
  const [before = '', after = ''] = t('login.intro').split('{token}')
  return [before, after]
})

async function submit() {
  if (!token.value.trim() || loading.value) return
  loading.value = true
  error.value = ''
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { token: token.value } })
    token.value = ''
    emit('authenticated')
  } catch (err: any) {
    error.value = serverErrorText(err, t('login.failed'))
  } finally {
    loading.value = false
  }
}
</script>
