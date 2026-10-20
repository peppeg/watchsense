<template>
  <!-- Nuova installazione: benvenuto e lista dei quattro passi (sparisce quando sono tutti fatti) -->
  <div v-if="state.visible" class="ws-onboarding flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12 lg:py-6">
    <div class="min-w-0 flex-1">
      <p class="mb-2 text-sm font-semibold uppercase tracking-[1.5px] text-red-400">{{ t('onboarding.eyebrow') }}</p>
      <h1 class="font-display text-[44px] leading-none tracking-wide text-white md:text-[64px]">
        {{ t('onboarding.headline', { count: state.total - state.doneCount }) }}
      </h1>
      <p class="mt-5 max-w-[520px] text-base leading-relaxed text-[#c4c4cc] md:text-[17px]">{{ t('onboarding.intro') }}</p>
    </div>

    <section :aria-labelledby="titleId" class="ws-card w-full !rounded-[20px] !p-5 sm:!p-7 lg:w-[560px] lg:shrink-0">
      <div class="mb-2 flex items-center justify-between gap-3">
        <h2 :id="titleId" class="font-display text-[30px] leading-tight tracking-wide text-white">{{ t('onboarding.title') }}</h2>
        <div class="flex items-center gap-1">
          <span class="text-sm text-zinc-400" aria-hidden="true">{{ progressText }}</span>
          <button type="button" class="ws-hide-btn" :aria-label="t('onboarding.hideLabel')" @click="dismiss">
            {{ t('onboarding.hide') }}
          </button>
        </div>
      </div>
      <div
        class="mb-5 h-1.5 rounded-full bg-[#24242f]"
        role="progressbar"
        :aria-label="t('onboarding.progressLabel')"
        aria-valuemin="0"
        :aria-valuemax="state.total"
        :aria-valuenow="state.doneCount"
        :aria-valuetext="progressText"
      >
        <div class="h-1.5 rounded-full bg-green-500 transition-[width]" :style="{ width: `${(state.doneCount / state.total) * 100}%` }"></div>
      </div>

      <ol class="flex flex-col gap-3">
        <li
          v-for="(step, i) in state.steps"
          :key="step.id"
          class="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[14px] p-4 sm:flex-nowrap"
          :class="step.id === state.current ? 'bg-[var(--ws-bg-surface)] shadow-[inset_0_0_0_1px_var(--ws-accent)]' : 'bg-[var(--ws-bg-inset)]'"
          :aria-current="step.id === state.current ? 'step' : undefined"
        >
          <span
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold"
            :class="step.done
              ? 'bg-green-900'
              : step.id === state.current ? 'bg-[var(--ws-accent)] text-white' : 'border-2 border-[#3a3a4f] text-zinc-400'"
            aria-hidden="true"
          >
            <UIcon v-if="step.done" name="i-lucide-check" class="text-base text-green-400" />
            <template v-else>{{ i + 1 }}</template>
          </span>
          <!-- Telefono: il testo prende la riga, il pulsante va sotto (allineato al testo) -->
          <div class="min-w-0 flex-1 basis-[calc(100%-48px)] sm:basis-auto">
            <div class="text-base font-semibold" :class="step.done ? 'text-zinc-400 line-through' : 'text-white'">
              {{ t(stepKey(step.id, 'title')) }}
            </div>
            <div class="text-sm text-zinc-400">{{ subtitle(step.id) }}</div>
          </div>
          <span v-if="step.done" class="ml-12 text-sm font-medium text-green-400 sm:ml-0">{{ t('onboarding.done') }}</span>
          <template v-else>
            <span class="sr-only">{{ t('onboarding.todo') }}</span>
            <a
              :href="onboardingHref(step.target)"
              class="ws-btn ml-12 !no-underline sm:ml-0"
              :class="{ 'ws-btn-primary': step.id === state.current }"
              @click.prevent="emit('openSettings', step.target)"
            >
              {{ t(stepKey(step.id, 'action')) }}
              <span class="sr-only">: {{ t(stepKey(step.id, 'title')) }}</span>
            </a>
          </template>
        </li>
      </ol>
      <p class="mt-5 text-sm text-zinc-400">{{ t('onboarding.footer') }}</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onboardingHref, onboardingState, type OnboardingStepId, type OnboardingTarget } from '~/utils/onboarding'
import { nativeLanguageName, regionName } from '~/utils/locale-options'
import type { MessageKey } from '~/locales/i18n'

const emit = defineEmits<{ openSettings: [target: OnboardingTarget] }>()
const { t, locale } = useI18n()
const titleId = useId()

// Stessi dati delle Impostazioni (GET /api/config): già con l'SSR, nessun lampo della lista
const { data: config } = useFetch<any>('/api/config', { key: 'home-onboarding-config' })
const dismissed = ref(false)

const state = computed(() => {
  const s = onboardingState(config.value)
  return dismissed.value ? { ...s, visible: false } : s
})
const progressText = computed(() => t('onboarding.progress', { done: state.value.doneCount, total: state.value.total }))

function subtitle(id: OnboardingStepId): string {
  if (id === 'locale') {
    const l = config.value?.locale
    return l ? `${nativeLanguageName(l.app_locale)} · ${regionName(l.tmdb_region, locale.value)}` : ''
  }
  return t(stepKey(id, 'subtitle'))
}

const stepKey = (id: OnboardingStepId, field: 'title' | 'subtitle' | 'action') => `onboarding.steps.${id}.${field}` as MessageKey

// "Nascondi": sparisce subito e resta nascosta su ogni dispositivo (config del server)
async function dismiss() {
  dismissed.value = true
  try {
    await $fetch('/api/config', { method: 'POST', body: { onboarding: { dismissed: true } } })
  } catch (err) {
    console.error('Errore nel nascondere la lista Per iniziare:', err)
    dismissed.value = false
  }
}
</script>

<style scoped>
.ws-onboarding :focus-visible {
  outline: 2px solid var(--ws-link);
  outline-offset: 2px;
}

.ws-hide-btn {
  min-height: 44px;
  min-width: 44px;
  padding: 0 10px;
  border-radius: 10px;
  color: var(--ws-link);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.ws-hide-btn:hover {
  color: var(--ws-link-hover);
  text-decoration: underline;
}
</style>
