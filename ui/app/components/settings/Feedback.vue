<template>
  <!-- Esito dell'ultima azione avviata in questo punto della pagina (scope) -->
  <div aria-live="polite" class="contents">
    <div
      v-if="visible"
      v-bind="$attrs"
      class="flex items-start justify-between gap-3 rounded-xl border p-4 text-sm leading-relaxed"
      :class="flash.type === 'error' ? 'border-red-900/60 bg-red-950/40 text-red-200' : 'border-emerald-900/60 bg-emerald-950/40 text-emerald-200'"
      :role="flash.type === 'error' ? 'alert' : 'status'"
    >
      <div class="flex items-start gap-2.5">
        <UIcon :name="flash.type === 'error' ? 'i-lucide-alert-triangle' : 'i-lucide-check-circle-2'" class="mt-0.5 shrink-0 text-lg" aria-hidden="true" />
        <span>{{ flash.text }}</span>
      </div>
      <button type="button" class="-m-2 flex h-11 w-11 shrink-0 items-center justify-center text-zinc-400 hover:text-white" :aria-label="t('common.close')" @click="clearFlash">
        <UIcon name="i-lucide-x" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { FlashScope } from '~/composables/useSettings'

defineOptions({ inheritAttrs: false })
const props = defineProps<{ scope: FlashScope }>()
const { t } = useI18n()
const { flash, clearFlash } = useSettings()
const visible = computed(() => !!flash.value.text && flash.value.scope === props.scope)
</script>
