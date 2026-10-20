<template>
  <!-- Segreto salvato ma non decifrabile (chiave dei segreti cambiata o mancante) -->
  <div
    v-if="show"
    role="alert"
    class="flex items-start gap-2 rounded-xl border border-amber-600/60 bg-amber-950/40 p-3 text-sm text-amber-200"
  >
    <UIcon name="i-lucide-key-round" class="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
    <p>{{ text || t('settings.secretUnreadable') }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ show: boolean | undefined; text?: string }>()
const { t } = useI18n()
</script>
